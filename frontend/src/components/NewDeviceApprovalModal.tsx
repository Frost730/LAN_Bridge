import React, { useState } from 'react';
import { Smartphone, Monitor, Tablet, Laptop, Check, X, Shield } from 'lucide-react';
import { DeviceInfo } from '../types';

interface NewDeviceApprovalModalProps {
  device: DeviceInfo;
  onApprove: (deviceId: string, trustDevice: boolean) => void;
  onReject: (deviceId: string) => void;
}

export const NewDeviceApprovalModal: React.FC<NewDeviceApprovalModalProps> = ({
  device,
  onApprove,
  onReject,
}) => {
  const [trustDevice, setTrustDevice] = useState(false);

  const renderIcon = (type: string) => {
    switch (type) {
      case 'phone':
        return <Smartphone className="w-6 h-6 text-brand-500" />;
      case 'tablet':
        return <Tablet className="w-6 h-6 text-brand-500" />;
      case 'laptop':
        return <Laptop className="w-6 h-6 text-brand-500" />;
      default:
        return <Monitor className="w-6 h-6 text-brand-500" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-6 pb-safe sm:pb-6 shadow-2xl border border-slate-200 dark:border-slate-800 text-center flex flex-col items-center">
        {/* Mobile Drag Indicator Handle */}
        <div className="w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-3 sm:hidden shrink-0" />

        {/* Device Icon Avatar */}
        <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-950/60 border border-brand-200 dark:border-brand-800 flex items-center justify-center mb-3">
          {renderIcon(device.device_type)}
        </div>

        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
          New Device Request
        </h3>

        <div className="my-3">
          <p className="font-semibold text-base text-brand-600 dark:text-brand-400">
            {device.device_name}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {device.os} • {device.ip_address || 'LAN'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            wants to connect to this LANBridge host.
          </p>
        </div>

        {/* Trust this device checkbox */}
        <label className="flex items-center space-x-2 text-xs font-medium text-slate-700 dark:text-slate-300 my-4 cursor-pointer select-none bg-slate-50 dark:bg-slate-800 px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 w-full justify-center active:scale-[0.99] transition-all">
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={(e) => setTrustDevice(e.target.checked)}
            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 focus:ring-offset-0 dark:bg-slate-700 border-slate-300"
          />
          <Shield className="w-4 h-4 text-brand-500" />
          <span>Trust this device (auto-reconnect)</span>
        </label>

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-3 w-full">
          <button
            type="button"
            onClick={() => onReject(device.device_id)}
            className="flex items-center justify-center space-x-1.5 px-4 py-3 min-h-[48px] rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold transition-all select-none active:scale-[0.98]"
          >
            <X className="w-4 h-4 text-rose-500" />
            <span>Reject</span>
          </button>

          <button
            type="button"
            onClick={() => onApprove(device.device_id, trustDevice)}
            className="flex items-center justify-center space-x-1.5 px-4 py-3 min-h-[48px] rounded-xl bg-brand-600 hover:bg-brand-500 active:scale-[0.98] text-white text-sm font-semibold shadow-md shadow-brand-500/25 transition-all select-none"
          >
            <Check className="w-4 h-4" />
            <span>Allow</span>
          </button>
        </div>
      </div>
    </div>
  );
};
