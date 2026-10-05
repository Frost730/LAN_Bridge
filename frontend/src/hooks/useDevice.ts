import { useState, useEffect, useCallback } from 'react';
import { DeviceInfo } from '../types';
import { getLocalDeviceInfo, setLocalDeviceName } from '../utils/deviceDetection';
import { api } from '../services/api';
import { wsClient } from '../services/websocket';

export function useDevice() {
  const [localDevice, setLocalDevice] = useState<DeviceInfo>(getLocalDeviceInfo);
  const [hostDevice, setHostDevice] = useState<DeviceInfo | null>(null);
  const [onlineDevices, setOnlineDevices] = useState<DeviceInfo[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [pendingPairRequest, setPendingPairRequest] = useState<DeviceInfo | null>(null);
  const [pairStatus, setPairStatus] = useState<'idle' | 'pending' | 'approved' | 'rejected'>('idle');

  // Load host device info
  const refreshHostDevice = useCallback(async () => {
    try {
      const host = await api.getHostDevice();
      setHostDevice(host);
    } catch (e) {
      console.error('Failed to load host device info:', e);
    }
  }, []);

  // Load peers
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await api.getConnectedDevices();
      setOnlineDevices(devices);
    } catch (e) {
      console.error('Failed to refresh devices:', e);
    }
  }, []);

  // Update local name
  const updateName = async (newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setLocalDeviceName(trimmed);
    const updated = { ...localDevice, device_name: trimmed };
    setLocalDevice(updated);

    // If host device, update backend setting as well
    if (hostDevice && localDevice.device_id === hostDevice.device_id) {
      await api.updateDeviceName(trimmed);
      refreshHostDevice();
    }
    // Reconnect ws with updated name
    wsClient.disconnect();
    wsClient.connect(updated);
  };

  useEffect(() => {
    refreshHostDevice();
    refreshDevices();

    // Connect WebSocket
    wsClient.connect(localDevice);

    const unsubConn = wsClient.on('connection_changed', (data) => {
      setIsConnected(data.connected);
    });

    const unsubDevices = wsClient.on('devices_updated', (data) => {
      if (Array.isArray(data.devices)) {
        setOnlineDevices(data.devices);
      }
    });

    const unsubPairReq = wsClient.on('pair_request', (data) => {
      if (data.device) {
        setPendingPairRequest(data.device);
      }
    });

    const unsubPairApproved = wsClient.on('pair_approved', (data) => {
      if (data.device_id === localDevice.device_id) {
        setPairStatus('approved');
        if (data.session_token) {
          localStorage.setItem('lanbridge_session_token', data.session_token);
        }
      }
    });

    const unsubPairRejected = wsClient.on('pair_rejected', (data) => {
      if (data.device_id === localDevice.device_id) {
        setPairStatus('rejected');
      }
    });

    return () => {
      unsubConn();
      unsubDevices();
      unsubPairReq();
      unsubPairApproved();
      unsubPairRejected();
      wsClient.disconnect();
    };
  }, [localDevice, refreshHostDevice, refreshDevices]);

  return {
    localDevice,
    hostDevice,
    onlineDevices: onlineDevices.filter((d) => d.device_id !== localDevice.device_id),
    isConnected,
    pendingPairRequest,
    setPendingPairRequest,
    pairStatus,
    setPairStatus,
    updateName,
    refreshDevices,
  };
}
