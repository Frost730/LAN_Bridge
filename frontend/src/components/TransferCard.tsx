import React from 'react';
import {
  File,
  Folder,
  Pause,
  Play,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Download,
  ShieldCheck,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { TransferItem } from '../types';
import { formatBytes, formatSpeed, formatETA } from '../utils/formatters';

interface TransferCardProps {
  transfer: TransferItem;
  onPause: (transferId: string) => void;
  onResume: (transferId: string) => void;
  onCancel: (transferId: string) => void;
  onDelete?: (transferId: string) => void;
}

export const TransferCard: React.FC<TransferCardProps> = ({
  transfer,
  onPause,
  onResume,
  onCancel,
  onDelete,
}) => {
  const isCompleted = transfer.status === 'completed';
  const isFailed = transfer.status === 'failed';
  const isPaused = transfer.status === 'paused';
  const isTransferring = transfer.status === 'transferring';
  const isVerifying = transfer.status === 'verifying';
  const isWaiting = transfer.status === 'waiting_for_acceptance' || transfer.status === 'queued';

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
      {/* Top Row: File icon, Title, Status & Actions */}
      <div className="flex items-start justify-between gap-2.5 sm:gap-3 mb-3">
        <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0 flex-1">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              isCompleted
                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
                : isFailed
                ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400'
                : isPaused
                ? 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400'
                : 'bg-brand-100 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400'
            }`}
          >
            {transfer.is_folder ? <Folder className="w-5 h-5" /> : <File className="w-5 h-5" />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-2">
              <h4 className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                {transfer.root_name || (transfer.files[0] ? transfer.files[0].filename : 'Transfer')}
              </h4>
              {transfer.transport === 'webrtc' ? (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200 dark:border-amber-800 shrink-0">
                  WebRTC P2P ⚡
                </span>
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shrink-0">
                  HTTP LAN 🚀
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <span className="truncate">
                {transfer.direction === 'sent' ? `To ${transfer.receiver_name}` : `From ${transfer.sender_name}`}
              </span>
              <span>•</span>
              <span>{transfer.files.length} file{transfer.files.length > 1 ? 's' : ''}</span>
              <span>•</span>
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {formatBytes(transfer.bytes_transferred)} / {formatBytes(transfer.total_size)}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1 shrink-0">
          {isTransferring && (
            <button
              onClick={() => onPause(transfer.transfer_id)}
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Pause Transfer"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}

          {isPaused && (
            <button
              onClick={() => onResume(transfer.transfer_id)}
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-brand-600 hover:text-brand-700 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors"
              title="Resume Transfer"
            >
              <Play className="w-4 h-4" />
            </button>
          )}

          {(isTransferring || isPaused || isWaiting) && (
            <button
              onClick={() => onCancel(transfer.transfer_id)}
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              title="Cancel Transfer"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {isCompleted && (
            <a
              href={
                transfer.is_folder || (transfer.files && transfer.files.length > 1)
                  ? `/api/transfers/${transfer.transfer_id}/download-zip`
                  : transfer.files?.[0]?.file_id
                  ? `/api/transfers/${transfer.transfer_id}/files/${transfer.files[0].file_id}/download`
                  : `/api/transfers/${transfer.transfer_id}/download`
              }
              download
              className="flex items-center space-x-1 px-3 py-1.5 min-h-[36px] rounded-lg bg-brand-50 hover:bg-brand-100 dark:bg-brand-950/60 dark:hover:bg-brand-900/60 text-brand-600 dark:text-brand-400 text-xs font-semibold transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save</span>
            </a>
          )}

          {onDelete && (
            <button
              onClick={() => onDelete(transfer.transfer_id)}
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              title="Delete from list"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden mb-2 relative">
        <div
          className={`h-full transition-all duration-300 rounded-full ${
            isCompleted
              ? 'bg-emerald-500'
              : isFailed
              ? 'bg-rose-500'
              : isPaused
              ? 'bg-amber-500'
              : 'bg-brand-500'
          }`}
          style={{ width: `${transfer.progress_percentage}%` }}
        />
      </div>

      {/* Metrics Row: % | Speed | ETA | State */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-bold text-slate-900 dark:text-white">
            {transfer.progress_percentage}%
          </span>
          {isTransferring && (
            <>
              <span>•</span>
              <span className="font-semibold text-brand-600 dark:text-brand-400">
                {formatSpeed(transfer.speed_bps)}
              </span>
              <span>•</span>
              <span className="flex items-center">
                <Clock className="w-3 h-3 mr-1 shrink-0" />
                {formatETA(transfer.eta_seconds)}
              </span>
            </>
          )}
        </div>

        {/* State Badge */}
        <div className="self-start sm:self-auto">
          {isCompleted && (
            <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1 shrink-0" />
              SHA-256 Verified ✓
            </span>
          )}
          {isVerifying && (
            <span className="inline-flex items-center text-brand-600 dark:text-brand-400 animate-pulse font-medium">
              <ShieldCheck className="w-3.5 h-3.5 mr-1 shrink-0" />
              Verifying file integrity...
            </span>
          )}
          {isPaused && (
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              Paused at {transfer.progress_percentage}%
            </span>
          )}
          {isFailed && (
            <span className="inline-flex items-center text-rose-500 font-medium">
              <AlertCircle className="w-3.5 h-3.5 mr-1 shrink-0" />
              {transfer.error_message || 'Transfer failed'}
            </span>
          )}
          {isWaiting && (
            <span className="text-slate-400 dark:text-slate-500 italic">
              Waiting for acceptance...
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
