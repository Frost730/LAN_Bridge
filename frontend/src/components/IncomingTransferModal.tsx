import React from 'react';
import { DownloadCloud, Check, X, Folder, File, AlertTriangle } from 'lucide-react';
import { TransferItem } from '../types';
import { formatBytes } from '../utils/formatters';

interface IncomingTransferModalProps {
  transfer: TransferItem;
  onAccept: (transferId: string) => void;
  onReject: (transferId: string) => void;
}

export const IncomingTransferModal: React.FC<IncomingTransferModalProps> = ({
  transfer,
  onAccept,
  onReject,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col">
        {/* Icon & Title */}
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-brand-100 dark:bg-brand-900/40 text-brand-600 dark:text-brand-400 flex items-center justify-center shadow-inner">
            <DownloadCloud className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Incoming Transfer
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
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

          <div className="mt-2.5 max-h-40 overflow-y-auto space-y-1.5 pr-1">
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

        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center mb-6">
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-amber-500 shrink-0" />
          Transfer will stream directly over your local Wi-Fi / Ethernet.
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onReject(transfer.transfer_id)}
            className="flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold transition-all"
          >
            <X className="w-4 h-4 text-rose-500" />
            <span>Reject</span>
          </button>

          <button
            type="button"
            onClick={() => onAccept(transfer.transfer_id)}
            className="flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white text-sm font-semibold shadow-md shadow-brand-500/25 transition-all"
          >
            <Check className="w-4 h-4" />
            <span>Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
};
