from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class DeviceInfo(BaseModel):
    device_id: str
    device_name: str
    device_type: str = "desktop"  # desktop, phone, tablet, laptop, unknown
    os: str = "unknown"           # Windows, Android, macOS, Linux, iOS
    browser: str = "unknown"
    ip_address: Optional[str] = None
    is_host: bool = False
    is_trusted: bool = False
    online: bool = True

class PairingCodeRequest(BaseModel):
    pass

class PairingCodeResponse(BaseModel):
    code: str
    expires_in_seconds: int

class PairingTokenResponse(BaseModel):
    token: str
    connect_url: str
    expires_in_seconds: int

class PairRequestPayload(BaseModel):
    device_id: str
    device_name: str
    device_type: str = "phone"
    os: str = "unknown"
    browser: str = "unknown"
    pairing_code: Optional[str] = None
    pairing_token: Optional[str] = None

class PairApprovalPayload(BaseModel):
    device_id: str
    approved: bool
    trust_device: bool = False

class TransferFileMetadata(BaseModel):
    file_id: str = Field(..., max_length=128)
    filename: str = Field(..., max_length=255)
    relative_path: str = Field(..., max_length=1024)
    size: int = Field(..., ge=0)
    sha256: Optional[str] = Field(None, max_length=64)

class TransferCreatePayload(BaseModel):
    sender_device_id: str = Field(..., max_length=128)
    sender_name: str = Field(..., max_length=64)
    receiver_device_id: str = Field(..., max_length=128)
    is_folder: bool = False
    root_name: str = Field(..., max_length=255)
    chunk_size: Optional[int] = Field(2097152, ge=65536, le=33554432)
    files: List[TransferFileMetadata] = Field(..., min_length=1, max_length=10000)
    is_encrypted: Optional[bool] = False
    encryption_key: Optional[str] = Field(None, max_length=512)

class TransferFileStatus(BaseModel):
    file_id: str
    filename: str
    relative_path: str
    size: int
    bytes_received: int
    status: str  # queued, transferring, verifying, completed, failed
    sha256_verified: Optional[bool] = None
    chunks_received: Optional[List[int]] = None
    missing_chunks: Optional[List[int]] = None

class TransferDetailsResponse(BaseModel):
    transfer_id: str
    sender_device_id: str
    sender_name: str
    receiver_device_id: str
    receiver_name: str
    status: str  # queued, waiting_for_acceptance, transferring, paused, completed, cancelled, failed
    total_size: int
    bytes_transferred: int
    progress_percentage: float
    speed_bps: float
    eta_seconds: Optional[int] = None
    is_folder: bool
    root_name: str
    files: List[TransferFileStatus]
    is_encrypted: Optional[bool] = False
    encryption_key: Optional[str] = None
    created_at: float
    completed_at: Optional[float] = None
    error_message: Optional[str] = None

class ChunkUploadResponse(BaseModel):
    transfer_id: str
    file_id: str
    chunk_index: int
    bytes_received: int
    file_completed: bool
    transfer_completed: bool

class HistoryItemResponse(BaseModel):
    id: int
    transfer_id: str
    device_name: str
    direction: str  # sent, received
    filename: str
    size: int
    timestamp: float
    result: str    # completed, failed, cancelled

class AppSettings(BaseModel):
    device_name: str
    server_port: int = 8000
    require_approval: bool = True
    concurrent_transfers: int = 3
    chunk_size: int = 2097152  # 2MB
    performance_mode: bool = False
    notifications: bool = True
    theme: str = "system"

class NetworkInterfaceInfo(BaseModel):
    name: str
    ip: str
    netmask: Optional[str] = None
    is_default: bool = False

class DiagnosticsResponse(BaseModel):
    device_name: str
    host_ip: str
    server_port: int
    all_interfaces: List[NetworkInterfaceInfo]
    connected_peers_count: int
    os_name: str
    python_version: str
    storage_free_bytes: int
    storage_total_bytes: int
    is_https: bool = False
