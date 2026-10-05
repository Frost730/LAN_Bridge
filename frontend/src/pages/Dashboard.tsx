import React, { useState } from 'react';
import { Dropzone } from '../components/Dropzone';
import { DeviceCard } from '../components/DeviceCard';
import { TransferCard } from '../components/TransferCard';
import { EmptyState } from '../components/EmptyState';
import { FileListModal } from '../components/FileListModal';
import { DeviceInfo, TransferItem } from '../types';
import { Users, ArrowLeftRight, QrCode, Sparkles } from 'lucide-react';

interface DashboardProps {
  localDevice: DeviceInfo;
  onlineDevices: DeviceInfo[];
  transfers: TransferItem[];
  onSendFiles: (
    files: Array<{ file: File; relativePath: string }>,
    targetDevice: DeviceInfo,
    isFolder: boolean,
    rootName: string
  ) => void;
  onPauseTransfer: (id: string) => void;
  onResumeTransfer: (id: string) => void;
  onCancelTransfer: (id: string) => void;
  onOpenConnect: () => void;
  onNavigateTab: (tab: any) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  localDevice,
  onlineDevices,
  transfers,
  onSendFiles,
  onPauseTransfer,
  onResumeTransfer,
  onCancelTransfer,
  onOpenConnect,
  onNavigateTab,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<Array<{ file: File; relativePath: string }> | null>(null);
  const [isFolder, setIsFolder] = useState(false);
  const [rootName, setRootName] = useState('');
  const [isSending, setIsSending] = useState(false);

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

  const activeTransfers = transfers.filter(
    (t) => t.status === 'transferring' || t.status === 'paused' || t.status === 'waiting_for_acceptance' || t.status === 'queued'
  );
  const recentTransfers = transfers.slice(0, 5);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Hero Dropzone Section */}
      <section>
        <Dropzone onFilesSelected={handleFilesSelected} />
      </section>

      {/* Grid: Nearby Devices & Current Transfers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Nearby Devices */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Nearby Devices ({onlineDevices.length})
              </h2>
            </div>
            <button
              onClick={onOpenConnect}
              className="flex items-center space-x-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:text-brand-700 hover:underline"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Pair New Device</span>
            </button>
          </div>

          {onlineDevices.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No devices connected"
              description="Open LANBridge in a browser on your phone, laptop, or tablet on the same Wi-Fi to start transferring."
              actionText="Pair Device"
              onAction={onOpenConnect}
            />
          ) : (
            <div className="space-y-3">
              {onlineDevices.map((device) => (
                <DeviceCard
                  key={device.device_id}
                  device={device}
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
