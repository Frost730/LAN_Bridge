import React, { useState, useEffect } from 'react';
import { Clock, ArrowUpRight, ArrowDownLeft, Trash2, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import { HistoryItem, DeviceInfo } from '../types';
import { EmptyState } from '../components/EmptyState';
import { api } from '../services/api';
import { formatBytes, formatTimestamp } from '../utils/formatters';

interface HistoryPageProps {
  localDevice?: DeviceInfo;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ localDevice }) => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = async () => {
    try {
      const items = await api.getHistory(localDevice?.device_id);
      setHistory(items);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleClearHistory = async () => {
    if (window.confirm('Are you sure you want to clear transfer history?')) {
      try {
        await api.clearHistory();
        setHistory([]);
      } catch (e) {
        console.error('Failed to clear history:', e);
      }
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Transfer History
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Log of completed and past local file transfers.
          </p>
        </div>

        {history.length > 0 && (
          <button
            onClick={handleClearHistory}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold self-start sm:self-auto transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear History</span>
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No transfer history"
          description="Transfers completed on this network will be recorded here."
        />
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800/80 shadow-sm">
          {history.map((item) => (
            <div key={item.id} className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center space-x-3.5 min-w-0 flex-1">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    item.direction === 'sent'
                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400'
                      : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
                  }`}
                >
                  {item.direction === 'sent' ? (
                    <ArrowUpRight className="w-4 h-4" />
                  ) : (
                    <ArrowDownLeft className="w-4 h-4" />
                  )}
                </div>

                <div className="truncate">
                  <h4 className="font-semibold text-xs text-slate-900 dark:text-white truncate">
                    {item.filename}
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    <span className="capitalize">{item.direction}</span> {item.direction === 'sent' ? 'to' : 'from'}{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">{item.device_name}</span> •{' '}
                    {formatBytes(item.size)}
                  </p>
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="flex items-center justify-end space-x-1 text-xs">
                  {item.result === 'completed' ? (
                    <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                      Completed
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-rose-500 font-medium text-[11px]">
                      <XCircle className="w-3.5 h-3.5 mr-1" />
                      {item.result}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {formatTimestamp(item.timestamp)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
