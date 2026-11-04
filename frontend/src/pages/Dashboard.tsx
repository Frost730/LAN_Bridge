import React, { useState, useMemo } from 'react';
import { Dropzone } from '../components/Dropzone';
import { DeviceCard } from '../components/DeviceCard';
import { TransferCard } from '../components/TransferCard';
import { EmptyState } from '../components/EmptyState';
import { FileListModal } from '../components/FileListModal';
import { DeviceInfo, TransferItem } from '../types';
import { Users, ArrowLeftRight, QrCode, Sparkles, Link2, Check, LogOut } from 'lucide-react';

interface DashboardProps {
  localDevice: DeviceInfo;
  onlineDevices: DeviceInfo[];
  transfers: TransferItem[];
  currentRoom?: string | null;
  onSendFiles: (
    files: Array<{ file: File; relativePath: string }>,
    targetDevice: DeviceInfo,
    isFolder: boolean,
    rootName: string
  ) => void;
  onPauseTransfer: (id: string) => void;
  onResumeTransfer: (id: string) => void;
  onCancelTransfer: (id: string) => void;
  onDeleteTransfer?: (id: string) => void;
  onOpenConnect: (tab?: 'room' | 'host' | 'join') => void;
  onLeaveRoom?: () => void;
  onChatWithDevice?: (device: DeviceInfo) => void;
  onNavigateTab: (tab: any) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  localDevice,
  onlineDevices,
  transfers,
  currentRoom,
  onSendFiles,
  onPauseTransfer,
  onResumeTransfer,
  onCancelTransfer,
  onDeleteTransfer,
  onOpenConnect,
  onLeaveRoom,
  onChatWithDevice,
  onNavigateTab,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<Array<{ file: File; relativePath: string }> | null>(null);
  const [isFolder, setIsFolder] = useState(false);
  const [rootName, setRootName] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copiedRoomLink, setCopiedRoomLink] = useState(false);

  const handleCopyRoomLink = () => {
    if (!currentRoom) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(currentRoom)}`;
    navigator.clipboard.writeText(url);
    setCopiedRoomLink(true);
    setTimeout(() => setCopiedRoomLink(false), 2000);
  };

  const handleFilesSelected = (
    files: Array<{ file: File; relativePath: string }>,
    folder: boolean,
    name: string
  ) => {
    setSelectedFiles(files);
    setIsFolder(folder);
    setRootName(name);
  };

  const handleConfirmSend = async (targetDevice: DeviceInfo) => {
    if (!selectedFiles || selectedFiles.length === 0) return;
    setIsSending(true);
    try {
      await onSendFiles(selectedFiles, targetDevice, isFolder, rootName);
      setSelectedFiles(null);
    } finally {
      setIsSending(false);
    }
  };

  const activeTransfers = useMemo(
    () =>
      transfers.filter(
        (t) =>
          t.status === 'transferring' ||
          t.status === 'paused' ||
          t.status === 'waiting_for_acceptance' ||
          t.status === 'queued'
      ),
    [transfers]
  );
  const recentTransfers = useMemo(
    () =>
      transfers
        .filter((t) => !(t.status === 'cancelled' && t.bytes_transferred === 0))
        .slice(0, 5),
    [transfers]
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Hero Dropzone Section */}
      <section>
        <Dropzone onFilesSelected={handleFilesSelected} />
      </section>

      {/* Active Room Banner */}
      {currentRoom && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-xs">
          <div className="flex items-center space-x-2.5 w-full sm:w-auto">
            <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>Room: <strong className="font-mono text-purple-600 dark:text-purple-400">{currentRoom}</strong></span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Cross-network group sharing active. Devices outside this room cannot see you.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={handleCopyRoomLink}
              className="py-1.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs flex items-center space-x-1 shadow-sm transition-all"
            >
              {copiedRoomLink ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Link2 className="w-3.5 h-3.5" />}
              <span>{copiedRoomLink ? 'Link Copied!' : 'Copy Invite Link'}</span>
            </button>
            {onLeaveRoom && (
              <button
                onClick={onLeaveRoom}
                className="py-1.5 px-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-medium text-xs flex items-center space-x-1 transition-colors"
                title="Leave room and return to standard local Wi-Fi discovery"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Leave</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Grid: Nearby Devices & Current Transfers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Nearby Devices */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {currentRoom ? `Room Devices (${onlineDevices.length})` : `Nearby Devices (${onlineDevices.length})`}
              </h2>
            </div>
            <button
              onClick={() => onOpenConnect(currentRoom ? 'room' : 'host')}
              className="flex items-center space-x-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 hover:underline"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>{currentRoom ? 'Room / Pair' : 'Pair New Device'}</span>
            </button>
          </div>

          {onlineDevices.length === 0 ? (
            <EmptyState
              icon={Users}
              title={currentRoom ? 'No one else in this room yet' : 'No devices connected'}
              description={
                currentRoom
                  ? 'Share your room invite link with friends or colleagues so they can join this room from anywhere.'
                  : 'Open LANBridge in a browser on your phone, laptop, or tablet on the same Wi-Fi to start transferring.'
              }
              actionText={currentRoom ? 'Copy Room Link' : 'Pair Device'}
              onAction={currentRoom ? handleCopyRoomLink : () => onOpenConnect('host')}
            />
          ) : (
            <div className="space-y-3">
              {onlineDevices.map((device) => (
                <DeviceCard
                  key={device.device_id}
                  device={device}
                  onChatWithDevice={onChatWithDevice}
                  onSendToDevice={(d) => {
                    // Trigger native file picker for direct sending
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.multiple = true;
                    input.onchange = (e: any) => {
                      const fList = e.target.files;
                      if (!fList || fList.length === 0) return;
                      const arr = [];
                      for (let i = 0; i < fList.length; i++) {
                        arr.push({ file: fList[i], relativePath: fList[i].name });
                      }
                      handleFilesSelected(arr, false, arr.length === 1 ? arr[0].file.name : `${arr.length} Files`);
                    };
                    input.click();
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* Transfers Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ArrowLeftRight className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Transfers {activeTransfers.length > 0 && `(${activeTransfers.length} Active)`}
              </h2>
            </div>
            {transfers.length > 5 && (
              <button
                onClick={() => onNavigateTab('transfers')}
                className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline"
              >
                View All
              </button>
            )}
          </div>

          {transfers.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No transfers yet"
              description="Files you send or receive across your local network will appear here with live speed, progress, and SHA-256 verification."
            />
          ) : (
            <div className="space-y-3">
              {recentTransfers.map((transfer) => (
                <TransferCard
                  key={transfer.transfer_id}
                  transfer={transfer}
                  onPause={onPauseTransfer}
                  onResume={onResumeTransfer}
                  onCancel={onCancelTransfer}
                  onDelete={onDeleteTransfer}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Selected Files Modal */}
      {selectedFiles && (
        <FileListModal
          files={selectedFiles}
          isFolder={isFolder}
          rootName={rootName}
          onlineDevices={onlineDevices}
          onClose={() => setSelectedFiles(null)}
          onSend={handleConfirmSend}
          isSending={isSending}
        />
      )}
    </div>
  );
};
