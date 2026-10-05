import React from 'react';
import { Home, Users, ArrowLeftRight, Clock, Settings, Activity } from 'lucide-react';

export type NavTab = 'dashboard' | 'devices' | 'transfers' | 'history' | 'diagnostics' | 'settings';

interface NavigationProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  activeTransferCount: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  currentTab,
  onTabChange,
  activeTransferCount,
}) => {
  const navItems = [
    { id: 'dashboard' as NavTab, label: 'Home', icon: Home },
    { id: 'devices' as NavTab, label: 'Devices', icon: Users },
    {
      id: 'transfers' as NavTab,
      label: 'Transfers',
      icon: ArrowLeftRight,
      badge: activeTransferCount > 0 ? activeTransferCount : null,
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
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
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
                      isActive ? 'bg-white text-brand-600' : 'bg-brand-500 text-white'
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-lg border-t border-slate-200 dark:border-slate-800 pb-safe">
        <div className="grid grid-cols-5 h-16">
          {navItems
            .filter((item) => item.id !== 'diagnostics') // Diagnostics accessible from Settings on small screens
            .map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`flex flex-col items-center justify-center space-y-1 relative ${
                    isActive
                      ? 'text-brand-600 dark:text-brand-400 font-semibold'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <div className="relative">
                    <Icon className="w-5 h-5" />
                    {item.badge && (
                      <span className="absolute -top-1 -right-2 bg-brand-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px]">{item.label}</span>
                </button>
              );
            })}
        </div>
      </nav>
    </>
  );
};
