import React from 'react';
import { Home, Users, ArrowLeftRight, Clock, Settings, Activity, MessageSquare } from 'lucide-react';

export type NavTab = 'dashboard' | 'devices' | 'chat' | 'transfers' | 'history' | 'diagnostics' | 'settings';

interface NavigationProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  activeTransferCount: number;
  unreadChatCount?: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  currentTab,
  onTabChange,
  activeTransferCount,
  unreadChatCount = 0,
}) => {
  const navItems = [
    { id: 'dashboard' as NavTab, label: 'Home', icon: Home },
    { id: 'devices' as NavTab, label: 'Devices', icon: Users },
    {
      id: 'chat' as NavTab,
      label: 'Chat',
      icon: MessageSquare,
      badge: unreadChatCount > 0 ? unreadChatCount : null,
      badgeColor: 'bg-purple-600',
    },
    {
      id: 'transfers' as NavTab,
      label: 'Transfers',
      icon: ArrowLeftRight,
      badge: activeTransferCount > 0 ? activeTransferCount : null,
      badgeColor: 'bg-brand-600',
    },
    { id: 'history' as NavTab, label: 'History', icon: Clock },
    { id: 'diagnostics' as NavTab, label: 'Diagnostics', icon: Activity },
    { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
  ];

  return (
    <>
      {/* Desktop Top/Horizontal Tabs */}
      <nav className="hidden md:flex border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full flex space-x-1 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
                {item.badge && (
                  <span
                    className={`ml-1.5 px-1.5 py-0.2 rounded-full text-xs font-bold ${
                      isActive ? 'bg-white text-brand-600' : `${item.badgeColor || 'bg-brand-500'} text-white`
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-200/80 dark:border-slate-800/80 pb-safe shadow-[0_-4px_16px_rgba(0,0,0,0.05)]">
        <div className="grid grid-cols-5 h-16 px-1">
          {navItems
            .filter((item) => item.id !== 'diagnostics' && item.id !== 'history') // Diagnostics & History accessible on desktop / settings
            .map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`flex flex-col items-center justify-center py-1 transition-all select-none active:scale-90 ${
                    isActive
                      ? 'text-brand-600 dark:text-brand-400 font-bold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  <div className={`p-1 rounded-xl transition-colors relative ${isActive ? 'bg-brand-50 dark:bg-brand-950/60' : ''}`}>
                    <Icon className="w-5 h-5" />
                    {item.badge && (
                      <span className={`absolute -top-1 -right-1.5 ${item.badgeColor || 'bg-brand-600'} text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-extrabold shadow-sm`}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] tracking-tight mt-0.5">{item.label}</span>
                </button>
              );
            })}
        </div>
      </nav>
    </>
  );
};
