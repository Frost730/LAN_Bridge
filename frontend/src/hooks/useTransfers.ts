import { useState, useEffect, useRef, useCallback } from 'react';
import { TransferItem, DeviceInfo } from '../types';
import { api } from '../services/api';
import { wsClient } from '../services/websocket';
import { calculateFileSHA256 } from '../utils/hashing';
import { webrtcManager } from '../services/webrtc';
import { getTransferConfig } from '../utils/transferSettings';
import { SpeedCalculator } from '../utils/speed';

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

  // Load existing transfers
  const refreshTransfers = useCallback(async () => {
    try {
      const list = await api.getTransfers(localDeviceId);
      setTransfers(list);
    } catch {
      // Ignore
    }
  }, [localDeviceId]);

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
      (transfer_id, file_id, filename, relative_path, blob, sha256_verified) => {
        // Trigger browser save / download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60000);

        setTransfers((prev) =>
          prev.map((t) => {
            if (t.transfer_id === transfer_id) {
              return {
                ...t,
                status: 'completed',
                progress_percentage: 100,
                speed_bps: 0,
                eta_seconds: 0,
                transport: 'webrtc',
              };
            }
            return t;
          })
        );

        if (onNotificationRef.current) {
          onNotificationRef.current('Transfer Complete ✓ (WebRTC P2P)', `${filename} saved successfully`);
        }
      }
    );

    refreshTransfers();

    const unsubCreated = wsClient.on('transfer_created', (data) => {
      if (data.transfer) {
        setTransfers((prev) => {
          const exists = prev.some((t) => t.transfer_id === data.transfer.transfer_id);
          return exists ? prev.map((t) => (t.transfer_id === data.transfer.transfer_id ? data.transfer : t)) : [data.transfer, ...prev];
        });
      }
    });

    const unsubRequested = wsClient.on('transfer_requested', (data) => {
      if (data.transfer) {
        // If this device is the receiver, show acceptance prompt
        if (data.transfer.receiver_device_id === localDeviceId) {
          setIncomingTransfer(data.transfer);
          if (onNotificationRef.current) {
            onNotificationRef.current(
              `Incoming Transfer from ${data.transfer.sender_name}`,
              `${data.transfer.files.length} file(s) (${Math.round(data.transfer.total_size / 1024 / 1024)} MB)`
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

      // Duplicate prevention: if this transfer is already actively streaming, ignore duplicate notifications
      if (activeSendingTransfersRef.current.has(transferId)) {
        return;
      }

      const files = localFilesRef.current.get(transferId);
      if (!files || files.length === 0) return;

      // Mark this transfer as actively transmitting
      activeSendingTransfersRef.current.add(transferId);
      if (!activeControlRef.current.has(transferId)) {
        activeControlRef.current.set(transferId, { paused: false, cancelled: false });
      }

      const targetDeviceId = files[0].targetDeviceId;

      try {
        // 1. Try WebRTC P2P DataChannel connection first
        let webrtcSuccess = false;
        try {
          const channel = await webrtcManager.connectToPeer(targetDeviceId, 2500);
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
                (sentInFile, fileTotal) => {
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
    });

    const unsubRejected = wsClient.on('transfer_rejected', (data) => {
      const transferId = data.transfer_id;
      activeSendingTransfersRef.current.delete(transferId);
      localFilesRef.current.delete(transferId);
      activeControlRef.current.delete(transferId);
      refreshTransfers();
    });

    const unsubCompleted = wsClient.on('transfer_completed', (data) => {
      refreshTransfers();
      if (onNotificationRef.current) {
        onNotificationRef.current('Transfer Complete ✓', 'Files transferred successfully');
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
  }, [localDeviceId, refreshTransfers]);

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
      const session = await api.createTransfer({
        sender_device_id: localDevice.device_id,
        sender_name: localDevice.device_name,
        receiver_device_id: targetDevice.device_id,
        is_folder: isFolder,
        root_name: rootName,
        files: preparedFiles,
      });

      // 3. Cache local files & controls
      localFilesRef.current.set(session.transfer_id, fileMappings);
      activeControlRef.current.set(session.transfer_id, { paused: false, cancelled: false });

      // Immediate optimistic update
      setTransfers((prev) => {
        const exists = prev.some((t) => t.transfer_id === session.transfer_id);
        return exists ? prev : [session, ...prev];
      });

      return session;
    } finally {
      setIsSending(false);
    }
  };

  // Chunk streaming upload engine
  const startChunkUpload = async (
    transferId: string,
    files: { fileObj: File; fileId: string; relativePath: string }[]
  ) => {
    const ctrl = activeControlRef.current.get(transferId) || { paused: false, cancelled: false };
    const engineConfig = getTransferConfig();
    const CHUNK_SIZE = engineConfig.chunkSize;
    const CONCURRENCY = Math.max(1, Math.min(files.length, engineConfig.concurrentTransfers));

    // Upload single file sequentially in chunks
    const uploadSingleFile = async (item: { fileObj: File; fileId: string; relativePath: string }) => {
      if (ctrl.cancelled) return;

      const file = item.fileObj;
      const totalSize = file.size;
      const totalChunks = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE));

      // Query server for missing chunks (essential for RESUME capability!)
      let missingChunks: Set<number> | null = null;
      try {
        const serverStatus = await api.getTransfer(transferId);
        const serverFile = serverStatus.files.find((f) => f.file_id === item.fileId);
        if (serverFile && serverFile.missing_chunks) {
          missingChunks = new Set(serverFile.missing_chunks);
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

        // If resume check shows this chunk is already received by server, skip it!
        if (missingChunks && !missingChunks.has(chunkIdx)) {
          continue;
        }

        const offset = chunkIdx * CHUNK_SIZE;
        const end = Math.min(totalSize, offset + CHUNK_SIZE);
        const chunkBlob = file.slice(offset, end);

        try {
          await api.uploadChunk(transferId, item.fileId, chunkIdx, offset, chunkBlob);
        } catch (err: any) {
          console.error(`Error uploading chunk ${chunkIdx} of ${file.name}:`, err);
          if (ctrl.cancelled) break;
          const msg = String(err?.message || '');
          if (msg.includes('cancelled') || msg.includes('not found') || msg.includes('400')) {
            ctrl.cancelled = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
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

    refreshTransfers();
  };

  // User Actions
  const acceptIncoming = async (transferId: string) => {
    try {
      await api.acceptTransfer(transferId);
      setIncomingTransfer(null);
      refreshTransfers();
    } catch (e) {
      console.error('Failed to accept transfer:', e);
    }
  };

  const rejectIncoming = async (transferId: string) => {
    try {
      await api.rejectTransfer(transferId);
      setIncomingTransfer(null);
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
        activeSendingTransfersRef.current.add(transferId);
        startChunkUpload(transferId, files).finally(() => {
          activeSendingTransfersRef.current.delete(transferId);
        });
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
