import asyncio
import os
from abc import ABC, abstractmethod
from typing import Optional, AsyncGenerator

def _write_at_offset(file_path: str, offset: int, data: bytes) -> int:
    mode = "r+b" if os.path.exists(file_path) else "w+b"
    with open(file_path, mode) as f:
        f.seek(offset)
        f.write(data)
    return len(data)

def _read_at_offset(file_path: str, offset: int, length: int) -> bytes:
    with open(file_path, "rb") as f:
        f.seek(offset)
        return f.read(length)

class TransferTransport(ABC):
    """
    Abstract interface for transfer transports (HTTP Chunked, WebRTC, etc.)
    Allows future extensions without rewriting the application logic.
    """
    @property
    @abstractmethod
    def transport_type(self) -> str:
        """Name of the transport mechanism"""
        pass

    @abstractmethod
    async def write_chunk(self, file_path: str, offset: int, data: bytes) -> int:
        """Writes binary chunk at specific file offset without loading entire file"""
        pass

    @abstractmethod
    async def read_chunk(self, file_path: str, offset: int, length: int) -> bytes:
        """Reads chunk of data at offset"""
        pass

class HTTPChunkTransport(TransferTransport):
    @property
    def transport_type(self) -> str:
        return "http_chunk"

    async def write_chunk(self, file_path: str, offset: int, data: bytes) -> int:
        return await asyncio.to_thread(_write_at_offset, file_path, offset, data)

    async def read_chunk(self, file_path: str, offset: int, length: int) -> bytes:
        return await asyncio.to_thread(_read_at_offset, file_path, offset, length)
