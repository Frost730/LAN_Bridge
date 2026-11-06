import { useState, useEffect, useRef, useCallback } from 'react';
import { TransferItem, DeviceInfo } from '../types';
import { api } from '../services/api';
import { wsClient } from '../services/websocket';
import { calculateFileSHA256, getActualFileSize, getResolvedFileAndSize } from '../utils/hashing';
import { webrtcManager, webrtcReceivedFiles } from '../services/webrtc';
import { getTransferConfig } from '../utils/transferSettings';
import { SpeedCalculator } from '../utils/speed';
import { formatBytes } from '../utils/formatters';

// Global upload limiter to prevent HTTP/1.1 socket exhaustion (browser 6-connection host limit)
// and prevent parallel transfers from choking each other or hitting timeout aborts.
class GlobalUploadLimiter {
  private active = 0;
  private maxActive = 4;
  private waitQueue: Array<() => void> = [];

  public async acquire(): Promise<() => void> {
    if (this.active < this.maxActive) {
      this.active++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }
    return new Promise((resolve) => {
      this.waitQueue.push(() => {
        this.active++;
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.release();
          }
        });
      });
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    if (this.waitQueue.length > 0 && this.active < this.maxActive) {
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }
}

const globalUploadLimiter = new GlobalUploadLimiter();

