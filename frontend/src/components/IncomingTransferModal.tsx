import React from 'react';
import { DownloadCloud, Check, X, Folder, File, AlertTriangle, ShieldCheck } from 'lucide-react';
import { TransferItem } from '../types';
import { formatBytes } from '../utils/formatters';

interface IncomingTransferModalProps {
  transfer: TransferItem;
  onAccept: (transferId: string, trustDevice?: boolean) => void;
  onReject: (transferId: string) => void;
}

export const IncomingTransferModal: React.FC<IncomingTransferModalProps> = ({
  transfer,
  onAccept,
  onReject,
}) => {
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [trustDevice, setTrustDevice] = React.useState(false);

  const handleAccept = () => {
    if (isProcessing) return;
    setIsProcessing(true);
    onAccept(transfer.transfer_id, trustDevice);
  };

  const handleReject = () => {
    if (isProcessing) return;
    setIsProcessing(true);
    onReject(transfer.transfer_id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-md w-full p-6 pb-safe sm:pb-6 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col">
        {/* Mobile Drag Indicator Handle */}
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-3 sm:hidden shrink-0" />

        {/* Icon & Title */}
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400 flex items-center justify-center shadow-inner shrink-0">
            <DownloadCloud className="w-6 h-6 animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white truncate">
              Incoming Transfer
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              From <span className="font-semibold text-brand-600 dark:text-brand-400">{transfer.sender_name}</span>
            </p>
          </div>
        </div>

        {/* Files Summary */}
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-100 dark:border-slate-700/60 mb-5">
          <div className="flex justify-between items-center text-xs font-semibold text-slate-700 dark:text-slate-300 pb-2 border-b border-slate-200 dark:border-slate-700">
            <span>{transfer.is_folder ? 'Folder Contents' : 'Files'}</span>
            <span className="text-slate-900 dark:text-white font-bold">{formatBytes(transfer.total_size)}</span>
          </div>

          <div className="mt-2.5 max-h-36 sm:max-h-40 overflow-y-auto space-y-1.5 pr-1">
            {transfer.files.map((file, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                <div className="flex items-center space-x-2 truncate mr-2">
                  {transfer.is_folder ? (
                    <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <File className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                  )}
                  <span className="truncate">{file.relative_path || file.filename}</span>
                </div>
                <span className="text-[11px] text-slate-400 shrink-0">{formatBytes(file.size)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Trust Device Option */}
        <label className="flex items-center space-x-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 cursor-pointer select-none mb-4 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={(e) => setTrustDevice(e.target.checked)}
            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300 dark:border-slate-600 accent-brand-600 cursor-pointer shrink-0"
          />
          <div className="flex items-center space-x-1.5 text-xs text-slate-700 dark:text-slate-300 font-medium min-w-0">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="truncate">Trust this device (auto-accept future transfers)</span>
          </div>
        </label>

        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center mb-5">
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-amber-500 shrink-0" />
          <span>Direct transfer over Wi-Fi / Ethernet</span>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={isProcessing}
            onClick={handleReject}
            className="flex items-center justify-center space-x-2 px-4 py-3 min-h-[48px] rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold transition-all select-none active:scale-[0.98] disabled:opacity-50"
          >
            <X className="w-4 h-4 text-rose-500" />
            <span>Reject</span>
          </button>

          <button
            type="button"
            disabled={isProcessing}
            onClick={handleAccept}
            className="flex items-center justify-center space-x-2 px-4 py-3 min-h-[48px] rounded-xl bg-brand-600 hover:bg-brand-500 active:scale-[0.98] disabled:opacity-50 text-white text-sm font-semibold shadow-md shadow-brand-500/25 transition-all select-none"
          >
            {isProcessing ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Accept</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
