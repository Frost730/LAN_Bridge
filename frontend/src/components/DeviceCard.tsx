import React from 'react';
import { Smartphone, Monitor, Tablet, Laptop, Send, ShieldCheck, Wifi, Unplug } from 'lucide-react';
import { DeviceInfo } from '../types';

interface DeviceCardProps {
  device: DeviceInfo;
  onSendToDevice: (device: DeviceInfo) => void;
  onDisconnect?: (device: DeviceInfo) => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({ device, onSendToDevice, onDisconnect }) => {
  const renderIcon = (type: string) => {
    switch (type) {
      case 'phone':
        return <Smartphone className="w-5 h-5 text-brand-500" />;
      case 'tablet':
        return <Tablet className="w-5 h-5 text-brand-500" />;
      case 'laptop':
        return <Laptop className="w-5 h-5 text-brand-500" />;
      default:
        return <Monitor className="w-5 h-5 text-brand-500" />;
    }
  };

  return (
    <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:border-brand-300 dark:hover:border-brand-700/60 transition-all">
      <div className="flex items-center space-x-3.5 min-w-0 flex-1 mr-3">
        <div className="w-11 h-11 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 flex items-center justify-center shrink-0">
          {renderIcon(device.device_type)}
        </div>
        <div className="truncate">
          <div className="flex items-center space-x-1.5">
            <h4 className="font-semibold text-sm text-slate-900 dark:text-white truncate">
              {device.device_name}
            </h4>
            {device.is_trusted && (
              <span title="Trusted Device">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{device.os}</span>
            <span>•</span>
            <span className="truncate">{device.ip_address || 'LAN'}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-2 shrink-0">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5" />
          Ready
        </span>

        <button
          type="button"
          onClick={() => onSendToDevice(device)}
          className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-brand-50 hover:bg-brand-100 dark:bg-brand-950/60 dark:hover:bg-brand-900/60 text-brand-600 dark:text-brand-400 text-xs font-semibold border border-brand-200 dark:border-brand-800 transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Send</span>
        </button>

        {onDisconnect && (
          <button
            type="button"
            onClick={() => onDisconnect(device)}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-slate-500 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors"
            title="Disconnect / Unpair Device"
          >
            <Unplug className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Disconnect</span>
          </button>
        )}
      </div>
    </div>
  );
};
