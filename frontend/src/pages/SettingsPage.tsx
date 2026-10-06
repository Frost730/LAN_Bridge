import React, { useState, useEffect } from 'react';
import { Settings, Shield, Zap, Bell, Palette, HardDrive, Check, Save, Power, RotateCcw, Cloud, Sun, Moon, Monitor } from 'lucide-react';
import { AppSettings, DeviceInfo } from '../types';
import { api } from '../services/api';
import { Theme } from '../hooks/useTheme';

interface SettingsPageProps {
  localDevice: DeviceInfo;
  currentTheme: Theme;
  onThemeChange: (theme: Theme) => void;
  onUpdateDeviceName: (name: string) => void;
  onUnpairSelf?: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  localDevice,
  currentTheme,
  onThemeChange,
  onUpdateDeviceName,
  onUnpairSelf,
}) => {
  const [deviceName, setDeviceName] = useState(localDevice.device_name);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const savedConcurrency = parseInt(localStorage.getItem('lanbridge_concurrent_transfers') || '3', 10);
    const savedChunkSize = parseInt(localStorage.getItem('lanbridge_chunk_size') || '2097152', 10);
    const savedPerf = localStorage.getItem('lanbridge_performance_mode') === 'true';
    return {
      device_name: localDevice.device_name,
      server_port: 8000,
      require_approval: true,
      concurrent_transfers: savedConcurrency,
      chunk_size: savedChunkSize,
      performance_mode: savedPerf,
      notifications: true,
      theme: currentTheme,
    };
  });

  const [hostDevice, setHostDevice] = useState<DeviceInfo | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isRestarting, setIsRestarting] = useState(false);

  useEffect(() => {
    setDeviceName(localDevice.device_name);
  }, [localDevice.device_name]);

  useEffect(() => {
    setSettings((prev) => ({ ...prev, theme: currentTheme }));
  }, [currentTheme]);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, h] = await Promise.all([
          api.getSettings(),
          api.getHostDevice().catch(() => null)
        ]);
        const savedConcurrency = localStorage.getItem('lanbridge_concurrent_transfers');
        const savedChunkSize = localStorage.getItem('lanbridge_chunk_size');
        const savedPerf = localStorage.getItem('lanbridge_performance_mode');

        setSettings({
          ...s,
          device_name: localDevice.device_name,
          theme: currentTheme,
          concurrent_transfers: savedConcurrency ? parseInt(savedConcurrency, 10) : (s.concurrent_transfers || 3),
          chunk_size: savedChunkSize ? parseInt(savedChunkSize, 10) : (s.chunk_size || 2097152),
          performance_mode: savedPerf !== null ? (savedPerf === 'true') : Boolean(s.performance_mode),
        });
        if (h) setHostDevice(h);
      } catch {
        // Fallback
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const trimmedName = deviceName.trim();
      if (trimmedName && trimmedName !== localDevice.device_name) {
        onUpdateDeviceName(trimmedName);
      }

      const isCloud = hostDevice?.is_cloud;
      const isHost = hostDevice && localDevice.device_id === hostDevice.device_id;

      const payload = {
        ...settings,
        device_name: (!isCloud && isHost) ? trimmedName : settings.device_name,
      };

      await api.updateSettings(payload);
      onThemeChange(settings.theme);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (e) {
      console.error('Failed to update settings:', e);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-300">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Application Settings
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Configure local device identity, security, transfer concurrency, and theme.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Device Identity */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center space-x-2">
            <HardDrive className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Device Identity
            </h3>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {hostDevice?.is_cloud
                ? 'Your Device Name (Visible to Connected Peers)'
                : 'Device Name (Visible on Local Network)'}
            </label>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g., My Laptop, Pixel 8"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-[11px] text-slate-500 mt-1.5">
              {hostDevice?.is_cloud
                ? 'This name identifies your device when sending or receiving files through the cloud relay.'
                : 'Broadcasted via mDNS to nearby devices on your Wi-Fi / LAN.'}
            </p>
          </div>

          {onUnpairSelf && (hostDevice?.is_cloud || (hostDevice && localDevice.device_id !== hostDevice.device_id)) && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                  Disconnect & Unpair Device
                </span>
                <span className="text-[11px] text-slate-500">
                  Disconnects this device from the host and removes stored session tokens.
                </span>
              </div>
              <button
                type="button"
                onClick={onUnpairSelf}
                className="px-3.5 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 text-xs font-semibold transition-colors shrink-0 ml-3"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>

        {/* Security Settings */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Security & Approval
            </h3>
          </div>

          {hostDevice?.is_cloud ? (
            <div className="flex items-start space-x-3 p-3.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/40">
              <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="text-xs font-semibold text-emerald-950 dark:text-emerald-200 block">
                  End-to-End Transfer Confirmation
                </span>
                <span className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 block leading-relaxed">
                  Incoming file transfers require explicit confirmation on your device before downloading. Direct P2P signaling is active and files are never stored in the cloud.
                </span>
              </div>
            </div>
          ) : (
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                  Require Manual Approval for New Devices
                </span>
                <span className="text-[11px] text-slate-500">
                  Untrusted devices must be accepted on the host screen before transferring.
                </span>
              </div>
              <input
                type="checkbox"
                checked={settings.require_approval}
                onChange={(e) => setSettings({ ...settings, require_approval: e.target.checked })}
                className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500"
              />
            </label>
          )}
        </div>

        {/* Transfer & Performance */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
          <div className="flex items-center space-x-2">
            <Zap className="w-5 h-5 text-amber-500" />
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Transfer Engine & Performance
            </h3>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Concurrent Transfer Limit: {settings.concurrent_transfers} {settings.concurrent_transfers > 1 ? '(Parallel streaming active)' : '(Single file queue)'}
              </label>
            </div>
            <input
              type="range"
              min={1}
              max={6}
              value={settings.concurrent_transfers}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setSettings((prev) => ({ ...prev, concurrent_transfers: val }));
                localStorage.setItem('lanbridge_concurrent_transfers', String(val));
              }}
              className="w-full accent-brand-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Streaming Chunk Size
            </label>
            <select
              value={settings.chunk_size}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setSettings((prev) => ({ ...prev, chunk_size: val }));
                localStorage.setItem('lanbridge_chunk_size', String(val));
              }}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value={1048576}>1 MB (Low Memory / Mobile)</option>
              <option value={2097152}>2 MB (Balanced - Recommended)</option>
              <option value={4194304}>4 MB (High Throughput / Gigabit LAN)</option>
            </select>
          </div>

          <label className="flex items-center justify-between cursor-pointer pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
                Performance Mode
              </span>
              <span className="text-[11px] text-slate-500">
                Optimizes streaming buffers (4MB flow-control) and throttles UI render cycles to maximize gigabit throughput.
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.performance_mode}
              onChange={(e) => {
                const checked = e.target.checked;
                setSettings((prev) => ({ ...prev, performance_mode: checked }));
                localStorage.setItem('lanbridge_performance_mode', String(checked));
              }}
              className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500"
            />
          </label>
        </div>

        {/* Appearance & Notifications */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center space-x-2">
            <Palette className="w-5 h-5 text-indigo-500" />
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Appearance
            </h3>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { id: 'system' as const, label: 'System', icon: Monitor },
              { id: 'light' as const, label: 'Light', icon: Sun },
              { id: 'dark' as const, label: 'Dark', icon: Moon },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSettings((prev) => ({ ...prev, theme: id }));
                  onThemeChange(id);
                }}
                className={`flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-xl border text-xs font-semibold capitalize transition-all ${
                  currentTheme === id
                    ? 'border-brand-500 bg-brand-50/80 dark:bg-brand-950/60 text-brand-600 dark:text-brand-400 ring-2 ring-brand-500/20 shadow-sm'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Server Host Controls (Cloud vs Local Desktop) */}
        {hostDevice?.can_shutdown === false ? (
          <div className="bg-slate-100/70 dark:bg-slate-900/60 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 text-slate-800 dark:text-slate-200">
                <Cloud className="w-5 h-5 text-brand-500" />
                <h3 className="font-bold text-sm">Cloud-Managed Server</h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                LANBridge is running in cloud mode. Server lifecycle is continuously maintained by your cloud container.
              </p>
            </div>
            <span className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 text-xs font-semibold shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse" />
              Cloud Active
            </span>
          </div>
        ) : (
          <div className="bg-slate-100/70 dark:bg-slate-900/60 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 text-slate-800 dark:text-slate-200">
                <Power className="w-5 h-5 text-brand-500" />
                <h3 className="font-bold text-sm">Host Server Controls</h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Restart or completely shut down the background LANBridge host service.
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
              {/* Restart Button */}
              <button
                type="button"
                disabled={isRestarting}
                onClick={async () => {
                  if (window.confirm('Restart the LANBridge server? Active transfers will be paused.')) {
                    setIsRestarting(true);
                    try {
                      await api.restartServer();
                    } catch {
                      // Ignore transient network drop during restart
                    }
                    setTimeout(() => {
                      window.location.reload();
                    }, 3500);
                  }
                }}
                className="flex items-center justify-center space-x-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white font-semibold text-xs shadow-md shadow-amber-500/20 transition-all select-none disabled:opacity-50"
              >
                <RotateCcw className={`w-4 h-4 ${isRestarting ? 'animate-spin' : ''}`} />
                <span>{isRestarting ? 'Restarting...' : 'Restart Server'}</span>
              </button>

              {/* Shutdown Button */}
              <button
                type="button"
                disabled={isRestarting}
                onClick={async () => {
                  if (window.confirm('Shutdown LANBridge server? You will need to click LANBridge.exe to start it again.')) {
                    try {
                      await api.shutdownServer();
                      alert('LANBridge server has shut down. You can now close this browser tab.');
                    } catch {
                      alert('Server shutdown initiated.');
                    }
                  }
                }}
                className="flex items-center justify-center space-x-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-[0.98] text-white font-semibold text-xs shadow-md shadow-rose-500/20 transition-all select-none disabled:opacity-50"
              >
                <Power className="w-4 h-4" />
                <span>Shutdown Server</span>
              </button>
            </div>
          </div>
        )}

        {/* Save Button */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          {savedSuccess && (
            <span className="flex items-center text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="w-4 h-4 mr-1" />
              Settings saved!
            </span>
          )}

          <button
            type="submit"
            className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-semibold text-xs shadow-md shadow-brand-500/20 transition-all"
          >
            <Save className="w-4 h-4" />
            <span>Save Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
};
