import React, { useState, useEffect } from 'react';
import { Users, Shield, ShieldAlert, Trash2, Smartphone, Monitor, Tablet, Laptop, Plus } from 'lucide-react';
import { DeviceInfo, TrustedDevice } from '../types';
import { DeviceCard } from '../components/DeviceCard';
import { EmptyState } from '../components/EmptyState';
import { api } from '../services/api';
import { formatTimestamp } from '../utils/formatters';

interface DevicesPageProps {
  onlineDevices: DeviceInfo[];
  onSendToDevice: (device: DeviceInfo) => void;
  onOpenConnect: () => void;
}

export const DevicesPage: React.FC<DevicesPageProps> = ({
  onlineDevices,
  onSendToDevice,
  onOpenConnect,
}) => {
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [loadingTrusted, setLoadingTrusted] = useState(true);

  const loadTrusted = async () => {
    try {
      const list = await api.getTrustedDevices();
      setTrustedDevices(list);
    } catch {
      // Ignore
    } finally {
      setLoadingTrusted(false);
    }
  };

  useEffect(() => {
    loadTrusted();
  }, []);

  const handleRemoveTrusted = async (deviceId: string) => {
    try {
      await api.removeTrustedDevice(deviceId);
      setTrustedDevices((prev) => prev.filter((d) => d.device_id !== deviceId));
    } catch (e) {
      console.error('Failed to remove trusted device:', e);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Banner & Pair Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Connected & Paired Devices
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Devices currently online on your local network and trusted devices.
          </p>
        </div>

        <button
          onClick={onOpenConnect}
          className="flex items-center justify-center space-x-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-semibold text-xs shadow-md shadow-brand-500/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Pair Device</span>
        </button>
      </div>

      {/* Online Devices List */}
      <section className="space-y-4">
        <div className="flex items-center space-x-2">
          <Users className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          <h3 className="font-bold text-base text-slate-900 dark:text-white">
            Online Devices ({onlineDevices.length})
          </h3>
        </div>

        {onlineDevices.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No devices online"
            description="Other devices on your Wi-Fi will appear here once they open LANBridge."
            actionText="Pair Device"
            onAction={onOpenConnect}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {onlineDevices.map((device) => (
              <DeviceCard
                key={device.device_id}
                device={device}
                onSendToDevice={onSendToDevice}
              />
            ))}
          </div>
        )}
      </section>

      {/* Trusted Devices Section */}
      <section className="space-y-4 pt-6 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center space-x-2">
          <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h3 className="font-bold text-base text-slate-900 dark:text-white">
            Trusted Devices ({trustedDevices.length})
          </h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Trusted devices can reconnect and transfer files without manual approval on every session.
        </p>

        {trustedDevices.length === 0 ? (
          <div className="p-6 rounded-2xl bg-white/40 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
            No trusted devices yet. When approving a device request, check "Trust this device".
          </div>
        ) : (
          <div className="space-y-2">
            {trustedDevices.map((device) => (
              <div
                key={device.device_id}
                className="flex items-center justify-between p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
              >
                <div>
                  <h4 className="font-semibold text-xs text-slate-900 dark:text-white">
                    {device.device_name}
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Trusted on {formatTimestamp(device.trusted_at)}
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveTrusted(device.device_id)}
                  className="flex items-center space-x-1 text-xs text-rose-500 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                  title="Remove from trusted"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Remove</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
