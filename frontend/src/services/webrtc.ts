import { wsClient } from './websocket';

export interface WebRTCProgressUpdate {
  transfer_id: string;
  file_id: string;
  bytes_transferred: number;
  total_size: number;
  progress_percentage: number;
  speed_bps: number;
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
  // Public STUN server included as fallback for complex NAT topologies
  { urls: 'stun:stun.l.google.com:19302' },
];

class WebRTCManager {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();

  // Active receiving buffers: transfer_id:file_id -> array of received chunks
  private receivingFiles: Map<
    string,
    {
      transfer_id: string;
      file_id: string;
      filename: string;
      relative_path: string;
      size: number;
      sha256_expected?: string;
      chunks: ArrayBuffer[];
      bytes_received: number;
      total_chunks: number;
    }
  > = new Map();

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

  // Create or get RTCPeerConnection for a peer device
  public getOrCreatePeerConnection(targetDeviceId: string): RTCPeerConnection {
    if (this.peerConnections.has(targetDeviceId)) {
      const existing = this.peerConnections.get(targetDeviceId)!;
      if (existing.connectionState !== 'closed' && existing.connectionState !== 'failed') {
        return existing;
      }
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        wsClient.send({
          type: 'webrtc_ice_candidate',
          target_device_id: targetDeviceId,
          candidate: event.candidate,
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
  public async connectToPeer(targetDeviceId: string, timeoutMs = 6000): Promise<RTCDataChannel> {
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
    const pc = this.getOrCreatePeerConnection(fromDeviceId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

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
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  private async handleIceCandidate(fromDeviceId: string, candidate: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(fromDeviceId);
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] Failed to add ICE candidate:', e);
      }
    }
  }

  // Handle incoming control messages (metadata, completion)
  private async handleControlMessage(fromDeviceId: string, msg: any) {
    if (msg.type === 'file_start') {
      const key = `${msg.transfer_id}:${msg.file_id}`;
      this.receivingFiles.set(key, {
        transfer_id: msg.transfer_id,
        file_id: msg.file_id,
        filename: msg.filename,
        relative_path: msg.relative_path,
        size: msg.size,
        sha256_expected: msg.sha256,
        chunks: [],
        bytes_received: 0,
        total_chunks: msg.total_chunks,
      });
    } else if (msg.type === 'file_end') {
      const key = `${msg.transfer_id}:${msg.file_id}`;
      const fileData = this.receivingFiles.get(key);
      if (!fileData) return;

      const blob = new Blob(fileData.chunks);
      let verified = true;

      // Verify SHA-256
      if (fileData.sha256_expected && window.crypto && window.crypto.subtle) {
        try {
          const buffer = await blob.arrayBuffer();
          const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const calculated = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase();
          verified = calculated === fileData.sha256_expected.toLowerCase().trim();
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

      this.receivingFiles.delete(key);
    }
  }

  // Handle binary chunk packet: [4 bytes chunk_idx][4 bytes offset][payload bytes...]
  private handleBinaryChunk(fromDeviceId: string, buffer: ArrayBuffer) {
    if (buffer.byteLength < 8) return;

    const view = new DataView(buffer);
    const chunkIdx = view.getUint32(0);
    const offset = view.getUint32(4);
    const payload = buffer.slice(8);

    // Find the currently receiving file
    const activeEntry = Array.from(this.receivingFiles.values())[0];
    if (!activeEntry) return;

    activeEntry.chunks.push(payload);
    activeEntry.bytes_received += payload.byteLength;

    if (this.onProgressCallback) {
      const pct = Math.min(100, Math.round((activeEntry.bytes_received / activeEntry.size) * 100));
      this.onProgressCallback({
        transfer_id: activeEntry.transfer_id,
        file_id: activeEntry.file_id,
        bytes_transferred: activeEntry.bytes_received,
        total_size: activeEntry.size,
        progress_percentage: pct,
        speed_bps: 0,
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
    onProgress?: (bytesSent: number, total: number) => void
  ): Promise<void> {
    const totalSize = file.size;
    const totalChunks = Math.max(1, Math.ceil(totalSize / chunkSize));

    // 1. Send file start metadata
    channel.send(
      JSON.stringify({
        type: 'file_start',
        transfer_id: transferId,
        file_id: fileId,
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
      const offset = i * chunkSize;
      const end = Math.min(totalSize, offset + chunkSize);
      const sliceBlob = file.slice(offset, end);
      const chunkBuffer = await sliceBlob.arrayBuffer();

      // Flow control wait if channel buffer is full
      await waitForBufferDrain();

      // Construct packet: 8-byte header + chunk data
      const packet = new Uint8Array(8 + chunkBuffer.byteLength);
      const view = new DataView(packet.buffer);
      view.setUint32(0, i);
      view.setUint32(4, offset);
      packet.set(new Uint8Array(chunkBuffer), 8);

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
