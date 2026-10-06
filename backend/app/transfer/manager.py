import os
import time
import shutil
import hashlib
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from collections import deque

from ..config import settings
from ..database.db import db
from ..security.sanitization import sanitize_filename, sanitize_relative_path, get_unique_destination_path
from .protocol import TransferState, FileTransferState, ActiveFile
from .engine import HTTPChunkTransport

logger = logging.getLogger(__name__)

class SpeedCalculator:
    def __init__(self, window_seconds: float = 3.0):
        self.window_seconds = window_seconds
        # Deque of (timestamp, total_bytes)
        self.samples: deque[Tuple[float, int]] = deque()

    def record(self, total_bytes: int) -> None:
        now = time.time()
        self.samples.append((now, total_bytes))
        # Drop samples older than window
        while self.samples and (now - self.samples[0][0]) > self.window_seconds:
            self.samples.popleft()

    def get_speed(self) -> float:
        if len(self.samples) < 2:
            return 0.0
        t_first, b_first = self.samples[0]
        t_last, b_last = self.samples[-1]
        dt = t_last - t_first
        if dt <= 0:
            return 0.0
        db = b_last - b_first
        return max(0.0, db / dt)

class TransferSession:
    def __init__(
        self,
        transfer_id: str,
        sender_device_id: str,
        sender_name: str,
        receiver_device_id: str,
        receiver_name: str,
        is_folder: bool,
        root_name: str,
        files: List[ActiveFile]
    ):
        self.transfer_id = transfer_id
        self.sender_device_id = sender_device_id
        self.sender_name = sender_name
        self.receiver_device_id = receiver_device_id
        self.receiver_name = receiver_name
        self.is_folder = is_folder
        self.root_name = root_name
        self.status: TransferState = TransferState.WAITING_FOR_ACCEPTANCE
        self.files: Dict[str, ActiveFile] = {f.file_id: f for f in files}
        self.total_size: int = sum(f.size for f in files)
        self.created_at: float = time.time()
        self.completed_at: Optional[float] = None
        self.error_message: Optional[str] = None
        self.transport: str = "http"
        self.speed_calc = SpeedCalculator()

    @property
    def bytes_transferred(self) -> int:
        return sum(f.bytes_received for f in self.files.values())

    @property
    def progress_percentage(self) -> float:
        if self.total_size == 0:
            return 100.0
        return min(100.0, (self.bytes_transferred / self.total_size) * 100.0)

    def to_dict(self) -> dict:
        speed = self.speed_calc.get_speed()
        remaining_bytes = max(0, self.total_size - self.bytes_transferred)
        eta = int(remaining_bytes / speed) if speed > 1024 else None

        return {
            "transfer_id": self.transfer_id,
            "sender_device_id": self.sender_device_id,
            "sender_name": self.sender_name,
            "receiver_device_id": self.receiver_device_id,
            "receiver_name": self.receiver_name,
            "status": self.status.value,
            "total_size": self.total_size,
            "bytes_transferred": self.bytes_transferred,
            "progress_percentage": round(self.progress_percentage, 1),
            "speed_bps": round(speed, 1),
            "eta_seconds": eta,
            "is_folder": self.is_folder,
            "root_name": self.root_name,
            "files": [f.to_dict() for f in self.files.values()],
            "transport": self.transport,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
            "error_message": self.error_message
        }

