import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Navigation, NavTab } from './components/Navigation';
import { Dashboard } from './pages/Dashboard';
import { DevicesPage } from './pages/DevicesPage';
import { TransfersPage } from './pages/TransfersPage';
import { HistoryPage } from './pages/HistoryPage';
import { ConnectPage } from './pages/ConnectPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { IncomingTransferModal } from './components/IncomingTransferModal';
import { NewDeviceApprovalModal } from './components/NewDeviceApprovalModal';

import { useTheme } from './hooks/useTheme';
import { useNotifications } from './hooks/useNotifications';
import { useDevice } from './hooks/useDevice';
import { useTransfers } from './hooks/useTransfers';
import { api } from './services/api';

export function App() {
  const { theme, setTheme } = useTheme();
  const { notify, requestPermission } = useNotifications();
  const {
    localDevice,
    hostDevice,
    onlineDevices,
    isConnected,
    pendingPairRequest,
    setPendingPairRequest,
    updateName,
  } = useDevice();

  const {
    transfers,
    incomingTransfer,
    sendFiles,
    acceptIncoming,
    rejectIncoming,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
  } = useTransfers(localDevice, (title, body) => notify(title, { body }));

  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  // Check URL parameters for QR scan token: /?pair=<token>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pairToken = params.get('pair');
    if (pairToken) {
      // Auto-initiate pairing with this QR token
      api.requestPairing({
        device_id: localDevice.device_id,
        device_name: localDevice.device_name,
        device_type: localDevice.device_type,
        os: localDevice.os,
        browser: localDevice.browser,
        pairing_token: pairToken,
      }).then(() => {
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
      }).catch((e) => {
        console.error('QR pair error:', e);
      });
    }

    // Request notification permissions gracefully on user interaction
    requestPermission();
  }, [localDevice, requestPermission]);

  const activeTransfersCount = transfers.filter(
    (t) => t.status === 'transferring' || t.status === 'paused'
  ).length;

  const handleApprovePendingDevice = async (deviceId: string, trustDevice: boolean) => {
    try {
      await api.approvePairing({
        device_id: deviceId,
        approved: true,
        trust_device: trustDevice,
      });
      setPendingPairRequest(null);
    } catch (e) {
      console.error('Failed to approve device:', e);
    }
  };

  const handleRejectPendingDevice = async (deviceId: string) => {
    try {
      await api.rejectPairing({
        device_id: deviceId,
        approved: false,
      });
      setPendingPairRequest(null);
    } catch (e) {
      console.error('Failed to reject device:', e);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Header */}
      <Header
        localDevice={localDevice}
        hostDevice={hostDevice}
        isConnected={isConnected}
        theme={theme}
        onThemeChange={setTheme}
        onUpdateName={updateName}
        onOpenConnect={() => setIsConnectModalOpen(true)}
      />

      {/* Navigation (Desktop Tabs & Mobile Bar) */}
      <Navigation
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        activeTransferCount={activeTransfersCount}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-12">
        {currentTab === 'dashboard' && (
          <Dashboard
            localDevice={localDevice}
            onlineDevices={onlineDevices}
            transfers={transfers}
            onSendFiles={sendFiles}
            onPauseTransfer={pauseTransfer}
            onResumeTransfer={resumeTransfer}
            onCancelTransfer={cancelTransfer}
            onOpenConnect={() => setIsConnectModalOpen(true)}
            onNavigateTab={setCurrentTab}
          />
        )}

        {currentTab === 'devices' && (
          <DevicesPage
            onlineDevices={onlineDevices}
            onSendToDevice={(device) => {
              // Switch to dashboard with file picker or prompt
              setCurrentTab('dashboard');
            }}
            onOpenConnect={() => setIsConnectModalOpen(true)}
          />
        )}

        {currentTab === 'transfers' && (
          <TransfersPage
            transfers={transfers}
            onPauseTransfer={pauseTransfer}
            onResumeTransfer={resumeTransfer}
            onCancelTransfer={cancelTransfer}
            onNavigateHome={() => setCurrentTab('dashboard')}
          />
        )}

        {currentTab === 'history' && <HistoryPage />}

        {currentTab === 'diagnostics' && <DiagnosticsPage />}

        {currentTab === 'settings' && (
          <SettingsPage
            currentTheme={theme}
            onThemeChange={setTheme}
            onUpdateDeviceName={updateName}
          />
        )}
      </main>

      {/* Pair / Connect Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsConnectModalOpen(false)}
              className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              ✕
            </button>
            <ConnectPage
              localDevice={localDevice}
              hostDevice={hostDevice}
              onPairedSuccess={() => setIsConnectModalOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Incoming Transfer Modal */}
      {incomingTransfer && (
        <IncomingTransferModal
          transfer={incomingTransfer}
          onAccept={acceptIncoming}
          onReject={rejectIncoming}
        />
      )}

      {/* Host New Device Approval Modal */}
      {pendingPairRequest && (
        <NewDeviceApprovalModal
          device={pendingPairRequest}
          onApprove={handleApprovePendingDevice}
          onReject={handleRejectPendingDevice}
        />
      )}
    </div>
  );
}

export default App;
