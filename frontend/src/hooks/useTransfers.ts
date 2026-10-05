import { useState, useEffect, useRef, useCallback } from 'react';
import { TransferItem, DeviceInfo } from '../types';
import { api } from '../services/api';
import { wsClient } from '../services/websocket';
import { calculateFileSHA256 } from '../utils/hashing';

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB

export function useTransfers(localDevice: DeviceInfo, onNotification?: (title: string, body?: string) => void) {
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [incomingTransfer, setIncomingTransfer] = useState<TransferItem | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Map of transferId -> Array of native File objects
  const localFilesRef = useRef<Map<string, { fileObj: File; fileId: string; relativePath: string }[]>>(
    new Map()
  );
  // Transfer state flags for cancellation / pause control
  const activeControlRef = useRef<Map<string, { paused: boolean; cancelled: boolean }>>(new Map());

  // Load existing transfers
  const refreshTransfers = useCallback(async () => {
    try {
      const list = await api.getTransfers();
      setTransfers(list);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
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
        if (data.transfer.receiver_device_id === localDevice.device_id) {
          setIncomingTransfer(data.transfer);
          if (onNotification) {
            onNotification(
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
            return {
              ...t,
              bytes_transferred: data.bytes_transferred,
              progress_percentage: data.progress_percentage,
              speed_bps: data.speed_bps,
              status: data.status,
            };
          }
          return t;
        })
      );
    });

    const unsubAccepted = wsClient.on('transfer_accepted', (data) => {
      const transferId = data.transfer_id;
      // If we have local files stored for this transfer, begin uploading chunks!
      const files = localFilesRef.current.get(transferId);
      if (files) {
        startChunkUpload(transferId, files);
      }
    });

    const unsubRejected = wsClient.on('transfer_rejected', (data) => {
      const transferId = data.transfer_id;
      localFilesRef.current.delete(transferId);
      activeControlRef.current.delete(transferId);
      refreshTransfers();
    });

    const unsubCompleted = wsClient.on('transfer_completed', (data) => {
      refreshTransfers();
      if (onNotification) {
        onNotification('Transfer Complete ✓', 'Files transferred successfully');
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
        refreshTransfers();
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
    };
  }, [localDevice.device_id, onNotification, refreshTransfers]);

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

      // If receiver is host and we are in same browser, acceptance can happen immediately
      setTransfers((prev) => [session, ...prev]);

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

    for (const item of files) {
      if (ctrl.cancelled) break;

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
          await new Promise((r) => setTimeout(r, 500));
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
        } catch (err) {
          console.error(`Error uploading chunk ${chunkIdx} of ${file.name}:`, err);
          // Wait briefly before retrying
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    localFilesRef.current.delete(transferId);
    activeControlRef.current.delete(transferId);
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
    const ctrl = activeControlRef.current.get(transferId);
    if (ctrl) ctrl.paused = true;
    try {
      await api.pauseTransfer(transferId);
      refreshTransfers();
    } catch (e) {
      console.error('Failed to pause transfer:', e);
    }
  };

  const resumeTransfer = async (transferId: string) => {
    const ctrl = activeControlRef.current.get(transferId);
    if (ctrl) ctrl.paused = false;
    try {
      await api.resumeTransfer(transferId);
      const files = localFilesRef.current.get(transferId);
      if (files) {
        startChunkUpload(transferId, files);
      }
      refreshTransfers();
    } catch (e) {
      console.error('Failed to resume transfer:', e);
    }
  };

  const cancelTransfer = async (transferId: string) => {
    const ctrl = activeControlRef.current.get(transferId);
    if (ctrl) ctrl.cancelled = true;
    localFilesRef.current.delete(transferId);
    activeControlRef.current.delete(transferId);
    try {
      await api.cancelTransfer(transferId);
      refreshTransfers();
    } catch (e) {
      console.error('Failed to cancel transfer:', e);
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
    refreshTransfers,
  };
}
