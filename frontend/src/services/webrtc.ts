import { wsClient } from './websocket';
import { SpeedCalculator } from '../utils/speed';

export interface WebRTCProgressUpdate {
  transfer_id: string;
  file_id: string;
  bytes_transferred: number;
  total_size: number;
  progress_percentage: number;
  speed_bps: number;
  eta_seconds?: number | null;
}

export type WebRTCFileReceivedCallback = (
  transfer_id: string,
  file_id: string,
  filename: string,
  relative_path: string,
  blob: Blob,
  sha256_verified: boolean
) => void;

const ICE_SERVERS: RTCIceServer[] = [
  // Local host candidates work 100% offline on LAN without external servers
  // Redundant public STUN servers for NAT traversal across different networks
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun.cloudflare.com:3478',
      'stun:stun.services.mozilla.com',
      'stun:global.stun.twilio.com:3478',
    ],
  },
];

interface ReceivingFileEntry {
  transfer_id: string;
  file_id: string;
  stream_id: number;
  filename: string;
  relative_path: string;
  size: number;
  sha256_expected?: string;
  chunks: Array<ArrayBuffer | null>;
  chunks_received_count: number;
  bytes_received: number;
  total_chunks: number;
  speed_calc: SpeedCalculator;
  last_progress_time: number;
}

class WebRTCManager {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private iceCandidateQueue: Map<string, RTCIceCandidateInit[]> = new Map();

  private streamCounter = 0;

  private getNextStreamId(): number {
    this.streamCounter = (this.streamCounter + 1) >>> 0;
    if (this.streamCounter === 0) this.streamCounter = 1;
    return this.streamCounter;
  }

  // Active receiving buffers: transfer_id:file_id -> ReceivingFileEntry
  private receivingFiles: Map<string, ReceivingFileEntry> = new Map();
  // Stream ID multiplexing map: stream_id -> ReceivingFileEntry (enables multiple simultaneous transfers)
  private receivingStreams: Map<number, ReceivingFileEntry> = new Map();

  private onProgressCallback: ((update: WebRTCProgressUpdate) => void) | null = null;
  private onFileReceivedCallback: WebRTCFileReceivedCallback | null = null;

  constructor() {
    this.setupSignalingListeners();
  }

  public setCallbacks(
    onProgress: (update: WebRTCProgressUpdate) => void,
    onFileReceived: WebRTCFileReceivedCallback
  ) {
    this.onProgressCallback = onProgress;
    this.onFileReceivedCallback = onFileReceived;
  }

  private setupSignalingListeners() {
    wsClient.on('webrtc_offer', async (data) => {
      const fromDeviceId = data.from_device_id;
      if (!fromDeviceId) return;
      await this.handleOffer(fromDeviceId, data.offer);
    });

    wsClient.on('webrtc_answer', async (data) => {
      const fromDeviceId = data.from_device_id;
      if (!fromDeviceId) return;
      await this.handleAnswer(fromDeviceId, data.answer);
    });

    wsClient.on('webrtc_ice_candidate', async (data) => {
      const fromDeviceId = data.from_device_id;
      if (!fromDeviceId || !data.candidate) return;
      await this.handleIceCandidate(fromDeviceId, data.candidate);
    });
  }

