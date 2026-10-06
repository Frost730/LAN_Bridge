from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel

class TransferState(str, Enum):
    QUEUED = "queued"
    WAITING_FOR_ACCEPTANCE = "waiting_for_acceptance"
    TRANSFERRING = "transferring"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"

class FileTransferState(str, Enum):
    QUEUED = "queued"
    TRANSFERRING = "transferring"
    VERIFYING = "verifying"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class ActiveFile:
    def __init__(self, file_id: str, filename: str, relative_path: str, size: int, sha256_expected: Optional[str] = None, chunk_size: int = 2097152):
        self.file_id = file_id
        self.filename = filename
        self.relative_path = relative_path
        self.size = size
        self.sha256_expected = sha256_expected
        self.sha256_actual: Optional[str] = None
        self.bytes_received: int = 0
        self.status: FileTransferState = FileTransferState.QUEUED
        self.chunks_received: set[int] = set()
        self.temp_filepath: Optional[str] = None
        self.final_filepath: Optional[str] = None
        self.error_message: Optional[str] = None
        self.chunk_size: int = chunk_size or 2097152

    def to_dict(self) -> dict:
        total_chunks = max(1, (self.size + self.chunk_size - 1) // self.chunk_size)
        missing = [i for i in range(total_chunks) if i not in self.chunks_received]
        return {
            "file_id": self.file_id,
            "filename": self.filename,
            "relative_path": self.relative_path,
            "size": self.size,
            "bytes_received": self.bytes_received,
            "status": self.status.value,
            "sha256_verified": (self.sha256_actual == self.sha256_expected) if (self.sha256_actual and self.sha256_expected) else None,
            "chunks_received": list(self.chunks_received),
            "missing_chunks": missing
        }
