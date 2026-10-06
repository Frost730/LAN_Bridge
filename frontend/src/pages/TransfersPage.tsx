import React, { useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { TransferItem } from '../types';
import { TransferCard } from '../components/TransferCard';
import { EmptyState } from '../components/EmptyState';

interface TransfersPageProps {
  transfers: TransferItem[];
  onPauseTransfer: (id: string) => void;
  onResumeTransfer: (id: string) => void;
  onCancelTransfer: (id: string) => void;
  onDeleteTransfer?: (id: string) => void;
  onNavigateHome: () => void;
}

export const TransfersPage: React.FC<TransfersPageProps> = ({
  transfers,
  onPauseTransfer,
  onResumeTransfer,
  onCancelTransfer,
  onDeleteTransfer,
  onNavigateHome,
}) => {
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  const filtered = transfers.filter((t) => {
    if (t.status === 'cancelled' && t.bytes_transferred === 0) {
      return false;
    }
    if (filter === 'active') {
      return (
        t.status === 'transferring' ||
        t.status === 'paused' ||
        t.status === 'waiting_for_acceptance' ||
        t.status === 'queued'
      );
    }
    if (filter === 'completed') {
      return t.status === 'completed';
    }
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Transfer Queue & Activity
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time transfer status, speed metrics, and integrity verification.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl self-start sm:self-auto">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === 'all'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            All ({transfers.length})
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === 'active'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Active ({transfers.filter((t) => t.status === 'transferring' || t.status === 'paused').length})
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filter === 'completed'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Completed ({transfers.filter((t) => t.status === 'completed').length})
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No transfers matching this filter"
          description="Drag and drop files on the Home screen to begin a transfer."
          actionText="Go to Home"
          onAction={onNavigateHome}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((transfer) => (
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
    </div>
  );
};
