import React, { useState, useEffect } from 'react';
import { Activity, Gauge, Server, HardDrive, Wifi, Network, Play, CheckCircle2, AlertCircle } from 'lucide-react';
import { DiagnosticsData } from '../types';
import { api } from '../services/api';
import { formatBytes } from '../utils/formatters';

export const DiagnosticsPage: React.FC = () => {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Speed test state
  const [isTestingSpeed, setIsTestingSpeed] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [uploadSpeedMbps, setUploadSpeedMbps] = useState<number | null>(null);
  const [downloadSpeedMbps, setDownloadSpeedMbps] = useState<number | null>(null);

  const loadDiagnostics = async () => {
    try {
      const data = await api.getDiagnostics();
      setDiagnostics(data);
    } catch (e) {
      console.error('Failed to load diagnostics:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDiagnostics();
  }, []);

  const runSpeedTest = async () => {
    setIsTestingSpeed(true);
    setPingMs(null);
    setUploadSpeedMbps(null);
    setDownloadSpeedMbps(null);

    try {
      // 1. Ping Test
      const t0 = performance.now();
      await fetch('/api/diagnostics/speedtest/ping');
      const ping = performance.now() - t0;
      setPingMs(Math.round(ping));

      // 2. Download Throughput Test (5MB payload)
      const tDownloadStart = performance.now();
      const dlRes = await fetch('/api/diagnostics/speedtest/download?size_mb=5');
      const dlBuffer = await dlRes.arrayBuffer();
      const dlElapsed = (performance.now() - tDownloadStart) / 1000;
      const dlMbps = (dlBuffer.byteLength * 8) / (dlElapsed * 1024 * 1024);
      setDownloadSpeedMbps(Math.round(dlMbps * 10) / 10);

      // 3. Upload Throughput Test (5MB payload generated in memory)
      const uploadBytes = new Uint8Array(5 * 1024 * 1024);
      const tUploadStart = performance.now();
      const upRes = await fetch('/api/diagnostics/speedtest/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: uploadBytes,
      });
      const upData = await upRes.json();
      setUploadSpeedMbps(upData.mbps);
    } catch (e) {
      console.error('Speed test error:', e);
    } finally {
      setIsTestingSpeed(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Network & Diagnostics
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Hardware interfaces, server metrics, and real local LAN throughput benchmark.
        </p>
      </div>

      {/* LAN Speed Test Card */}
      <div className="bg-gradient-to-br from-brand-600 to-blue-700 text-white rounded-3xl p-6 sm:p-8 shadow-lg shadow-brand-500/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center">
              <Gauge className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold">LAN Throughput Test</h3>
              <p className="text-xs text-blue-100">
                Measures actual Wi-Fi / Ethernet transfer speed between this browser and the LANBridge server.
              </p>
            </div>
          </div>

          <button
            onClick={runSpeedTest}
            disabled={isTestingSpeed}
            className="flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-white text-brand-700 hover:bg-blue-50 active:bg-blue-100 font-semibold text-xs shadow-md transition-all disabled:opacity-50"
          >
            {isTestingSpeed ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-brand-700 border-t-transparent rounded-full animate-spin" />
                <span>Benchmarking...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Speed Test</span>
              </>
            )}
          </button>
        </div>

        {/* Benchmark Results Grid */}
        <div className="grid grid-cols-3 gap-3 bg-white/10 backdrop-blur-md rounded-2xl p-4 text-center">
          <div>
            <span className="text-[11px] text-blue-200 uppercase font-semibold">Latency</span>
            <p className="text-xl sm:text-2xl font-extrabold mt-1">
              {pingMs !== null ? `${pingMs} ms` : '--'}
            </p>
          </div>
          <div className="border-x border-white/15">
            <span className="text-[11px] text-blue-200 uppercase font-semibold">Download</span>
            <p className="text-xl sm:text-2xl font-extrabold mt-1">
              {downloadSpeedMbps !== null ? `${downloadSpeedMbps} Mbps` : '--'}
            </p>
            {downloadSpeedMbps !== null && (
              <span className="text-[10px] text-blue-200">
                ({(downloadSpeedMbps / 8).toFixed(1)} MB/s)
              </span>
            )}
          </div>
          <div>
            <span className="text-[11px] text-blue-200 uppercase font-semibold">Upload</span>
            <p className="text-xl sm:text-2xl font-extrabold mt-1">
              {uploadSpeedMbps !== null ? `${uploadSpeedMbps} Mbps` : '--'}
            </p>
            {uploadSpeedMbps !== null && (
              <span className="text-[10px] text-blue-200">
                ({(uploadSpeedMbps / 8).toFixed(1)} MB/s)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Network Interfaces & System Stats */}
      {diagnostics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Detected Interfaces */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center space-x-2">
              <Network className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Detected Network Interfaces
              </h3>
            </div>
            <div className="space-y-2">
              {diagnostics.interfaces.map((iface, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white block">
                      {iface.name}
                    </span>
                    <span className="text-slate-500 font-mono">{iface.ip}</span>
                  </div>
                  {iface.is_default && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400 border border-brand-200 dark:border-brand-800">
                      Primary
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* System & Storage */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center space-x-2">
              <Server className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Host Server Environment
              </h3>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Operating System</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">{diagnostics.os_name}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Python Runtime</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">{diagnostics.python_version}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Bound Port</span>
                <span className="font-medium font-mono text-slate-800 dark:text-slate-200">{diagnostics.server_port}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Available Storage</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {formatBytes(diagnostics.storage_free_bytes)} free of {formatBytes(diagnostics.storage_total_bytes)}
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-500">Transport Security</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {diagnostics.is_https ? 'HTTPS / TLS' : 'Local Network — HTTP'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
