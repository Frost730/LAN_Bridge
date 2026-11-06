import React, { useState } from 'react';
import { X, File, Folder, Send, Trash2, Smartphone, Monitor, Tablet, Laptop, AlertCircle } from 'lucide-react';
import { DeviceInfo } from '../types';
import { formatBytes } from '../utils/formatters';

interface FileListModalProps {
  files: Array<{ file: File; relativePath: string }>;
  isFolder: boolean;
  rootName: string;
  onlineDevices: DeviceInfo[];
  onClose: () => void;
  onSend: (targetDevice: DeviceInfo) => void;
  isSending: boolean;
}

export const FileListModal: React.FC<FileListModalProps> = ({
  files: initialFiles,
  isFolder,
  rootName,
  onlineDevices,
  onClose,
  onSend,
  isSending,
}) => {
  const [files, setFiles] = useState(initialFiles);
  const [selectedDevice, setSelectedDevice] = useState<DeviceInfo | null>(
    onlineDevices.length > 0 ? onlineDevices[0] : null
  );

  const totalSize = files.reduce((acc, f) => acc + f.file.size, 0);

  const handleRemoveFile = (index: number) => {
    const updated = files.filter((_, i) => i !== index);
    setFiles(updated);
    if (updated.length === 0) {
      onClose();
    }
  };

  const renderDeviceIcon = (type: string) => {
    switch (type) {
      case 'phone':
        return <Smartphone className="w-4 h-4" />;
      case 'tablet':
        return <Tablet className="w-4 h-4" />;
      case 'laptop':
        return <Laptop className="w-4 h-4" />;
      default:
        return <Monitor className="w-4 h-4" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-5 sm:p-6 pb-safe sm:pb-6 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh] sm:max-h-[85vh]">
        {/* Mobile Drag Indicator Handle */}
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-3 sm:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-100 dark:bg-brand-900/50 text-brand-600 flex items-center justify-center shrink-0">
              {isFolder ? <Folder className="w-5 h-5" /> : <File className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                {isFolder ? `Folder: ${rootName}` : 'Selected Files'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {files.length} file{files.length > 1 ? 's' : ''} • Total: {formatBytes(totalSize)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSending}
            className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* File preview list */}
        <div className="flex-1 overflow-y-auto py-3 sm:py-4 space-y-2 max-h-52 sm:max-h-60 pr-1">
          {files.some((f) => f.file.size === 0) && (
            <div className="flex items-start space-x-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs mb-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <span>A file reports 0 bytes. If this file is stored in Google Drive or iCloud, please download/save it to your local device storage first.</span>
            </div>
          )}
          {files.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 text-xs"
            >
              <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-2">
                <File className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="truncate">
                  <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {item.relativePath || item.file.name}
                  </p>
                  <p className={`text-[11px] ${item.file.size === 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-500'}`}>
                    {item.file.size === 0 ? '0 B (Empty / Cloud file)' : formatBytes(item.file.size)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleRemoveFile(idx)}
                disabled={isSending}
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-rose-500 transition-colors rounded-lg"
                title="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Destination device selector */}
        <div className="pt-3 sm:pt-4 border-t border-slate-200 dark:border-slate-800">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
            Send to Device:
          </label>

          {onlineDevices.length === 0 ? (
            <div className="flex items-center space-x-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>No other devices connected to this LANBridge host. Open LANBridge on another device to pair!</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 max-h-36 sm:max-h-44 overflow-y-auto">
              {onlineDevices.map((device) => {
                const isSelected = selectedDevice?.device_id === device.device_id;
                return (
                  <button
                    key={device.device_id}
                    type="button"
                    onClick={() => setSelectedDevice(device)}
                    className={`flex items-center space-x-2.5 p-3 rounded-xl border text-left min-h-[48px] transition-all select-none ${
                      isSelected
                        ? 'border-brand-500 bg-brand-50/80 dark:bg-brand-950/50 text-brand-900 dark:text-brand-100 ring-2 ring-brand-500/20'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-brand-500 shrink-0">{renderDeviceIcon(device.device_type)}</span>
                    <div className="truncate">
                      <p className="font-semibold text-xs truncate">{device.device_name}</p>
                      <p className="text-[10px] text-slate-500">{device.os} • {device.ip_address || 'LAN'}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Action buttons */}
          <div className="grid grid-cols-2 sm:flex sm:items-center sm:justify-end gap-2.5 sm:gap-3 mt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSending}
              className="flex items-center justify-center px-4 py-2.5 min-h-[46px] rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedDevice || files.length === 0 || isSending}
              onClick={() => selectedDevice && onSend(selectedDevice)}
              className="flex items-center justify-center space-x-2 px-6 py-2.5 min-h-[46px] rounded-xl bg-brand-600 hover:bg-brand-500 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-md shadow-brand-500/20 transition-all select-none"
            >
              {isSending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Preparing...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Send</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
