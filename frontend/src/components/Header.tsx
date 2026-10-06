import React, { useState } from 'react';
import { Wifi, Moon, Sun, Monitor, Smartphone, Tablet, Laptop, Edit2, Check, X, ShieldCheck, Unplug, Users } from 'lucide-react';
import { DeviceInfo } from '../types';
import { Theme } from '../hooks/useTheme';

interface HeaderProps {
  localDevice: DeviceInfo;
  hostDevice: DeviceInfo | null;
  isConnected: boolean;
  theme: Theme;
  currentRoom?: string | null;
  onThemeChange: (theme: Theme) => void;
  onUpdateName: (name: string) => void;
  onOpenConnect: () => void;
  onLeaveRoom?: () => void;
  onUnpairSelf?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  localDevice,
  hostDevice,
  isConnected,
  theme,
  currentRoom,
  onThemeChange,
  onUpdateName,
  onOpenConnect,
  onLeaveRoom,
  onUnpairSelf,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState(localDevice.device_name);

  const handleSaveName = () => {
    if (nameInput.trim()) {
      onUpdateName(nameInput.trim());
      setIsEditing(false);
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

  const isCloud = (() => {
    if (typeof window === 'undefined') return false;
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') return false;
    if (h.startsWith('192.168.') || h.startsWith('10.') || h.endsWith('.local')) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return false;
    return true;
  })() || Boolean(hostDevice?.is_cloud);

  return (
    <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand & Connection Status */}
        <div className="flex items-center space-x-2.5 sm:space-x-3 shrink-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl overflow-hidden shadow-md shadow-brand-500/25 shrink-0 border border-brand-500/20">
            <img src="/app-icon.png" alt="LANBridge" className="w-full h-full object-cover rounded-xl" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5 sm:space-x-2">
              <span className="font-bold text-base sm:text-lg tracking-tight text-slate-900 dark:text-white">
                LANBridge
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium border ${
                  isCloud
                    ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-400 border-sky-200 dark:border-sky-800/60'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60'
                }`}
                title={isConnected ? (isCloud ? 'Connected to Cloud Relay' : 'Connected to local network') : 'Connecting...'}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isConnected ? (isCloud ? 'bg-sky-500 animate-pulse' : 'bg-emerald-500 animate-pulse') : 'bg-rose-500'
                  } mr-1 sm:mr-1.5`}
                />
                <span className="hidden xs:inline sm:inline">
                  {isConnected ? (isCloud ? 'Cloud' : 'LAN') : 'Offline'}
                </span>
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 hidden md:block">
              {isCloud
                ? 'Encrypted peer-to-peer file transfer'
                : 'Direct local network file transfer • 100% offline'}
            </p>
          </div>
        </div>

        {/* Device Identity & Quick Actions */}
        <div className="flex items-center space-x-1.5 sm:space-x-2.5">
          {/* Active Temporary Room Badge */}
          {currentRoom && (
            <div className="flex items-center space-x-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 text-xs font-medium">
              <Users className="w-3.5 h-3.5 text-purple-500 shrink-0" />
              <span className="font-mono font-semibold max-w-[65px] sm:max-w-[120px] truncate">{currentRoom}</span>
              {onLeaveRoom && (
                <button
                  onClick={onLeaveRoom}
                  className="p-0.5 hover:text-rose-500 rounded text-purple-400 dark:text-purple-400"
                  title="Leave Room"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Current Device Pill */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl px-2 sm:px-3 py-1.5 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200">
            <span className="text-brand-500 mr-1 sm:mr-2 shrink-0">{renderDeviceIcon(localDevice.device_type)}</span>
            {isEditing ? (
              <div className="flex items-center space-x-1">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                  className="bg-white dark:bg-slate-700 text-slate-900 dark:text-white px-1.5 py-0.5 rounded text-xs w-20 sm:w-28 border border-brand-400 focus:outline-none"
                  autoFocus
                />
                <button onClick={handleSaveName} className="p-1 text-emerald-600 hover:text-emerald-500">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setIsEditing(false)} className="p-1 text-rose-500 hover:text-rose-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-1 sm:space-x-1.5">
                <span className="font-semibold max-w-[65px] sm:max-w-[120px] truncate">{localDevice.device_name}</span>
                <button
                  onClick={() => {
                    setNameInput(localDevice.device_name);
                    setIsEditing(true);
                  }}
                  className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  title="Rename Device"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Connect / QR Button */}
          <button
            onClick={onOpenConnect}
            className="flex items-center justify-center space-x-1 text-xs font-semibold p-2 sm:px-3 sm:py-1.5 rounded-xl bg-brand-50 hover:bg-brand-100 dark:bg-brand-950/60 dark:hover:bg-brand-900/60 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-800 transition-colors"
            title="Pair New Device"
          >
            <Wifi className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            <span className="hidden sm:inline">Pair</span>
          </button>

          {/* Client Device Disconnect / Unpair Button */}
          {onUnpairSelf && hostDevice && localDevice.device_id !== hostDevice.device_id && (
            <button
              onClick={onUnpairSelf}
              className="flex items-center justify-center space-x-1 text-xs font-semibold p-2 sm:px-2.5 sm:py-1.5 rounded-xl text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 transition-colors"
              title="Disconnect & Unpair this device"
            >
              <Unplug className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">Unpair</span>
            </button>
          )}

          {/* Theme Switcher */}
          <button
            onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition-colors"
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            aria-label="Toggle Theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </header>
  );
};
