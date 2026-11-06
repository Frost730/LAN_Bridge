import {
  DeviceInfo,
  TrustedDevice,
  TransferItem,
  HistoryItem,
  AppSettings,
  DiagnosticsData
} from '../types';

const BASE_URL = '';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errorBody.detail || errorBody.message || 'Request failed');
  }
  return res.json();
}

export const api = {
  // Device
  getHostDevice: () => fetch(`${BASE_URL}/api/device`).then((r) => handleResponse<DeviceInfo>(r)),
  updateDeviceName: (name: string) =>
    fetch(`${BASE_URL}/api/device`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_name: name }),
    }).then((r) => handleResponse<{ status: string; device_name: string }>(r)),

  getConnectedDevices: (deviceId?: string) =>
    fetch(`${BASE_URL}/api/devices${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''}`).then((r) =>
      handleResponse<DeviceInfo[]>(r)
    ),

  getTrustedDevices: () =>
    fetch(`${BASE_URL}/api/devices/trusted`).then((r) => handleResponse<TrustedDevice[]>(r)),

  addTrustedDevice: (payload: { device_id: string; device_name: string }) =>
    fetch(`${BASE_URL}/api/devices/trusted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => handleResponse<{ status: string; device_id: string }>(r)),

  removeTrustedDevice: (deviceId: string) =>
    fetch(`${BASE_URL}/api/devices/trusted/${deviceId}`, { method: 'DELETE' }).then((r) =>
      handleResponse<{ status: string }>(r)
    ),

  disconnectDevice: (deviceId: string, untrust = true) =>
    fetch(`${BASE_URL}/api/devices/${deviceId}/disconnect?untrust=${untrust}`, {
      method: 'POST',
    }).then((r) => handleResponse<{ status: string; disconnected: boolean }>(r)),

  // Pairing
  getPairingCode: (deviceId?: string) =>
    fetch(`${BASE_URL}/api/pair/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deviceId ? { device_id: deviceId } : {}),
    }).then((r) =>
      handleResponse<{ code: string; formatted: string; expires_in_seconds: number }>(r)
    ),

  getPairingToken: (deviceId?: string) =>
    fetch(`${BASE_URL}/api/pair/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deviceId ? { device_id: deviceId } : {}),
    }).then((r) =>
      handleResponse<{ token: string; connect_url: string; expires_in_seconds: number }>(r)
    ),

  requestPairing: (payload: {
    device_id: string;
    device_name: string;
    device_type: string;
    os: string;
    browser: string;
    pairing_code?: string;
    pairing_token?: string;
  }) =>
    fetch(`${BASE_URL}/api/pair/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => handleResponse<{ status: string; session_token?: string; message: string }>(r)),

  approvePairing: (payload: { device_id: string; approved: boolean; trust_device: boolean }) =>
    fetch(`${BASE_URL}/api/pair/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => handleResponse<{ status: string; message: string }>(r)),

  rejectPairing: (payload: { device_id: string; approved: boolean }) =>
    fetch(`${BASE_URL}/api/pair/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => handleResponse<{ status: string; message: string }>(r)),

  // Transfers
  createTransfer: (payload: {
    sender_device_id: string;
    sender_name: string;
    receiver_device_id: string;
    is_folder: boolean;
    root_name: string;
    chunk_size?: number;
    is_encrypted?: boolean;
    encryption_key?: string;
    files: Array<{
      file_id: string;
      filename: string;
      relative_path: string;
      size: number;
      sha256?: string;
    }>;
  }) =>
    fetch(`${BASE_URL}/api/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => handleResponse<TransferItem>(r)),

  getTransfers: (deviceId?: string) =>
    fetch(`${BASE_URL}/api/transfers${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''}`).then((r) =>
      handleResponse<TransferItem[]>(r)
    ),

  getTransfer: (transferId: string) =>
    fetch(`${BASE_URL}/api/transfers/${transferId}`).then((r) => handleResponse<TransferItem>(r)),

  acceptTransfer: (transferId: string, trustDevice = false) =>
    fetch(`${BASE_URL}/api/transfers/${transferId}/accept?trust_device=${trustDevice}`, { method: 'POST' }).then((r) =>
      handleResponse<TransferItem>(r)
    ),

  rejectTransfer: (transferId: string) =>
    fetch(`${BASE_URL}/api/transfers/${transferId}/reject`, { method: 'POST' }).then((r) =>
      handleResponse<TransferItem>(r)
    ),

  pauseTransfer: (transferId: string) =>
    fetch(`${BASE_URL}/api/transfers/${transferId}/pause`, { method: 'POST' }).then((r) =>
      handleResponse<TransferItem>(r)
    ),

  resumeTransfer: (transferId: string) =>
    fetch(`${BASE_URL}/api/transfers/${transferId}/resume`, { method: 'POST' }).then((r) =>
      handleResponse<TransferItem>(r)
    ),

  cancelTransfer: (transferId: string) =>
    fetch(`${BASE_URL}/api/transfers/${transferId}/cancel`, { method: 'POST' }).then((r) =>
      handleResponse<TransferItem>(r)
    ),

  completeTransfer: (transferId: string, transport = 'webrtc') =>
    fetch(`${BASE_URL}/api/transfers/${transferId}/complete?transport=${transport}`, {
      method: 'POST',
    }).then((r) => handleResponse<TransferItem>(r)),

  deleteTransfer: (transferId: string) =>
    fetch(`${BASE_URL}/api/transfers/${transferId}`, { method: 'DELETE' }).then((r) =>
      handleResponse<{ status: string; deleted: boolean }>(r)
    ),

  uploadChunk: (
    transferId: string,
    fileId: string,
    chunkIndex: number,
    offset: number,
    chunkBlob: Blob,
    timeoutMs = 60000
  ) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(
      `${BASE_URL}/api/transfers/${transferId}/files/${fileId}/chunks?chunk_index=${chunkIndex}&offset=${offset}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunkBlob,
        signal: controller.signal,
      }
    )
      .then((r) =>
        handleResponse<{
          status: string;
          chunk_index: number;
          bytes_received: number;
          file_completed: boolean;
          transfer_completed: boolean;
        }>(r)
      )
      .finally(() => clearTimeout(timer));
  },

  // History
  getHistory: (deviceId?: string) =>
    fetch(`${BASE_URL}/api/history${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''}`).then((r) =>
      handleResponse<HistoryItem[]>(r)
    ),

  clearHistory: (deviceId?: string) =>
    fetch(`${BASE_URL}/api/history${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''}`, { method: 'DELETE' }).then((r) =>
      handleResponse<{ status: string }>(r)
    ),

  // Diagnostics
  getDiagnostics: () =>
    fetch(`${BASE_URL}/api/diagnostics`).then((r) => handleResponse<DiagnosticsData>(r)),

  // Settings
  getSettings: () =>
    fetch(`${BASE_URL}/api/settings`).then((r) => handleResponse<AppSettings>(r)),

  updateSettings: (settings: Partial<AppSettings>) =>
    fetch(`${BASE_URL}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }).then((r) => handleResponse<{ status: string }>(r)),

  // Server Management
  shutdownServer: () =>
    fetch(`${BASE_URL}/api/shutdown`, { method: 'POST' }).then((r) =>
      handleResponse<{ status: string; message: string }>(r)
    ),

  restartServer: () =>
    fetch(`${BASE_URL}/api/restart`, { method: 'POST' }).then((r) =>
      handleResponse<{ status: string; message: string }>(r)
    ),
};