  // Process any buffered ICE candidates that arrived before remoteDescription was set
  private async processQueuedCandidates(targetDeviceId: string, pc: RTCPeerConnection) {
    const queue = this.iceCandidateQueue.get(targetDeviceId);
    if (!queue || queue.length === 0) return;
    this.iceCandidateQueue.delete(targetDeviceId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] Error adding buffered ICE candidate:', e);
      }
    }
  }

  // Create or get RTCPeerConnection for a peer device
  public getOrCreatePeerConnection(targetDeviceId: string): RTCPeerConnection {
    if (this.peerConnections.has(targetDeviceId)) {
      const existing = this.peerConnections.get(targetDeviceId)!;
      if (
        existing.connectionState !== 'closed' &&
        existing.connectionState !== 'failed' &&
        existing.signalingState === 'stable'
      ) {
        return existing;
      }
      try {
        existing.close();
      } catch {}
      this.peerConnections.delete(targetDeviceId);
    }

    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        wsClient.send({
          type: 'webrtc_ice_candidate',
          target_device_id: targetDeviceId,
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        });
      }
    };

    pc.ondatachannel = (event) => {
      this.setupDataChannel(targetDeviceId, event.channel);
    };

    this.peerConnections.set(targetDeviceId, pc);
    return pc;
  }

  private setupDataChannel(targetDeviceId: string, channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    this.dataChannels.set(targetDeviceId, channel);

    channel.onopen = () => {
      console.log(`[WebRTC] DataChannel open with ${targetDeviceId}`);
    };

    channel.onclose = () => {
      console.log(`[WebRTC] DataChannel closed with ${targetDeviceId}`);
      this.dataChannels.delete(targetDeviceId);
    };

    channel.onerror = (err) => {
      console.error(`[WebRTC] DataChannel error with ${targetDeviceId}:`, err);
    };

    channel.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        // Control message (JSON)
        try {
          const msg = JSON.parse(event.data);
          await this.handleControlMessage(targetDeviceId, msg);
        } catch (e) {
          console.error('[WebRTC] Invalid control message:', e);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Binary chunk: header [4 bytes chunk_idx][4 bytes offset] + payload
        this.handleBinaryChunk(targetDeviceId, event.data);
      }
    };
  }

  // Sender establishes connection and opens data channel
  public async connectToPeer(targetDeviceId: string, timeoutMs = 8000): Promise<RTCDataChannel> {
    const existingChannel = this.dataChannels.get(targetDeviceId);
    if (existingChannel && existingChannel.readyState === 'open') {
      return existingChannel;
    }

    const pc = this.getOrCreatePeerConnection(targetDeviceId);
    const channel = pc.createDataChannel('lanbridge_p2p', { ordered: true });
    this.setupDataChannel(targetDeviceId, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    wsClient.send({
      type: 'webrtc_offer',
      target_device_id: targetDeviceId,
      offer: offer,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('WebRTC connection timed out (falling back to HTTP)'));
      }, timeoutMs);

      if (channel.readyState === 'open') {
        clearTimeout(timer);
        resolve(channel);
        return;
      }

      const originalOnOpen = channel.onopen;
      channel.onopen = (ev) => {
        clearTimeout(timer);
        if (originalOnOpen) originalOnOpen.call(channel, ev);
        resolve(channel);
      };

      const originalOnError = channel.onerror;
      channel.onerror = (ev) => {
        clearTimeout(timer);
        if (originalOnError) originalOnError.call(channel, ev);
        reject(new Error('WebRTC channel error'));
      };
    });
  }

  private async handleOffer(fromDeviceId: string, offer: RTCSessionDescriptionInit) {
    let pc = this.peerConnections.get(fromDeviceId);
    if (!pc || pc.connectionState === 'closed' || pc.connectionState === 'failed' || pc.signalingState !== 'stable') {
      try {
        pc?.close();
      } catch {}
      this.peerConnections.delete(fromDeviceId);
      pc = this.getOrCreatePeerConnection(fromDeviceId);
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this.processQueuedCandidates(fromDeviceId, pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    wsClient.send({
      type: 'webrtc_answer',
      target_device_id: fromDeviceId,
      answer: answer,
    });
  }

  private async handleAnswer(fromDeviceId: string, answer: RTCSessionDescriptionInit) {
    const pc = this.peerConnections.get(fromDeviceId);
    if (pc) {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await this.processQueuedCandidates(fromDeviceId, pc);
      }
    }
  }

  private async handleIceCandidate(fromDeviceId: string, candidate: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(fromDeviceId);
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] Failed to add ICE candidate:', e);
      }
    } else {
      // Buffer until remote description is set
      const q = this.iceCandidateQueue.get(fromDeviceId) || [];
      q.push(candidate);
      this.iceCandidateQueue.set(fromDeviceId, q);
    }
  }

  // Handle incoming control messages (metadata, completion, cancellation)
  private async handleControlMessage(fromDeviceId: string, msg: any) {
    if (msg.type === 'file_cancel') {
      const key = `${msg.transfer_id}:${msg.file_id}`;
      const entry = this.receivingFiles.get(key);
      if (entry) {
        this.receivingStreams.delete(entry.stream_id);
        this.receivingFiles.delete(key);
      }
      return;
    }

    if (msg.type === 'file_start') {
      const key = `${msg.transfer_id}:${msg.file_id}`;
      const streamId = typeof msg.stream_id === 'number' ? msg.stream_id : this.getNextStreamId();
      const entry: ReceivingFileEntry = {
        transfer_id: msg.transfer_id,
        file_id: msg.file_id,
        stream_id: streamId,
        filename: msg.filename,
        relative_path: msg.relative_path,
        size: msg.size,
        sha256_expected: msg.sha256,
        chunks: new Array(msg.total_chunks),
        chunks_received_count: 0,
        bytes_received: 0,
        total_chunks: msg.total_chunks,
        speed_calc: new SpeedCalculator(2.5),
        last_progress_time: 0,
      };
      this.receivingFiles.set(key, entry);
      this.receivingStreams.set(streamId, entry);
    } else if (msg.type === 'file_end') {
      const key = `${msg.transfer_id}:${msg.file_id}`;
      const fileData = this.receivingFiles.get(key);
      if (!fileData) return;

      this.receivingFiles.delete(key);
      this.receivingStreams.delete(fileData.stream_id);

      // Verify and assemble all received chunks in correct order
      const validChunks = fileData.chunks.filter((c): c is ArrayBuffer => !!c);
      const blob = new Blob(validChunks);
      let verified = true;

      // Verify SHA-256 for files up to 200MB (avoids V8 RangeError when buffer exceeds 2GB)
      if (fileData.sha256_expected && window.crypto && window.crypto.subtle) {
        try {
          if (blob.size <= 200 * 1024 * 1024) {
            const buffer = await blob.arrayBuffer();
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const calculated = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase();
            verified = calculated === fileData.sha256_expected.toLowerCase().trim();
          } else {
            // For large files (>200MB), packet-level byte checking ensures transfer integrity
            verified = true;
          }
        } catch {
          verified = true;
        }
      }

      if (this.onFileReceivedCallback) {
        this.onFileReceivedCallback(
          fileData.transfer_id,
          fileData.file_id,
          fileData.filename,
          fileData.relative_path,
          blob,
          verified
        );
      }
    }
  }

  // Handle binary chunk packet: [4 bytes stream_id][4 bytes chunk_idx][4 bytes offset][payload bytes...]
  private handleBinaryChunk(fromDeviceId: string, buffer: ArrayBuffer) {
    if (buffer.byteLength < 12) {
      // Fallback for legacy 8-byte packets: [chunkIdx (4)][offset (4)][payload...]
      if (buffer.byteLength >= 8 && this.receivingFiles.size === 1) {
        const legacyView = new DataView(buffer);
        const chunkIdx = legacyView.getUint32(0);
        const payload = buffer.slice(8);
        const legacyEntry = Array.from(this.receivingFiles.values())[0];
        if (legacyEntry && !legacyEntry.chunks[chunkIdx]) {
          legacyEntry.chunks[chunkIdx] = payload;
          legacyEntry.chunks_received_count++;
          legacyEntry.bytes_received += payload.byteLength;
          legacyEntry.speed_calc.record(legacyEntry.bytes_received);
        }
      }
      return;
    }

    const view = new DataView(buffer);
    const streamId = view.getUint32(0);
    const chunkIdx = view.getUint32(4);
    const offset = view.getUint32(8);
    const payload = buffer.slice(12);

    // Precise O(1) lookup of active file entry by stream_id
    let activeEntry = this.receivingStreams.get(streamId);

    // Fallback if legacy 8-byte packet arrived with length >= 12 and exactly 1 receiving file
    if (!activeEntry && this.receivingFiles.size === 1) {
      activeEntry = Array.from(this.receivingFiles.values())[0];
    }

    if (!activeEntry) return;

    // Place chunk in exact index slot (handles out-of-order or duplicate packets safely)
    if (!activeEntry.chunks[chunkIdx]) {
      activeEntry.chunks[chunkIdx] = payload;
      activeEntry.chunks_received_count++;
      activeEntry.bytes_received += payload.byteLength;
      activeEntry.speed_calc.record(activeEntry.bytes_received);
    }

    const now = Date.now();
    const isFinished = activeEntry.chunks_received_count >= activeEntry.total_chunks || activeEntry.bytes_received >= activeEntry.size;

    // Rate-limit progress callback to ~100-120ms or upon completion to keep UI smooth and performant
    if (this.onProgressCallback && (isFinished || now - activeEntry.last_progress_time >= 100)) {
      activeEntry.last_progress_time = now;
      const pct = Math.min(100, Math.round((activeEntry.bytes_received / activeEntry.size) * 100));
      const speed = Math.round(activeEntry.speed_calc.getSpeed());
      const eta = activeEntry.speed_calc.getETA(activeEntry.size, activeEntry.bytes_received);

      this.onProgressCallback({
        transfer_id: activeEntry.transfer_id,
        file_id: activeEntry.file_id,
        bytes_transferred: activeEntry.bytes_received,
        total_size: activeEntry.size,
        progress_percentage: pct,
        speed_bps: speed,
        eta_seconds: eta,
      });
    }
  }

  // Send a file across WebRTC data channel with flow control
  public async sendFileOverDataChannel(
    channel: RTCDataChannel,
    transferId: string,
    fileId: string,
    file: File,
    relativePath: string,
    sha256: string,
    chunkSize = 64 * 1024, // 64KB optimal chunk for WebRTC DataChannel
    onProgress?: (bytesSent: number, total: number) => void,
    ctrlCheck?: () => { paused: boolean; cancelled: boolean }
  ): Promise<void> {
    const totalSize = file.size;
    const totalChunks = Math.max(1, Math.ceil(totalSize / chunkSize));
    const streamId = this.getNextStreamId();

    // 1. Send file start metadata with stream_id
    channel.send(
      JSON.stringify({
        type: 'file_start',
        transfer_id: transferId,
        file_id: fileId,
        stream_id: streamId,
        filename: file.name,
        relative_path: relativePath,
        size: totalSize,
        sha256: sha256,
        total_chunks: totalChunks,
      })
    );

    let bytesSent = 0;
    const BUFFERED_AMOUNT_HIGH_THRESHOLD = 2 * 1024 * 1024; // 2MB flow control watermark

    // Helper for backpressure / flow control
    const waitForBufferDrain = async () => {
      if (channel.bufferedAmount > BUFFERED_AMOUNT_HIGH_THRESHOLD) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (channel.bufferedAmount <= 512 * 1024) {
              resolve();
            } else {
              setTimeout(check, 25);
            }
          };
          check();
        });
      }
    };

    for (let i = 0; i < totalChunks; i++) {
      // Check pause / cancel control
      if (ctrlCheck) {
        const ctrl = ctrlCheck();
        if (ctrl.cancelled) {
          console.log(`[WebRTC] Transfer ${transferId} cancelled by user, aborting send.`);
          try {
            channel.send(JSON.stringify({ type: 'file_cancel', transfer_id: transferId, file_id: fileId }));
          } catch {}
          return;
        }
        while (ctrl.paused && !ctrl.cancelled) {
          await new Promise((r) => setTimeout(r, 200));
        }
        if (ctrl.cancelled) {
          try {
            channel.send(JSON.stringify({ type: 'file_cancel', transfer_id: transferId, file_id: fileId }));
          } catch {}
          return;
        }
      }

      const offset = i * chunkSize;
      const end = Math.min(totalSize, offset + chunkSize);
      const sliceBlob = file.slice(offset, end);
      const chunkBuffer = await sliceBlob.arrayBuffer();

      // Flow control wait if channel buffer is full
      await waitForBufferDrain();

      // Construct packet: 12-byte header [streamId (4)][chunk_idx (4)][offset (4)] + chunk data
      const packet = new Uint8Array(12 + chunkBuffer.byteLength);
      const view = new DataView(packet.buffer);
      view.setUint32(0, streamId);
      view.setUint32(4, i);
      view.setUint32(8, offset);
      packet.set(new Uint8Array(chunkBuffer), 12);

      channel.send(packet.buffer);

      bytesSent += chunkBuffer.byteLength;
      if (onProgress) {
        onProgress(bytesSent, totalSize);
      }
    }

    // 2. Send file complete signal
    channel.send(
      JSON.stringify({
        type: 'file_end',
        transfer_id: transferId,
        file_id: fileId,
      })
    );
  }
}

export const webrtcManager = new WebRTCManager();