class TransferManager:
    def __init__(self):
        self._transfers: Dict[str, TransferSession] = {}
        self._transport = HTTPChunkTransport()

    def get_transfer(self, transfer_id: str) -> Optional[TransferSession]:
        return self._transfers.get(transfer_id)

    def get_all_transfers(self) -> List[dict]:
        self.cleanup_stale_transfers()
        return [t.to_dict() for t in self._transfers.values()]

    def create_transfer(
        self,
        transfer_id: str,
        sender_device_id: str,
        sender_name: str,
        receiver_device_id: str,
        receiver_name: str,
        is_folder: bool,
        root_name: str,
        files_data: List[dict]
    ) -> TransferSession:
        active_files = [
            ActiveFile(
                file_id=fd["file_id"],
                filename=fd["filename"],
                relative_path=fd.get("relative_path", fd["filename"]),
                size=fd["size"],
                sha256_expected=fd.get("sha256")
            )
            for fd in files_data
        ]
        session = TransferSession(
            transfer_id=transfer_id,
            sender_device_id=sender_device_id,
            sender_name=sender_name,
            receiver_device_id=receiver_device_id,
            receiver_name=receiver_name,
            is_folder=is_folder,
            root_name=root_name,
            files=active_files
        )
        self._transfers[transfer_id] = session
        return session

    def accept_transfer(self, transfer_id: str) -> bool:
        session = self.get_transfer(transfer_id)
        if not session or session.status != TransferState.WAITING_FOR_ACCEPTANCE:
            return False
        session.status = TransferState.TRANSFERRING
        for f in session.files.values():
            f.status = FileTransferState.TRANSFERRING
            # Allocate temp file path
            temp_path = settings.TEMP_DIR / f"{session.transfer_id}_{f.file_id}.part"
            f.temp_filepath = str(temp_path)
            # Create or open temp file
            if not temp_path.exists():
                temp_path.touch()
            # If empty file (0 bytes), finalize immediately so it can be saved/downloaded
            if f.size == 0:
                self._finalize_empty_file(session, f)
        return True

    def reject_transfer(self, transfer_id: str) -> bool:
        session = self.get_transfer(transfer_id)
        if not session:
            return False
        session.status = TransferState.CANCELLED
        session.error_message = "Transfer rejected by receiver"
        self.cleanup_temp_files(session)
        return True

    def pause_transfer(self, transfer_id: str) -> bool:
        session = self.get_transfer(transfer_id)
        if not session or session.status != TransferState.TRANSFERRING:
            return False
        session.status = TransferState.PAUSED
        return True

    def resume_transfer(self, transfer_id: str) -> bool:
        session = self.get_transfer(transfer_id)
        if not session or session.status != TransferState.PAUSED:
            return False
        session.status = TransferState.TRANSFERRING
        return True

    def cancel_transfer(self, transfer_id: str) -> bool:
        session = self.get_transfer(transfer_id)
        if not session:
            return False
        session.status = TransferState.CANCELLED
        session.error_message = "Transfer cancelled"
        self.cleanup_temp_files(session)
        return True

    def delete_transfer(self, transfer_id: str) -> bool:
        session = self._transfers.pop(transfer_id, None)
        if session:
            self.cleanup_temp_files(session)
            return True
        return False

    def cleanup_stale_transfers(self, max_age_seconds: float = 300.0) -> None:
        """Mark transfers left idle without any progress for > 5 minutes as cancelled"""
        now = time.time()
        for t in list(self._transfers.values()):
            if t.status in (TransferState.TRANSFERRING, TransferState.WAITING_FOR_ACCEPTANCE):
                # If no progress for 5 minutes since creation, mark cancelled
                if (now - t.created_at) > max_age_seconds and t.bytes_transferred == 0:
                    t.status = TransferState.CANCELLED
                    t.error_message = "Transfer session expired or disconnected"

    async def complete_transfer(self, transfer_id: str, transport: str = "webrtc") -> bool:
        session = self.get_transfer(transfer_id)
        if not session:
            return False
        session.status = TransferState.COMPLETED
        session.completed_at = time.time()
        session.transport = transport
        for f in session.files.values():
            if f.size == 0 and not f.final_filepath:
                self._finalize_empty_file(session, f)
            else:
                f.status = FileTransferState.COMPLETED
                f.bytes_received = f.size
        # Record in SQLite history
        try:
            filename = session.root_name if session.is_folder else (list(session.files.values())[0].filename if session.files else "file")
            await db.add_history(
                transfer_id=session.transfer_id,
                device_name=session.sender_name,
                direction="received",
                filename=filename,
                size=session.total_size,
                result="completed"
            )
        except Exception as e:
            logger.warning(f"Could not record transfer to history: {e}")
        self.cleanup_temp_files(session)
        return True

    async def write_chunk(
        self,
        transfer_id: str,
        file_id: str,
        chunk_index: int,
        offset: int,
        data: bytes
    ) -> Tuple[bool, Optional[str]]:
        session = self.get_transfer(transfer_id)
        if not session:
            return False, "Transfer session not found"

        if session.status == TransferState.PAUSED:
            return False, "Transfer is paused"
        if session.status in (TransferState.CANCELLED, TransferState.FAILED, TransferState.COMPLETED):
            return False, f"Transfer is already {session.status.value}"

        file_obj = session.files.get(file_id)
        if not file_obj:
            return False, "File not found in transfer"

        # If file is already finalized (e.g. 0-byte file finalized immediately on accept)
        if file_obj.status == FileTransferState.COMPLETED or (file_obj.final_filepath and os.path.exists(file_obj.final_filepath)):
            return True, None

        if not file_obj.temp_filepath:
            temp_path = settings.TEMP_DIR / f"{session.transfer_id}_{file_obj.file_id}.part"
            file_obj.temp_filepath = str(temp_path)

        # Write chunk at offset
        await self._transport.write_chunk(file_obj.temp_filepath, offset, data)

        chunk_len = len(data)
        if chunk_index not in file_obj.chunks_received:
            file_obj.chunks_received.add(chunk_index)
            file_obj.bytes_received += chunk_len

        # Update speed metrics
        session.speed_calc.record(session.bytes_transferred)

        # Check if this file has completed all bytes
        if file_obj.bytes_received >= file_obj.size:
            verified, err = await self._verify_and_finalize_file(session, file_obj)
            if not verified:
                return False, err

        # Check if entire transfer has completed
        all_completed = all(f.status == FileTransferState.COMPLETED for f in session.files.values())
        if all_completed:
            session.status = TransferState.COMPLETED
            session.completed_at = time.time()
            # Record in SQLite history
            await db.add_history(
                transfer_id=session.transfer_id,
                device_name=session.sender_name,
                direction="received",
                filename=session.root_name if session.is_folder else list(session.files.values())[0].filename,
                size=session.total_size,
                result="completed"
            )

        return True, None

    async def _verify_and_finalize_file(self, session: TransferSession, file_obj: ActiveFile) -> Tuple[bool, Optional[str]]:
        """
        Verifies SHA-256 hash using streaming chunks of 1MB (low memory consumption)
        and securely moves to destination with full path traversal protection.
        """
        file_obj.status = FileTransferState.VERIFYING
        temp_path = Path(file_obj.temp_filepath)

        if not temp_path.exists():
            file_obj.status = FileTransferState.FAILED
            file_obj.error_message = "Temporary file missing"
            return False, file_obj.error_message

        # Streaming SHA-256 calculation
        hasher = hashlib.sha256()
        with open(temp_path, "rb") as f:
            while chunk := f.read(1024 * 1024):  # 1MB buffer
                hasher.update(chunk)

        calculated_hash = hasher.hexdigest().lower()
        file_obj.sha256_actual = calculated_hash

        if file_obj.sha256_expected:
            expected = file_obj.sha256_expected.lower().strip()
            if calculated_hash != expected:
                file_obj.status = FileTransferState.FAILED
                file_obj.error_message = f"Integrity check failed: expected {expected[:8]}..., got {calculated_hash[:8]}..."
                logger.error(f"SHA-256 mismatch for {file_obj.filename}: {file_obj.error_message}")
                return False, file_obj.error_message

        # Determine target path safely with sanitization and traversal prevention
        try:
            if session.is_folder:
                # Target path preserves relative structure under root folder name
                safe_root = sanitize_filename(session.root_name)
                # Combine safe root with relative path
                combined_rel = f"{safe_root}/{file_obj.relative_path}"
                dest_path = sanitize_relative_path(combined_rel, settings.RECEIVED_DIR)
            else:
                dest_path = sanitize_relative_path(file_obj.filename, settings.RECEIVED_DIR)

            # Ensure parent directories exist
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            # Ensure unique name if file already exists
            final_path = get_unique_destination_path(dest_path)

            # Move temp file to final location
            shutil.move(str(temp_path), str(final_path))
            file_obj.final_filepath = str(final_path)
            file_obj.status = FileTransferState.COMPLETED
            logger.info(f"File finalized successfully: {file_obj.filename} -> {final_path}")
            return True, None

        except Exception as e:
            file_obj.status = FileTransferState.FAILED
            file_obj.error_message = f"Failed to save file: {str(e)}"
            logger.error(f"Error finalizing file {file_obj.filename}: {e}", exc_info=True)
            return False, file_obj.error_message

    def _finalize_empty_file(self, session: TransferSession, file_obj: ActiveFile) -> bool:
        """Immediately materializes and finalizes a 0-byte file into RECEIVED_DIR"""
        try:
            if session.is_folder:
                safe_root = sanitize_filename(session.root_name)
                combined_rel = f"{safe_root}/{file_obj.relative_path}"
                dest_path = sanitize_relative_path(combined_rel, settings.RECEIVED_DIR)
            else:
                dest_path = sanitize_relative_path(file_obj.filename, settings.RECEIVED_DIR)

            dest_path.parent.mkdir(parents=True, exist_ok=True)
            final_path = get_unique_destination_path(dest_path)
            final_path.touch()

            file_obj.final_filepath = str(final_path)
            file_obj.sha256_actual = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            file_obj.bytes_received = 0
            file_obj.status = FileTransferState.COMPLETED
            logger.info(f"Empty file finalized: {file_obj.filename} -> {final_path}")

            # If all files completed, mark session completed
            if all(f.status == FileTransferState.COMPLETED for f in session.files.values()):
                session.status = TransferState.COMPLETED
                session.completed_at = time.time()
            return True
        except Exception as e:
            file_obj.status = FileTransferState.FAILED
            file_obj.error_message = f"Failed to save empty file: {str(e)}"
            logger.error(f"Error finalizing empty file {file_obj.filename}: {e}", exc_info=True)
            return False

    def cleanup_temp_files(self, session: TransferSession) -> None:
        """Removes incomplete temporary files for cancelled transfers"""
        for f in session.files.values():
            if f.temp_filepath and os.path.exists(f.temp_filepath):
                try:
                    os.remove(f.temp_filepath)
                except Exception as e:
                    logger.debug(f"Could not remove temp file {f.temp_filepath}: {e}")

    def cleanup_old_files(self, max_age_hours: int = 1) -> None:
        """Cleans up received files older than max_age_hours if auto_delete or cloud is active"""
        if not settings.AUTO_DELETE_ON_DOWNLOAD:
            return
        now = time.time()
        max_age_secs = max_age_hours * 3600
        try:
            for root, dirs, files in os.walk(settings.RECEIVED_DIR, topdown=False):
                for name in files:
                    fp = os.path.join(root, name)
                    try:
                        if (now - os.path.getmtime(fp)) > max_age_secs:
                            os.remove(fp)
                            logger.info(f"Ephemeral privacy: automatically purged stale file {name}")
                    except Exception:
                        pass
                for name in dirs:
                    dp = os.path.join(root, name)
                    try:
                        if not os.listdir(dp):
                            os.rmdir(dp)
                    except Exception:
                        pass
        except Exception as e:
            logger.warning(f"Error during ephemeral cleanup: {e}")

transfer_manager = TransferManager()
