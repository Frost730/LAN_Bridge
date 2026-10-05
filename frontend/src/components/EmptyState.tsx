import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actionText,
  onAction,
}) => {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center mb-3.5">
        <Icon className="w-7 h-7" />
      </div>
      <h4 className="text-base font-bold text-slate-900 dark:text-white mb-1">
        {title}
      </h4>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mb-4">
        {description}
      </p>
      {actionText && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white text-xs font-semibold shadow-md shadow-brand-500/20 transition-all"
        >
          {actionText}
        </button>
      )}
    </div>
  );
};
