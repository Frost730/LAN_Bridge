import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { QrCode, KeyRound, Copy, Check, RefreshCw, AlertCircle, Shield, Wifi } from 'lucide-react';
import { api } from '../services/api';
import { DeviceInfo } from '../types';

interface ConnectPageProps {
  localDevice: DeviceInfo;
  hostDevice: DeviceInfo | null;
  onPairedSuccess: () => void;
}

export const ConnectPage: React.FC<ConnectPageProps> = ({
  localDevice,
  hostDevice,
  onPairedSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'host' | 'join'>('host');

  // Host QR & Code State
  const [qrUrl, setQrUrl] = useState<string>('');
  const [pairingCode, setPairingCode] = useState<string>('');
  const [expiresIn, setExpiresIn] = useState<number>(300);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Client Join Code State
  const [enteredCode, setEnteredCode] = useState<string>('');
  const [joinStatus, setJoinStatus] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isSubmittingCode, setIsSubmittingCode] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load Host Pairing Info
  const loadHostPairingInfo = async () => {
    setIsLoading(true);
    try {
      const [tokenRes, codeRes] = await Promise.all([
        api.getPairingToken(localDevice.device_id),
        api.getPairingCode(localDevice.device_id),
      ]);

      setQrUrl(tokenRes.connect_url);
      setPairingCode(codeRes.formatted);
      setExpiresIn(codeRes.expires_in_seconds);

      // Render QR code to canvas
      if (canvasRef.current) {
        await QRCode.toCanvas(canvasRef.current, tokenRes.connect_url, {
          width: 220,
          margin: 1.5,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        });
      }
    } catch (e) {
      console.error('Failed to load pairing info:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHostPairingInfo();
  }, []);

  // Expiration Countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setExpiresIn((prev) => {
        if (prev <= 1) {
          loadHostPairingInfo();
          return 300;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(qrUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(pairingCode.replace(/\s/g, ''));
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Submit Pairing Code from client
  const handleJoinWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enteredCode.trim()) return;

    setIsSubmittingCode(true);
    setJoinError(null);
    setJoinStatus('Verifying code with host...');

    try {
      const res = await api.requestPairing({
        device_id: localDevice.device_id,
        device_name: localDevice.device_name,
        device_type: localDevice.device_type,
        os: localDevice.os,
        browser: localDevice.browser,
        pairing_code: enteredCode.trim(),
      });

      if (res.status === 'approved') {
        setJoinStatus('Device connected & approved ✓');
        onPairedSuccess();
      } else {
        setJoinStatus('Pairing request sent! Waiting for approval on the host screen...');
      }
    } catch (err: any) {
      setJoinError(err.message || 'Failed to verify code. Please try again.');
      setJoinStatus(null);
    } finally {
      setIsSubmittingCode(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Tab Switcher */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl w-full sm:max-w-sm mx-auto">
        <button
          onClick={() => setActiveTab('host')}
          className={`flex-1 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl flex items-center justify-center space-x-2 transition-all select-none ${
            activeTab === 'host'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <QrCode className="w-4 h-4" />
          <span>Connect New Device</span>
        </button>

        <button
          onClick={() => setActiveTab('join')}
          className={`flex-1 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl flex items-center justify-center space-x-2 transition-all select-none ${
            activeTab === 'join'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>Enter Code</span>
        </button>
      </div>

      {activeTab === 'host' ? (
        /* Host Connect Screen (QR + 6-digit Code) */
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white mb-1">
            Connect to {hostDevice?.device_name || 'This Host'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-5 sm:mb-6">
            Scan the QR code with your phone camera, or open the network address on any device connected to the same Wi-Fi.
          </p>

          {/* QR Code Canvas */}
          <div className="flex flex-col items-center justify-center my-4 sm:my-6">
            <div className="p-3 bg-white rounded-2xl shadow-md border border-slate-200 dark:border-slate-700 inline-block max-w-[240px]">
              <canvas ref={canvasRef} className="rounded-xl w-full h-auto" />
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 flex items-center">
              <Shield className="w-3.5 h-3.5 mr-1 text-emerald-500 shrink-0" />
              <span>Ephemeral one-time pairing token</span>
            </p>
          </div>

          {/* Direct Address */}
          <div className="max-w-md mx-auto mb-5 sm:mb-6">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 text-left sm:text-center">
              Network Address
            </label>
            <div className="flex items-center space-x-2 bg-slate-50 dark:bg-slate-800 p-2 sm:p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 min-h-[46px]">
              <span className="font-mono text-xs text-brand-600 dark:text-brand-400 flex-1 truncate select-all px-1">
                {qrUrl.split('?')[0] || 'http://192.168.1.x:8000'}
              </span>
              <button
                onClick={handleCopyUrl}
                className="p-2 min-w-[38px] min-h-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Copy Address"
              >
                {copiedUrl ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* 6-Digit Pairing Code */}
          <div className="max-w-md mx-auto p-4 sm:p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <span className="text-[11px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Pairing Code
            </span>
            <div className="flex items-center justify-center space-x-3 my-2">
              <span className="font-mono text-2xl sm:text-3xl font-extrabold tracking-widest text-slate-900 dark:text-white select-all">
                {pairingCode || '------'}
              </span>
              <button
                onClick={handleCopyCode}
                className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Copy Code"
              >
                {copiedCode ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-700">
              <span>Expires in {formatCountdown(expiresIn)}</span>
              <button
                onClick={loadHostPairingInfo}
                className="flex items-center space-x-1 min-h-[36px] px-2 text-brand-600 hover:text-brand-700 dark:text-brand-400"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Join with 6-digit Code Form */
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm max-w-md mx-auto">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1 text-center">
            Enter Pairing Code
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 text-center mb-6">
            Enter the 6-digit code shown on the host device screen to establish a trusted local connection.
          </p>

          <form onSubmit={handleJoinWithCode} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 text-center">
                6-Digit Code
              </label>
              <input
                type="text"
                maxLength={7}
                placeholder="482 731"
                value={enteredCode}
                onChange={(e) => setEnteredCode(e.target.value)}
                className="w-full text-center font-mono text-2xl tracking-widest px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                autoFocus
              />
            </div>

            {joinError && (
              <div className="flex items-center space-x-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{joinError}</span>
              </div>
            )}

            {joinStatus && (
              <div className="flex items-center space-x-2 p-3 rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300 text-xs">
                <div className="w-3.5 h-3.5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin shrink-0" />
                <span>{joinStatus}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingCode || !enteredCode.trim()}
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 active:bg-brand-700 disabled:opacity-50 text-white font-semibold text-sm shadow-md shadow-brand-500/25 transition-all"
            >
              {isSubmittingCode ? 'Connecting...' : 'Connect to Host'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