export function useTransfers(localDevice: DeviceInfo, onNotification?: (title: string, body?: string) => void) {
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [incomingTransfer, setIncomingTransfer] = useState<TransferItem | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Keep a stable ref for onNotification callback to prevent re-subscription loops
  const onNotificationRef = useRef(onNotification);
  useEffect(() => {
    onNotificationRef.current = onNotification;
  });

  const localDeviceId = localDevice.device_id;

  // Map of transferId -> Array of native File objects
  const localFilesRef = useRef<Map<string, { fileObj: File; fileId: string; relativePath: string; sha256?: string; targetDeviceId: string }[]>>(
    new Map()
  );
  // Transfer state flags for cancellation / pause control
  const activeControlRef = useRef<Map<string, { paused: boolean; cancelled: boolean }>>(new Map());

  // Set of transfer IDs currently executing an active upload loop (prevents duplicate runs)
  const activeSendingTransfersRef = useRef<Set<string>>(new Set());

  // Set of transfer IDs that have already triggered a completion notification (deduplication)
  const completedNotifiedTransfersRef = useRef<Set<string>>(new Set());

  // Set of file IDs received per transfer for WebRTC multi-file tracking
  const receivedFilesByTransferRef = useRef<Map<string, Set<string>>>(new Map());

  // Always compute correct direction relative to current device
  const normalizeTransfer = useCallback((t: TransferItem): TransferItem => ({
    ...t,
    direction: t.sender_device_id === localDeviceId ? 'sent' : 'received',
  }), [localDeviceId]);

  // Load existing transfers
  const refreshTransfers = useCallback(async () => {
    try {
      const list = await api.getTransfers(localDeviceId);
      setTransfers((prev) => {
        return list.map((raw) => {
          const incoming = normalizeTransfer(raw);
          const existing = prev.find((p) => p.transfer_id === incoming.transfer_id);

          // If this device was the sender and transfer is marked transferring,
          // and local files are in memory but streaming is not running, kickstart it!
          if (
            incoming.status === 'transferring' &&
            incoming.sender_device_id === localDeviceId &&
            !activeSendingTransfersRef.current.has(incoming.transfer_id) &&
            localFilesRef.current.has(incoming.transfer_id)
          ) {
            const files = localFilesRef.current.get(incoming.transfer_id);
            if (files && files.length > 0) {
              executeTransferSendingRef.current(incoming.transfer_id, files);
            }
          }

          // If this device was the sender and transfer is still marked transferring with 0 bytes,
          // but local files are no longer in RAM (e.g. after a page reload), mark it cancelled.
          if (
            incoming.status === 'transferring' &&
            incoming.bytes_transferred === 0 &&
            incoming.sender_device_id === localDeviceId &&
            !activeSendingTransfersRef.current.has(incoming.transfer_id) &&
            !localFilesRef.current.has(incoming.transfer_id)
          ) {
            api.cancelTransfer(incoming.transfer_id).catch(() => {});
            return { ...incoming, status: 'cancelled' as const, error_message: 'Session disconnected by page reload' };
          }

          // Prevent race condition: never demote an already completed transfer back to transferring!
          if (existing && existing.status === 'completed' && incoming.status !== 'completed') {
            return existing;
          }

          // If incoming transfer has arrived with all bytes, treat as completed
          if (incoming.total_size > 0 && incoming.bytes_transferred >= incoming.total_size) {
            return {
              ...incoming,
              status: 'completed',
              progress_percentage: 100,
              speed_bps: 0,
              eta_seconds: 0,
            };
          }

          return incoming;
        });
      });
    } catch {
      // Ignore
    }
  }, [localDeviceId, normalizeTransfer]);

  // Chunk streaming upload engine
  const startChunkUpload = useCallback(async (
    transferId: string,
    files: { fileObj: File; fileId: string; relativePath: string }[]
  ) => {
    const ctrl = activeControlRef.current.get(transferId) || { paused: false, cancelled: false };
    const engineConfig = getTransferConfig();
    const CHUNK_SIZE = engineConfig.chunkSize;
    const CONCURRENCY = Math.max(1, Math.min(files.length, engineConfig.concurrentTransfers));
    let hasUploadErrors = false;

    const totalTransferSize = files.reduce((acc, f) => acc + f.fileObj.size, 0);
    let totalUploadedBytes = 0;
    const senderSpeedCalc = new SpeedCalculator(2.5);
    let lastProgressTime = 0;

    // Upload single file with concurrent chunk pipelining
    const uploadSingleFile = async (item: { fileObj: File; fileId: string; relativePath: string }) => {
      if (ctrl.cancelled || hasUploadErrors) return;

      const file = item.fileObj;
      const totalSize = file.size;
      const totalChunks = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE));

      // Query server for already-received chunks (essential for RESUME capability!)
      let receivedChunks: Set<number> | null = null;
      try {
        const serverStatus = await api.getTransfer(transferId);
        const serverFile = serverStatus?.files?.find((f) => f.file_id === item.fileId);
        if (serverFile && Array.isArray(serverFile.chunks_received) && serverFile.chunks_received.length > 0) {
          receivedChunks = new Set(serverFile.chunks_received);
          totalUploadedBytes += serverFile.bytes_received || 0;
        } else if (serverFile && serverFile.bytes_received === 0) {
          receivedChunks = new Set();
        }
      } catch {
        // Fallback to sending all chunks
      }

      // Collect pending chunk indices to send
      const pendingIndices: number[] = [];
      for (let idx = 0; idx < totalChunks; idx++) {
        if (!receivedChunks || !receivedChunks.has(idx)) {
          pendingIndices.push(idx);
        }
      }

      if (pendingIndices.length === 0) {
        return;
      }

      // Concurrency: 3 in-flight chunks for single-file transfers; 2 for multi-file transfers
      const CHUNK_CONCURRENCY = Math.max(1, Math.min(files.length === 1 ? 3 : 2, pendingIndices.length));
      let nextChunkIdxPtr = 0;

      const chunkWorker = async () => {
        while (nextChunkIdxPtr < pendingIndices.length && !ctrl.cancelled && !hasUploadErrors) {
          const chunkIdx = pendingIndices[nextChunkIdxPtr++];
          if (chunkIdx === undefined) break;

          const offset = chunkIdx * CHUNK_SIZE;
          const end = Math.min(totalSize, offset + CHUNK_SIZE);
          const chunkBlob = file.slice(offset, end);
          const chunkPayload: Blob = chunkBlob;

          let chunkSuccess = false;
          let lastErrMsg = '';
          const maxAttempts = 6;

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (ctrl.cancelled || hasUploadErrors) break;

            // Check pause state: loop wait with periodic server poll
            let pausePollCount = 0;
            while (ctrl.paused && !ctrl.cancelled) {
              await new Promise((r) => setTimeout(r, 250));
              pausePollCount++;
              if (pausePollCount % 8 === 0) {
                try {
                  const status = await api.getTransfer(transferId);
                  if (status.status === 'transferring') {
                    ctrl.paused = false;
                    break;
                  } else if (status.status === 'cancelled') {
                    ctrl.cancelled = true;
                    break;
                  }
                } catch {}
              }
            }
            if (ctrl.cancelled || hasUploadErrors) break;

            const releaseSlot = await globalUploadLimiter.acquire();
            try {
              if (ctrl.cancelled || hasUploadErrors) {
                releaseSlot();
                break;
              }
              await api.uploadChunk(transferId, item.fileId, chunkIdx, offset, chunkPayload);
              chunkSuccess = true;
              totalUploadedBytes += chunkPayload.size;

              // Live progress & speed update on sender side
              const now = Date.now();
              senderSpeedCalc.record(totalUploadedBytes, now);
              if (now - lastProgressTime > 120 || totalUploadedBytes >= totalTransferSize) {
                lastProgressTime = now;
                const speed = Math.round(senderSpeedCalc.getSpeed());
                const eta = senderSpeedCalc.getETA(totalTransferSize, totalUploadedBytes);
                const pct = totalTransferSize > 0
                  ? Math.min(100, Math.round((totalUploadedBytes / totalTransferSize) * 100))
                  : 100;

                setTransfers((prev) =>
                  prev.map((t) =>
                    t.transfer_id === transferId
                      ? {
                          ...t,
                          bytes_transferred: totalUploadedBytes,
                          progress_percentage: pct,
                          speed_bps: speed,
                          eta_seconds: pct === 100 ? 0 : eta,
                          status: pct === 100 ? 'completed' : 'transferring',
                          transport: 'http',
                        }
                      : t
                  )
                );
              }
              break;
            } catch (err: any) {
              lastErrMsg = String(err?.message || '');
              console.warn(`Chunk ${chunkIdx} upload failed (attempt ${attempt}/${maxAttempts}):`, lastErrMsg);
              if (ctrl.cancelled) break;

              if (ctrl.paused || lastErrMsg.toLowerCase().includes('paused')) {
                while (ctrl.paused && !ctrl.cancelled) {
                  await new Promise((r) => setTimeout(r, 250));
                }
                if (ctrl.cancelled) break;
                attempt = 0;
                continue;
              }

              if (
                lastErrMsg.includes('507') ||
                lastErrMsg.includes('storage full') ||
                lastErrMsg.includes('disk full') ||
                lastErrMsg.includes('No space')
              ) {
                ctrl.cancelled = true;
                break;
              }
              if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, Math.min(4000, 1000 * Math.pow(1.4, attempt - 1))));
              }
            } finally {
              releaseSlot();
            }
          }

          if (!chunkSuccess && !ctrl.cancelled && !hasUploadErrors) {
            hasUploadErrors = true;
            // Auto-pause rather than permanently deleting the transfer!
            ctrl.paused = true;
            api.pauseTransfer(transferId).catch(() => {});
            const failureMessage =
              lastErrMsg.includes('507') ||
              lastErrMsg.includes('storage full') ||
              lastErrMsg.includes('disk full') ||
              lastErrMsg.includes('No space')
                ? 'Server storage limit reached on cloud container. For files > 500MB, use WebRTC or same Wi-Fi.'
                : `Connection paused at chunk ${chunkIdx + 1}/${totalChunks} (${file.name}). Tap Play/Resume to continue.`;

            setTransfers((prev) =>
              prev.map((t) =>
                t.transfer_id === transferId
                  ? {
                      ...t,
                      status: 'paused',
                      error_message: failureMessage,
                    }
                  : t
              )
            );
            break;
          }
        }
      };

      await Promise.all(Array.from({ length: CHUNK_CONCURRENCY }, () => chunkWorker()));
    };

    // Distribute files across concurrent worker slots
    let nextFileIndex = 0;
    const worker = async () => {
      while (nextFileIndex < files.length && !ctrl.cancelled) {
        const fileToUpload = files[nextFileIndex++];
        if (fileToUpload && !ctrl.cancelled) {
          await uploadSingleFile(fileToUpload);
        }
      }
    };

    const workerPool = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workerPool);

    if (!ctrl.cancelled && !hasUploadErrors) {
      // Strict verification: ensure total uploaded bytes match expected transfer size
      if (totalTransferSize > 0 && totalUploadedBytes < totalTransferSize) {
        console.warn(`[HTTP] Incomplete upload: uploaded ${totalUploadedBytes} of ${totalTransferSize} bytes.`);
        setTransfers((prev) =>
          prev.map((t) =>
            t.transfer_id === transferId
              ? {
                  ...t,
                  status: 'paused',
                  error_message: `Transfer paused: uploaded ${formatBytes(totalUploadedBytes)} of ${formatBytes(totalTransferSize)}. Tap Play to resume.`,
                }
              : t
          )
        );
        return;
      }

      try {
        await api.completeTransfer(transferId, 'http');
        localFilesRef.current.delete(transferId);
        activeControlRef.current.delete(transferId);

        // Only mark completed after backend confirms verification!
        setTransfers((prev) =>
          prev.map((t) =>
            t.transfer_id === transferId
              ? {
                  ...t,
                  status: 'completed',
                  bytes_transferred: t.total_size > 0 ? t.total_size : t.bytes_transferred,
                  progress_percentage: 100,
                  speed_bps: 0,
                  eta_seconds: 0,
                }
              : t
          )
        );
      } catch (e: any) {
        console.warn('[HTTP] Error completing transfer on backend:', e);
        setTransfers((prev) =>
          prev.map((t) =>
            t.transfer_id === transferId
              ? {
                  ...t,
                  status: 'failed',
                  error_message: e?.message || 'Verification failed on server',
                }
              : t
          )
        );
      }
    }

    refreshTransfers();
  }, [refreshTransfers]);

  // Centralized sender transmission executor (WebRTC with HTTP fallback)
  const executeTransferSending = useCallback(async (
    transferId: string,
    files: { fileObj: File; fileId: string; relativePath: string; sha256?: string; targetDeviceId: string }[]
  ) => {
    // Duplicate prevention: if this transfer is already actively streaming, ignore duplicate requests
    if (activeSendingTransfersRef.current.has(transferId)) {
      return;
    }
    if (!files || files.length === 0) return;

    activeSendingTransfersRef.current.add(transferId);
    if (!activeControlRef.current.has(transferId)) {
      activeControlRef.current.set(transferId, { paused: false, cancelled: false });
    }

    const targetDeviceId = files[0].targetDeviceId;
    const overallTotalSize = files.reduce((acc, f) => acc + f.fileObj.size, 0);

    try {
      // 1. Try WebRTC P2P DataChannel connection first (2.5s fast timeout to prevent UI hang)
      // For large files (>300MB), WebRTC in-memory chunk accumulation exhausts browser V8 heap limit.
      // Automatically route multi-gigabyte files to direct HTTP chunk streaming!
      let webrtcSuccess = false;
      const isLargeFile = overallTotalSize > 300 * 1024 * 1024;
      if (!isLargeFile && !webrtcManager.isWebRTCFailed(targetDeviceId)) {
        try {
          const channel = await webrtcManager.connectToPeer(targetDeviceId, 5000);
          if (channel && channel.readyState === 'open') {
            const ctrl = activeControlRef.current.get(transferId) || { paused: false, cancelled: false };
            if (ctrl.cancelled) {
              return;
            }

            webrtcSuccess = true;
            setTransfers((prev) =>
              prev.map((t) => (t.transfer_id === transferId ? { ...t, transport: 'webrtc', status: 'transferring' } : t))
            );

          const engineConfig = getTransferConfig();
          const webrtcChunkSize = engineConfig.performanceMode ? 128 * 1024 : 64 * 1024;
          let lastProgressTime = 0;
          const senderSpeedCalc = new SpeedCalculator(2.5);
          const overallTotalSize = files.reduce((acc, f) => acc + f.fileObj.size, 0);
          let cumulativeBytesBefore = 0;

          for (const item of files) {
            if (ctrl.cancelled) break;

            await webrtcManager.sendFileOverDataChannel(
              channel,
              transferId,
              item.fileId,
              item.fileObj,
              item.relativePath,
              item.sha256 || '',
              webrtcChunkSize,
              (sentInFile) => {
                const now = Date.now();
                const totalSent = cumulativeBytesBefore + sentInFile;
                senderSpeedCalc.record(totalSent, now);
                const pct = Math.min(100, Math.round((totalSent / overallTotalSize) * 100));

                if (pct === 100 || !engineConfig.performanceMode || now - lastProgressTime > 100) {
                  lastProgressTime = now;
                  const speed = Math.round(senderSpeedCalc.getSpeed());
                  const eta = senderSpeedCalc.getETA(overallTotalSize, totalSent);

                  setTransfers((prev) =>
                    prev.map((t) =>
                      t.transfer_id === transferId
                        ? {
                            ...t,
                            bytes_transferred: totalSent,
                            progress_percentage: pct,
                            speed_bps: speed,
                            eta_seconds: pct === 100 ? 0 : eta,
                            status: pct === 100 ? 'completed' : 'transferring',
                            transport: 'webrtc',
                          }
                        : t
                    )
                  );
                }
              },
              () => activeControlRef.current.get(transferId) || { paused: false, cancelled: false }
            );

            cumulativeBytesBefore += item.fileObj.size;
          }

          if (!ctrl.cancelled) {
            setTransfers((prev) =>
              prev.map((t) =>
                t.transfer_id === transferId
                  ? {
                      ...t,
                      bytes_transferred: overallTotalSize,
                      progress_percentage: 100,
                      speed_bps: 0,
                      eta_seconds: 0,
                      status: 'completed',
                      transport: 'webrtc',
                    }
                  : t
              )
            );

            // Notify backend of sender completion
            api.completeTransfer(transferId, 'webrtc').catch((err) => {
              console.warn('[WebRTC] Error notifying completeTransfer from sender:', err);
            });
            localFilesRef.current.delete(transferId);
            activeControlRef.current.delete(transferId);
          }
          return;
        }
      } catch (err) {
        console.log('[Transport] WebRTC P2P skipped or timed out, seamlessly using HTTP streaming');
      }
    }

      // 2. Seamless Fallback: HTTP chunk streaming
      const ctrl = activeControlRef.current.get(transferId) || { paused: false, cancelled: false };
      if (!ctrl.cancelled && !webrtcSuccess) {
        setTransfers((prev) =>
          prev.map((t) => (t.transfer_id === transferId ? { ...t, transport: 'http', status: 'transferring' } : t))
        );
        await startChunkUpload(transferId, files);
      }
    } finally {
      activeSendingTransfersRef.current.delete(transferId);
      const ctrl = activeControlRef.current.get(transferId);
      // Clean up files and controls ONLY if explicitly cancelled.
      // NEVER delete localFilesRef when paused, so the transfer can be resumed at any time!
      if (ctrl?.cancelled) {
        localFilesRef.current.delete(transferId);
        activeControlRef.current.delete(transferId);
      }
    }
  }, [startChunkUpload]);

  // Keep a ref to executeTransferSending for use across callbacks
  const executeTransferSendingRef = useRef(executeTransferSending);
  useEffect(() => {
    executeTransferSendingRef.current = executeTransferSending;
  }, [executeTransferSending]);

  useEffect(() => {
    // Setup WebRTC receiver callbacks
    webrtcManager.setCallbacks(
      (update) => {
        setTransfers((prev) =>
          prev.map((t) => {
            if (t.transfer_id === update.transfer_id) {
              const speed = update.speed_bps;
              const totalSize = t.total_size > 0 ? t.total_size : update.total_size;
              const remaining = Math.max(0, totalSize - update.bytes_transferred);
              const eta = update.eta_seconds !== undefined && update.eta_seconds !== null
                ? update.eta_seconds
                : (speed > 1024 ? Math.round(remaining / speed) : null);

              return {
                ...t,
                bytes_transferred: update.bytes_transferred,
                progress_percentage: update.progress_percentage,
                speed_bps: speed,
                eta_seconds: eta,
                transport: 'webrtc',
              };
            }
            return t;
          })
        );
      },
      (transfer_id, file_id, filename, relative_path, blob, verified) => {
        if (!verified) {
          console.error(`[WebRTC] Incomplete/truncated file received for transfer ${transfer_id} (${filename})`);
          setTransfers((prev) =>
            prev.map((t) =>
              t.transfer_id === transfer_id
                ? {
                    ...t,
                    status: 'failed',
                    error_message: `Transfer incomplete: received truncated file (${formatBytes(blob.size)} of ${formatBytes(t.total_size)}). Try transferring via HTTP Relay.`,
                  }
                : t
            )
          );
          return;
        }

        // Store received file in memory so the user can choose when to save it
        const objectUrl = URL.createObjectURL(blob);
        webrtcReceivedFiles.set(`${transfer_id}:${file_id}`, { blob, filename, objectUrl });

        // Multi-file tracking: check if all files of the transfer have arrived
        let fileSet = receivedFilesByTransferRef.current.get(transfer_id);
        if (!fileSet) {
          fileSet = new Set();
          receivedFilesByTransferRef.current.set(transfer_id, fileSet);
        }
        fileSet.add(file_id);

        setTransfers((prev) => {
          const currentTransfer = prev.find((t) => t.transfer_id === transfer_id);
          const totalFiles = currentTransfer?.files?.length || 1;
          const allCompleted = fileSet!.size >= totalFiles;

          if (allCompleted) {
            // Notify backend that WebRTC receiver finished file download only once per transfer
            api.completeTransfer(transfer_id, 'webrtc').catch((err) => {
              console.warn('[WebRTC] Error notifying completeTransfer:', err);
            });

            // Single completion notification for the whole folder/batch
            if (onNotificationRef.current && !completedNotifiedTransfersRef.current.has(transfer_id)) {
              completedNotifiedTransfersRef.current.add(transfer_id);
              const summary = currentTransfer?.is_folder
                ? `Folder "${currentTransfer.root_name || 'Folder'}" (${totalFiles} files) saved successfully`
                : `${filename} saved successfully`;
              onNotificationRef.current('Transfer Complete ✓ (WebRTC P2P)', summary);
            }
          }

          return prev.map((t) => {
            if (t.transfer_id === transfer_id) {
              return {
                ...t,
                status: allCompleted ? 'completed' : t.status,
                progress_percentage: allCompleted ? 100 : t.progress_percentage,
                speed_bps: allCompleted ? 0 : t.speed_bps,
                eta_seconds: allCompleted ? 0 : t.eta_seconds,
                transport: 'webrtc',
              };
            }
            return t;
          });
        });
      }
    );

    refreshTransfers();

    const unsubCreated = wsClient.on('transfer_created', (data) => {
      if (data.transfer) {
        const item = normalizeTransfer(data.transfer);
        setTransfers((prev) => {
          const exists = prev.some((t) => t.transfer_id === item.transfer_id);
          return exists ? prev.map((t) => (t.transfer_id === item.transfer_id ? item : t)) : [item, ...prev];
        });
      }
    });

    const unsubRequested = wsClient.on('transfer_requested', (data) => {
      if (data.transfer) {
        const item = normalizeTransfer(data.transfer);
        // If this device is the receiver, show acceptance prompt
        if (item.receiver_device_id === localDeviceId) {
          setIncomingTransfer(item);
          if (onNotificationRef.current) {
            onNotificationRef.current(
              `Incoming Transfer from ${item.sender_name}`,
              `${item.files.length} file(s) (${formatBytes(item.total_size)})`
            );
          }
        }
      }
    });

    const unsubProgress = wsClient.on('transfer_progress', (data) => {
      setTransfers((prev) =>
        prev.map((t) => {
          if (t.transfer_id === data.transfer_id) {
            // Never regress state if transfer was already completed on client
            if (t.status === 'completed') return t;

            const isFinished =
              data.status === 'completed' ||
              data.progress_percentage >= 100 ||
              (t.total_size > 0 && data.bytes_transferred >= t.total_size);
            const speed = isFinished ? 0 : (data.speed_bps || 0);
            const remaining = isFinished ? 0 : Math.max(0, (t.total_size || 0) - data.bytes_transferred);
            const eta = isFinished
              ? 0
              : data.eta_seconds !== undefined && data.eta_seconds !== null
              ? data.eta_seconds
              : (speed > 1024 ? Math.round(remaining / speed) : null);
            return {
              ...t,
              bytes_transferred: isFinished ? (t.total_size > 0 ? t.total_size : data.bytes_transferred) : data.bytes_transferred,
              progress_percentage: isFinished ? 100 : data.progress_percentage,
              speed_bps: speed,
              eta_seconds: eta,
              status: isFinished ? 'completed' : data.status,
              transport: data.transport || t.transport || 'http',
            };
          }
          return t;
        })
      );
    });

    const unsubAccepted = wsClient.on('transfer_accepted', async (data) => {
      const transferId = data.transfer_id;
      if (!transferId) return;

      // Duplicate prevention: if this transfer is already actively streaming, ignore
      if (activeSendingTransfersRef.current.has(transferId)) {
        return;
      }

      // If localFilesRef is not yet populated because api.createTransfer HTTP response is resolving,
      // poll briefly for up to 1 second before giving up
      let files = localFilesRef.current.get(transferId);
      if (!files) {
        for (let attempt = 0; attempt < 20; attempt++) {
          await new Promise((r) => setTimeout(r, 50));
          files = localFilesRef.current.get(transferId);
          if (files) break;
        }
      }

      if (!files || files.length === 0) return;

      executeTransferSendingRef.current(transferId, files);
    });

    const unsubUpdated = wsClient.on('transfer_updated', async (data) => {
      if (data.transfer) {
        const item = normalizeTransfer(data.transfer);
        setTransfers((prev) => {
          const exists = prev.some((t) => t.transfer_id === item.transfer_id);
          return exists ? prev.map((t) => (t.transfer_id === item.transfer_id ? item : t)) : [item, ...prev];
        });

        // If this device is the sender and the transfer was just accepted / is transferring,
        // and transmission is not yet running, start streaming now!
        if (
          item.sender_device_id === localDeviceId &&
          item.status === 'transferring' &&
          !activeSendingTransfersRef.current.has(item.transfer_id)
        ) {
          let files = localFilesRef.current.get(item.transfer_id);
          if (!files) {
            for (let attempt = 0; attempt < 20; attempt++) {
              await new Promise((r) => setTimeout(r, 50));
              files = localFilesRef.current.get(item.transfer_id);
              if (files) break;
            }
          }
          if (files && files.length > 0 && !activeSendingTransfersRef.current.has(item.transfer_id)) {
            executeTransferSendingRef.current(item.transfer_id, files);
          }
        }
      }
    });

    const unsubConn = wsClient.on('connection_changed', (data) => {
      if (data?.connected) {
        refreshTransfers();
      }
    });

    const unsubRejected = wsClient.on('transfer_rejected', (data) => {
      const transferId = data.transfer_id;
      activeSendingTransfersRef.current.delete(transferId);
      localFilesRef.current.delete(transferId);
      activeControlRef.current.delete(transferId);
      setTransfers((prev) => prev.filter((t) => t.transfer_id !== transferId));
      if (onNotificationRef.current) {
        onNotificationRef.current('Transfer Declined', 'The recipient declined the transfer request.');
      }
      refreshTransfers();
    });

    const unsubCompleted = wsClient.on('transfer_completed', (data) => {
      const tid = data.transfer_id || data.transfer?.transfer_id;
      let completedItem: TransferItem | null = null;

      if (data.transfer) {
        completedItem = normalizeTransfer(data.transfer);
        setTransfers((prev) => {
          const exists = prev.some((t) => t.transfer_id === completedItem!.transfer_id);
          if (!exists) return [completedItem!, ...prev];
          return prev.map((t) =>
            t.transfer_id === completedItem!.transfer_id
              ? {
                  ...t,
                  ...completedItem!,
                  status: 'completed',
                  progress_percentage: 100,
                  speed_bps: 0,
                  eta_seconds: 0,
                }
              : t
          );
        });
      } else if (tid) {
        setTransfers((prev) =>
          prev.map((t) =>
            t.transfer_id === tid
              ? { ...t, status: 'completed', progress_percentage: 100, speed_bps: 0, eta_seconds: 0 }
              : t
          )
        );
      }

      if (tid && !completedNotifiedTransfersRef.current.has(tid)) {
        completedNotifiedTransfersRef.current.add(tid);
        if (onNotificationRef.current) {
          const item = data.transfer;
          const summary = item?.is_folder
            ? `Folder "${item.root_name || 'Folder'}" (${item.files?.length || 0} files) transferred successfully`
            : (item?.files?.[0]?.filename
                ? `${item.files[0].filename} transferred successfully`
                : 'Files transferred successfully');
          onNotificationRef.current('Transfer Complete ✓', summary);
        }
      }
    });

    const unsubPaused = wsClient.on('transfer_paused', (data) => {
      if (data.transfer) {
        const ctrl = activeControlRef.current.get(data.transfer.transfer_id);
        if (ctrl) ctrl.paused = true;
        refreshTransfers();
      }
    });

    const unsubResumed = wsClient.on('transfer_resumed', (data) => {
      if (data.transfer) {
        const transferId = data.transfer.transfer_id;
        let ctrl = activeControlRef.current.get(transferId);
        if (!ctrl) {
          ctrl = { paused: false, cancelled: false };
          activeControlRef.current.set(transferId, ctrl);
        } else {
          ctrl.paused = false;
        }

        // If this device is the sender and the transfer loop is not actively running, resume it
        const files = localFilesRef.current.get(transferId);
        if (files && !activeSendingTransfersRef.current.has(transferId)) {
          executeTransferSendingRef.current(transferId, files);
        }

        refreshTransfers();
      }
    });

    const unsubCancelled = wsClient.on('transfer_cancelled', (data) => {
      if (data.transfer) {
        const ctrl = activeControlRef.current.get(data.transfer.transfer_id);
        if (ctrl) ctrl.cancelled = true;
        activeSendingTransfersRef.current.delete(data.transfer.transfer_id);
        localFilesRef.current.delete(data.transfer.transfer_id);
        refreshTransfers();
      }
    });

    const unsubDeleted = wsClient.on('transfer_deleted', (data) => {
      if (data.transfer_id) {
        activeSendingTransfersRef.current.delete(data.transfer_id);
        localFilesRef.current.delete(data.transfer_id);
        activeControlRef.current.delete(data.transfer_id);
        setTransfers((prev) => prev.filter((t) => t.transfer_id !== data.transfer_id));
      }
    });

    return () => {
      unsubCreated();
      unsubRequested();
      unsubProgress();
      unsubAccepted();
      unsubUpdated();
      unsubConn();
      unsubRejected();
      unsubCompleted();
      unsubPaused();
      unsubResumed();
      unsubCancelled();
      unsubDeleted();
    };
  }, [localDeviceId, refreshTransfers, normalizeTransfer]);

  // Initiate sending files/folder to a peer
  const sendFiles = async (
    files: Array<{ file: File; relativePath: string }>,
    targetDevice: DeviceInfo,
    isFolder: boolean,
    rootName: string
  ) => {
    setIsSending(true);
    try {
      // 1. Prepare metadata & hashes
      const preparedFiles = [];
      const fileMappings = [];

      for (let i = 0; i < files.length; i++) {
        const item = files[i];
        const fileId = `file_${i}_${Date.now()}`;
        const { file: resolvedFile, size: actualSize } = await getResolvedFileAndSize(item.file);
        const hash = await calculateFileSHA256(resolvedFile);

        preparedFiles.push({
          file_id: fileId,
          filename: resolvedFile.name,
          relative_path: item.relativePath || resolvedFile.name,
          size: actualSize,
          sha256: hash,
        });

        fileMappings.push({
          fileObj: resolvedFile,
          fileId: fileId,
          relativePath: item.relativePath || resolvedFile.name,
          sha256: hash,
          targetDeviceId: targetDevice.device_id,
        });
      }

      // Verify that files are not 0 bytes
      const totalDeclaredSize = preparedFiles.reduce((acc, f) => acc + f.size, 0);
      if (totalDeclaredSize === 0 && files.length > 0) {
        throw new Error('Selected file is 0 bytes (empty or cloud placeholder). If stored in Google Drive or iCloud, please download locally before sending.');
      }

      // 2. Request transfer session from backend
      const engineConfig = getTransferConfig();
      const session = await api.createTransfer({
        sender_device_id: localDevice.device_id,
        sender_name: localDevice.device_name,
        receiver_device_id: targetDevice.device_id,
        is_folder: isFolder,
        root_name: rootName,
        chunk_size: engineConfig.chunkSize,
        files: preparedFiles,
      });

      // 3. Cache local files & controls immediately
      localFilesRef.current.set(session.transfer_id, fileMappings);
      activeControlRef.current.set(session.transfer_id, { paused: false, cancelled: false });

      const normalizedSession = normalizeTransfer(session);

      // Immediate optimistic update
      setTransfers((prev) => {
        const exists = prev.some((t) => t.transfer_id === session.transfer_id);
        return exists ? prev.map((t) => (t.transfer_id === session.transfer_id ? normalizedSession : t)) : [normalizedSession, ...prev];
      });

      // If backend auto-accepted the transfer immediately (trusted device or auto-approval active),
      // start transmission immediately without waiting for websocket race
      if (session.status === 'transferring') {
        executeTransferSendingRef.current(session.transfer_id, fileMappings);
      } else {
        // If waiting for acceptance, start an active acceptance polling watchdog.
        // Checks every 1s for up to 5 minutes so mobile senders never stall even if WebSockets drop/reconnect!
        const tid = session.transfer_id;
        let pollCount = 0;
        const pollTimer = setInterval(async () => {
          pollCount++;
          const ctrl = activeControlRef.current.get(tid);
          if (ctrl?.cancelled || activeSendingTransfersRef.current.has(tid) || pollCount > 300) {
            clearInterval(pollTimer);
            return;
          }
          try {
            const current = await api.getTransfer(tid);
            if (current.status === 'transferring') {
              clearInterval(pollTimer);
              const files = localFilesRef.current.get(tid);
              if (files && files.length > 0 && !activeSendingTransfersRef.current.has(tid)) {
                executeTransferSendingRef.current(tid, files);
              }
            } else if (current.status === 'cancelled' || current.status === 'completed' || current.status === 'failed') {
              clearInterval(pollTimer);
            }
          } catch {
            // Keep polling across temporary network glitches or brief fetch errors
          }
        }, 1000);
      }

      return normalizedSession;
    } finally {
      setIsSending(false);
    }
  };

  // User Actions
  const acceptIncoming = async (transferId: string, trustDevice = false) => {
    try {
      const currentIncoming = incomingTransfer;
      await api.acceptTransfer(transferId, trustDevice);
      if (trustDevice && currentIncoming?.sender_device_id) {
        try {
          await api.addTrustedDevice({
            device_id: currentIncoming.sender_device_id,
            device_name: currentIncoming.sender_name || 'Trusted Device',
          });
        } catch {}
      }
      setIncomingTransfer(null);
      refreshTransfers();
    } catch (e) {
      console.error('Failed to accept transfer:', e);
    }
  };

  const rejectIncoming = async (transferId: string) => {
    try {
      setIncomingTransfer(null);
      setTransfers((prev) => prev.filter((t) => t.transfer_id !== transferId));
      await api.rejectTransfer(transferId).catch(() => {});
      await api.deleteTransfer(transferId).catch(() => {});
      refreshTransfers();
    } catch (e) {
      console.error('Failed to reject transfer:', e);
    }
  };

  const pauseTransfer = async (transferId: string) => {
    // 1. Immediately signal pause locally
    const ctrl = activeControlRef.current.get(transferId);
    if (ctrl) {
      ctrl.paused = true;
    }
    // 2. Optimistic UI update
    setTransfers((prev) =>
      prev.map((t) => (t.transfer_id === transferId ? { ...t, status: 'paused' } : t))
    );
    try {
      await api.pauseTransfer(transferId);
    } catch (e) {
      console.error('Failed to pause transfer:', e);
    }
    refreshTransfers();
  };

  const resumeTransfer = async (transferId: string) => {
    // 1. Optimistic UI update
    setTransfers((prev) =>
      prev.map((t) => (t.transfer_id === transferId ? { ...t, status: 'transferring' } : t))
    );

    // 2. Notify backend first so session status is active before chunks are sent
    try {
      await api.resumeTransfer(transferId);
    } catch (e) {
      console.warn('Backend resume transfer response:', e);
    }

    // 3. Unpause local control flag
    let ctrl = activeControlRef.current.get(transferId);
    if (!ctrl) {
      ctrl = { paused: false, cancelled: false };
      activeControlRef.current.set(transferId, ctrl);
    } else {
      ctrl.paused = false;
    }

    // 4. Restart transfer streaming if not already running in background
    const files = localFilesRef.current.get(transferId);
    if (files && !activeSendingTransfersRef.current.has(transferId)) {
      executeTransferSendingRef.current(transferId, files);
    }

    refreshTransfers();
  };

  const cancelTransfer = async (transferId: string) => {
    // 1. Immediately abort running loops
    const ctrl = activeControlRef.current.get(transferId);
    if (ctrl) {
      ctrl.cancelled = true;
    }
    activeSendingTransfersRef.current.delete(transferId);
    localFilesRef.current.delete(transferId);
    activeControlRef.current.delete(transferId);

    // Free memory for any WebRTC blobs and object URLs associated with this transfer
    for (const [key, value] of webrtcReceivedFiles.entries()) {
      if (key.startsWith(`${transferId}:`)) {
        try {
          URL.revokeObjectURL(value.objectUrl);
        } catch {}
        webrtcReceivedFiles.delete(key);
      }
    }

    // 2. Immediate optimistic update in UI
    setTransfers((prev) =>
      prev.map((t) =>
        t.transfer_id === transferId
          ? { ...t, status: 'cancelled', error_message: 'Cancelled by user' }
          : t
      )
    );

    // 3. Notify backend
    try {
      await api.cancelTransfer(transferId);
    } catch (e) {
      console.error('Failed to cancel transfer:', e);
    }
    refreshTransfers();
  };

  const deleteTransfer = async (transferId: string) => {
    // 1. Abort any active sending
    const ctrl = activeControlRef.current.get(transferId);
    if (ctrl) {
      ctrl.cancelled = true;
    }
    activeSendingTransfersRef.current.delete(transferId);
    localFilesRef.current.delete(transferId);
    activeControlRef.current.delete(transferId);

    // Free memory for any WebRTC blobs and object URLs associated with this transfer
    for (const [key, value] of webrtcReceivedFiles.entries()) {
      if (key.startsWith(`${transferId}:`)) {
        try {
          URL.revokeObjectURL(value.objectUrl);
        } catch {}
        webrtcReceivedFiles.delete(key);
      }
    }

    // 2. Immediate removal from UI
    setTransfers((prev) => prev.filter((t) => t.transfer_id !== transferId));

    // 3. Notify backend
    try {
      await api.deleteTransfer(transferId);
    } catch (e) {
      console.error('Failed to delete transfer:', e);
    }
  };

  return {
    transfers,
    incomingTransfer,
    isSending,
    sendFiles,
    acceptIncoming,
    rejectIncoming,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
    deleteTransfer,
    refreshTransfers,
  };
}
