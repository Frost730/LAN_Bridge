from abc import ABC, abstractmethod
from typing import Optional, AsyncGenerator

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
        import anyio
        async with await anyio.open_file(file_path, "r+b" if offset > 0 else "w+b") as f:
            await f.seek(offset)
            await f.write(data)
        return len(data)

    async def read_chunk(self, file_path: str, offset: int, length: int) -> bytes:
        import anyio
        async with await anyio.open_file(file_path, "rb") as f:
            await f.seek(offset)
            return await f.read(length)
