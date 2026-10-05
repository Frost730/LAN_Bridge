export interface DeviceInfo {
  device_id: string;
  device_name: string;
  device_type: 'desktop' | 'phone' | 'tablet' | 'laptop' | 'unknown';
  os: string;
  browser: string;
  ip_address?: string;
  is_host?: boolean;
  is_trusted?: boolean;
  online?: boolean;
}

export interface TrustedDevice {
  device_id: string;
  device_name: string;
  trusted_at: number;
}

export type TransferStatus =
  | 'queued'
  | 'waiting_for_acceptance'
  | 'transferring'
  | 'verifying'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface TransferFileStatus {
  file_id: string;
  filename: string;
  relative_path: string;
  size: number;
  bytes_received: number;
  status: string;
  sha256_verified?: boolean | null;
  missing_chunks?: number[];
  fileBlob?: File; // For outbound transfers held locally in sender browser
}

export interface TransferItem {
  transfer_id: string;
  sender_device_id: string;
  sender_name: string;
  receiver_device_id: string;
  receiver_name: string;
  direction: 'sent' | 'received';
  status: TransferStatus;
  total_size: number;
  bytes_transferred: number;
  progress_percentage: number;
  speed_bps: number;
  eta_seconds?: number | null;
  is_folder: boolean;
  root_name: string;
  files: TransferFileStatus[];
  created_at: number;
  completed_at?: number | null;
  error_message?: string | null;
}

export interface HistoryItem {
  id: number;
  transfer_id: string;
  device_name: string;
  direction: 'sent' | 'received';
  filename: string;
  size: number;
  timestamp: number;
  result: 'completed' | 'failed' | 'cancelled';
}

export interface AppSettings {
  device_name: string;
  server_port: number;
  require_approval: boolean;
  concurrent_transfers: number;
  chunk_size: number;
  performance_mode: boolean;
  notifications: boolean;
  theme: 'system' | 'light' | 'dark';
}

export interface NetworkInterfaceInfo {
  name: string;
  ip: string;
  netmask?: string;
  is_default: boolean;
}

export interface DiagnosticsData {
  device_name: string;
  hostname: string;
  host_ip: string;
  server_port: number;
  interfaces: NetworkInterfaceInfo[];
  connected_devices_count: number;
  discovered_lan_hosts: Array<{
    name: string;
    ip: string;
    port: number;
    device_id: string;
  }>;
  os_name: string;
  python_version: string;
  app_version: string;
  storage_total_bytes: number;
  storage_free_bytes: number;
  is_https: boolean;
}
