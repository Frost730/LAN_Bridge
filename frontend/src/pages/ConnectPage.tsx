import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { QrCode, KeyRound, Copy, Check, RefreshCw, AlertCircle, Shield, Users, Sparkles, LogOut, Link2 } from 'lucide-react';
import { api } from '../services/api';
import { DeviceInfo } from '../types';

interface ConnectPageProps {
  localDevice: DeviceInfo;
  hostDevice: DeviceInfo | null;
  onPairedSuccess: () => void;
  currentRoom?: string | null;
  onJoinRoom?: (room: string) => void;
  onLeaveRoom?: () => void;
  initialTab?: 'room' | 'host' | 'join';
}

const generateRandomRoom = () => {
  const adjectives = ['swift', 'blue', 'cosmic', 'bright', 'amber', 'silent', 'golden', 'hyper'];
  const nouns = ['falcon', 'river', 'orbit', 'cloud', 'forest', 'beacon', 'harbor', 'shadow'];
  const num = Math.floor(10 + Math.random() * 90);
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}-${num}`;
};

export const ConnectPage: React.FC<ConnectPageProps> = ({
  localDevice,
  hostDevice,
  onPairedSuccess,
  currentRoom,
  onJoinRoom,
  onLeaveRoom,
  initialTab,
}) => {
  const [activeTab, setActiveTab] = useState<'room' | 'host' | 'join'>(
    () => initialTab || (currentRoom ? 'room' : 'host')
  );

  // Sync tab if initialTab prop changes
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Temporary Room State
  const [roomInput, setRoomInput] = useState<string>('');
  const [copiedRoomLink, setCopiedRoomLink] = useState(false);

  // Host QR & Code State
  const [qrUrl, setQrUrl] = useState<string>('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [pairingCode, setPairingCode] = useState<string>('');
  const [expiresIn, setExpiresIn] = useState<number>(300);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [qrError, setQrError] = useState<string | null>(null);

  // Client Join Code State
  const [enteredCode, setEnteredCode] = useState<string>('');
  const [joinStatus, setJoinStatus] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isSubmittingCode, setIsSubmittingCode] = useState(false);

  // Load Host Pairing Info
  const loadHostPairingInfo = async () => {
    setIsLoading(true);
    setQrError(null);
    try {
      const [tokenRes, codeRes] = await Promise.all([
        api.getPairingToken(localDevice.device_id),
        api.getPairingCode(localDevice.device_id),
      ]);

      const connectUrl = tokenRes.connect_url;
      setQrUrl(connectUrl);
      setPairingCode(codeRes.formatted);
      setExpiresIn(codeRes.expires_in_seconds);

      // Render QR code to Data URL (works without requiring DOM canvas mounting)
      const dataUrl = await QRCode.toDataURL(connectUrl, {
        width: 256,
        margin: 1.5,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });
      setQrDataUrl(dataUrl);
    } catch (e: any) {
      console.error('Failed to load pairing info:', e);
      setQrError('Failed to generate pairing QR code');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHostPairingInfo();
  }, []);

  // When switching to host tab, ensure QR code is generated
  useEffect(() => {
    if (activeTab === 'host' && !qrDataUrl && !isLoading) {
      loadHostPairingInfo();
    }
  }, [activeTab]);

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

  const handleCopyRoomLink = () => {
    const targetRoom = currentRoom || roomInput.trim();
    if (!targetRoom) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(targetRoom)}`;
    navigator.clipboard.writeText(url);
    setCopiedRoomLink(true);
    setTimeout(() => setCopiedRoomLink(false), 2000);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const target = roomInput.trim();
    if (!target) return;
    onJoinRoom?.(target);
    onPairedSuccess();
  };

  const handleRandomRoom = () => {
    setRoomInput(generateRandomRoom());
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
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl w-full mx-auto">
        <button
          onClick={() => setActiveTab('room')}
          className={`flex-1 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl flex items-center justify-center space-x-1.5 transition-all select-none ${
            activeTab === 'room'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Users className="w-4 h-4 text-purple-500" />
          <span>Temporary Room</span>
        </button>

        <button
          onClick={() => setActiveTab('host')}
          className={`flex-1 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl flex items-center justify-center space-x-1.5 transition-all select-none ${
            activeTab === 'host'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <QrCode className="w-4 h-4" />
          <span>QR & Code</span>
        </button>

        <button
          onClick={() => setActiveTab('join')}
          className={`flex-1 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl flex items-center justify-center space-x-1.5 transition-all select-none ${
            activeTab === 'join'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>Enter Code</span>
        </button>
      </div>

      {activeTab === 'room' && (
        /* Temporary Room Screen */
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <div className="w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 mx-auto flex items-center justify-center mb-3">
            <Users className="w-6 h-6" />
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white mb-1">
            Temporary Share Room
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6">
            Share files across <strong className="text-slate-700 dark:text-slate-300">any network</strong> (different Wi-Fi, 5G, or cellular). Only people in the same room can see each other.
          </p>

          {currentRoom ? (
            /* Active Room Panel */
            <div className="space-y-4 max-w-md mx-auto">
              <div className="p-4 rounded-2xl bg-purple-50/80 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-left">
                <span className="text-[11px] font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wider block mb-1">
                  Active Room
                </span>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xl sm:text-2xl font-bold text-slate-900 dark:text-white truncate">
                    {currentRoom}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                    Joined
                  </span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={handleCopyRoomLink}
                  className="flex-1 py-2.5 px-3 min-h-[44px] rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs flex items-center justify-center space-x-1.5 shadow-sm shadow-purple-500/25 transition-all"
                >
                  {copiedRoomLink ? <Check className="w-4 h-4 text-emerald-300" /> : <Link2 className="w-4 h-4" />}
                  <span>{copiedRoomLink ? 'Invite Link Copied!' : 'Copy Room Invite Link'}</span>
                </button>

                {onLeaveRoom && (
                  <button
                    type="button"
                    onClick={() => {
                      onLeaveRoom();
                      onPairedSuccess();
                    }}
                    className="py-2.5 px-4 min-h-[44px] rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold text-xs flex items-center justify-center space-x-1.5 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Leave Room</span>
                  </button>
                )}
              </div>

              <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
                Send the link to anyone. When they open it, they'll join this room automatically.
              </p>
            </div>
          ) : (
            /* Create / Join Room Form */
            <form onSubmit={handleJoinRoom} className="space-y-4 max-w-md mx-auto">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 text-left">
                  Room Name
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. team-sync or swift-falcon"
                    value={roomInput}
                    onChange={(e) => setRoomInput(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleRandomRoom}
                    className="px-3 min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium flex items-center space-x-1 shrink-0 transition-colors"
                    title="Generate Random Room Name"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                    <span className="hidden sm:inline">Random</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button
                  type="submit"
                  disabled={!roomInput.trim()}
                  className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 active:bg-purple-700 disabled:opacity-50 text-white font-semibold text-sm shadow-md shadow-purple-500/25 transition-all"
                >
                  Join / Create Room
                </button>

                {roomInput.trim() && (
                  <button
                    type="button"
                    onClick={handleCopyRoomLink}
                    className="py-3 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold flex items-center justify-center space-x-1 transition-colors"
                    title="Copy invite link before joining"
                  >
                    {copiedRoomLink ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedRoomLink ? 'Copied' : 'Copy Link'}</span>
                  </button>
                )}
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-left text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                <p className="font-semibold text-slate-700 dark:text-slate-300">🔒 How Temporary Rooms work:</p>
                <p>• Rooms are ephemeral: created instantly in memory and destroyed when everyone leaves.</p>
                <p>• Devices in the room can discover each other across public networks, mobile data, and Wi-Fi.</p>
                <p>• Strangers outside the room cannot see your device.</p>
              </div>
            </form>
          )}
        </div>
      )}

      {activeTab === 'host' && (
        /* Host Connect Screen (QR + 6-digit Code) */
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white mb-1">
            Connect to {hostDevice?.device_name || 'This Host'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-5 sm:mb-6">
            Scan the QR code with your phone camera, or open the network address on any device connected to the same Wi-Fi.
          </p>

          {/* QR Code */}
          <div className="flex flex-col items-center justify-center my-4 sm:my-6">
            <div className="p-3 bg-white rounded-2xl shadow-md border border-slate-200 dark:border-slate-700 flex items-center justify-center min-w-[220px] min-h-[220px] sm:min-w-[240px] sm:min-h-[240px]">
              {isLoading && !qrDataUrl ? (
                <div className="w-[200px] h-[200px] flex flex-col items-center justify-center text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin text-brand-500 mb-2" />
                  <span className="text-xs font-medium text-slate-500">Generating QR Code...</span>
                </div>
              ) : qrError ? (
                <div className="w-[200px] h-[200px] flex flex-col items-center justify-center text-rose-500 p-2 text-center">
                  <AlertCircle className="w-8 h-8 mb-2" />
                  <span className="text-xs font-medium">{qrError}</span>
                  <button
                    type="button"
                    onClick={loadHostPairingInfo}
                    className="mt-3 px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <img
                  src={qrDataUrl}
                  alt="Scan QR code to pair device"
                  className="rounded-xl w-[200px] h-[200px] sm:w-[220px] sm:h-[220px] object-contain block select-none"
                />
              )}
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
      )}

      {activeTab === 'join' && (
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
