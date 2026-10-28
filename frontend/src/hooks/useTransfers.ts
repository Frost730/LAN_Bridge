import { useState, useEffect, useRef, useCallback } from 'react';
import { TransferItem, DeviceInfo } from '../types';
import { api } from '../services/api';
import { wsClient } from '../services/websocket';
import { calculateFileSHA256 } from '../utils/hashing';
import { webrtcManager } from '../services/webrtc';
import { getTransferConfig } from '../utils/transferSettings';
import { SpeedCalculator } from '../utils/speed';
import { formatBytes } from '../utils/formatters';

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
      const sanitized = list.map((raw) => {
        const t = normalizeTransfer(raw);
        // If this device was the sender and transfer is still marked transferring with 0 bytes,
        // but local files are no longer in RAM (e.g. after a page reload), mark it cancelled.
        if (
          t.status === 'transferring' &&
          t.bytes_transferred === 0 &&
          t.sender_device_id === localDeviceId &&
          !activeSendingTransfersRef.current.has(t.transfer_id) &&
          !localFilesRef.current.has(t.transfer_id)
        ) {
          api.cancelTransfer(t.transfer_id).catch(() => {});
          return { ...t, status: 'cancelled' as const, error_message: 'Session disconnected by page reload' };
        }
        return t;
      });
      setTransfers(sanitized);
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

    // Upload single file sequentially in chunks
    const uploadSingleFile = async (item: { fileObj: File; fileId: string; relativePath: string }) => {
      if (ctrl.cancelled) return;

      const file = item.fileObj;
      const totalSize = file.size;
      const totalChunks = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE));

      // Query server for already-received chunks (essential for RESUME capability!)
      let receivedChunks: Set<number> | null = null;
      try {
        const serverStatus = await api.getTransfer(transferId);
        const serverFile = serverStatus.files.find((f) => f.file_id === item.fileId);
        if (serverFile && Array.isArray(serverFile.chunks_received) && serverFile.chunks_received.length > 0) {
          receivedChunks = new Set(serverFile.chunks_received);
        } else if (serverFile && serverFile.bytes_received === 0) {
          receivedChunks = new Set();
        }
      } catch {
        // Fallback to sending all chunks
      }

      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        // Check cancellation
        if (ctrl.cancelled) break;

        // Check pause state: loop wait
        while (ctrl.paused && !ctrl.cancelled) {
          await new Promise((r) => setTimeout(r, 200));
        }
        if (ctrl.cancelled) break;

        // If this chunk was ALREADY received on the server, skip it!
        if (receivedChunks && receivedChunks.has(chunkIdx)) {
          continue;
        }

        const offset = chunkIdx * CHUNK_SIZE;
        const end = Math.min(totalSize, offset + CHUNK_SIZE);
        const chunkBlob = file.slice(offset, end);

        let chunkSuccess = false;
        let lastErrMsg = '';

        for (let attempt = 1; attempt <= 3; attempt++) {
          if (ctrl.cancelled) break;
          try {
            await api.uploadChunk(transferId, item.fileId, chunkIdx, offset, chunkBlob);
            chunkSuccess = true;
            break;
          } catch (err: any) {
            lastErrMsg = String(err?.message || '');
            console.warn(`Chunk ${chunkIdx} upload failed (attempt ${attempt}/3):`, lastErrMsg);
            if (ctrl.cancelled) break;
            if (
              lastErrMsg.includes('507') ||
              lastErrMsg.includes('storage full') ||
              lastErrMsg.includes('disk full') ||
              lastErrMsg.includes('No space')
            ) {
              ctrl.cancelled = true;
              break;
            }
            if (attempt < 3) {
              await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
          }
        }

        if (!chunkSuccess) {
          hasUploadErrors = true;
          ctrl.cancelled = true;
          const failureMessage =
            lastErrMsg.includes('507') ||
            lastErrMsg.includes('storage full') ||
            lastErrMsg.includes('disk full') ||
            lastErrMsg.includes('No space')
              ? 'Server storage limit reached on cloud container. For files > 500MB, use WebRTC or same Wi-Fi.'
              : `Upload failed at chunk ${chunkIdx + 1} (${file.name}): connection interrupted`;

          setTransfers((prev) =>
            prev.map((t) =>
              t.transfer_id === transferId
                ? {
                    ...t,
                    status: 'failed',
                    error_message: failureMessage,
                  }
                : t
            )
          );
          break;
        }
      }
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
      try {
        await api.completeTransfer(transferId, 'http');
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

    try {
      // 1. Try WebRTC P2P DataChannel connection first (12s timeout for mobile/cross-network ICE gathering)
      let webrtcSuccess = false;
      try {
        const channel = await webrtcManager.connectToPeer(targetDeviceId, 12000);
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
          }
          return;
        }
      } catch (err) {
        console.log('[Transport] WebRTC P2P skipped or timed out, seamlessly using HTTP streaming');
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
      localFilesRef.current.delete(transferId);
      activeControlRef.current.delete(transferId);
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
      (transfer_id, file_id, filename, relative_path, blob) => {
        // Trigger browser save / download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60000);

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
            const speed = data.speed_bps || 0;
            const remaining = Math.max(0, (t.total_size || 0) - data.bytes_transferred);
            const eta = data.eta_seconds !== undefined && data.eta_seconds !== null
              ? data.eta_seconds
              : (speed > 1024 ? Math.round(remaining / speed) : null);
            return {
              ...t,
              bytes_transferred: data.bytes_transferred,
              progress_percentage: data.progress_percentage,
              speed_bps: speed,
              eta_seconds: eta,
              status: data.status,
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
      refreshTransfers();
      const tid = data.transfer_id || data.transfer?.transfer_id;
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
        const ctrl = activeControlRef.current.get(data.transfer.transfer_id);
        if (ctrl) ctrl.paused = false;
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
        const hash = await calculateFileSHA256(item.file);

        preparedFiles.push({
          file_id: fileId,
          filename: item.file.name,
          relative_path: item.relativePath || item.file.name,
          size: item.file.size,
          sha256: hash,
        });

        fileMappings.push({
          fileObj: item.file,
          fileId: fileId,
          relativePath: item.relativePath || item.file.name,
          sha256: hash,
          targetDeviceId: targetDevice.device_id,
        });
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
    // 1. Unpause local control
    const ctrl = activeControlRef.current.get(transferId);
    if (ctrl) {
      ctrl.paused = false;
    }
    // 2. Optimistic UI update
    setTransfers((prev) =>
      prev.map((t) => (t.transfer_id === transferId ? { ...t, status: 'transferring' } : t))
    );
    try {
      await api.resumeTransfer(transferId);
      const files = localFilesRef.current.get(transferId);
      if (files && !activeSendingTransfersRef.current.has(transferId)) {
        startChunkUpload(transferId, files);
      }
    } catch (e) {
      console.error('Failed to resume transfer:', e);
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
