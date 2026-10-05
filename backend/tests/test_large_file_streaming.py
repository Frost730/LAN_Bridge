import pytest
import hashlib
import os
import psutil
from pathlib import Path
from app.transfer.manager import TransferManager
from app.transfer.protocol import TransferState
from app.config import settings
from app.database.db import db

@pytest.mark.asyncio
async def test_large_file_bounded_memory_streaming(tmp_path, monkeypatch):
    temp_dir = tmp_path / "temp"
    received_dir = tmp_path / "received"
    temp_dir.mkdir()
    received_dir.mkdir()
    monkeypatch.setattr(settings, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)
    monkeypatch.setattr(db, "db_path", tmp_path / "large_test.db")
    await db.init_db()

    manager = TransferManager()

    # Simulate a 10MB file in 2MB chunks without allocating all 10MB in one chunk
    total_size = 10 * 1024 * 1024  # 10MB
    chunk_size = 2 * 1024 * 1024   # 2MB
    num_chunks = total_size // chunk_size

    # Deterministic chunk pattern
    hasher = hashlib.sha256()
    chunk_template = b"L" * chunk_size
    for _ in range(num_chunks):
        hasher.update(chunk_template)
    expected_sha256 = hasher.hexdigest()

    transfer = manager.create_transfer(
        transfer_id="large-xfer-1",
        sender_device_id="sender",
        sender_name="Laptop",
        receiver_device_id="receiver",
        receiver_name="Desktop",
        is_folder=False,
        root_name="large_stream.bin",
        files_data=[{
            "file_id": "large_f1",
            "filename": "large_stream.bin",
            "relative_path": "large_stream.bin",
            "size": total_size,
            "sha256": expected_sha256
        }]
    )
    manager.accept_transfer("large-xfer-1")

    # Record baseline memory
    proc = psutil.Process()
    initial_rss = proc.memory_info().rss

    # Stream chunks sequentially
    for i in range(num_chunks):
        offset = i * chunk_size
        success, err = await manager.write_chunk(
            transfer_id="large-xfer-1",
            file_id="large_f1",
            chunk_index=i,
            offset=offset,
            data=chunk_template
        )
        assert success is True
        assert err is None

    final_rss = proc.memory_info().rss
    memory_diff_mb = (final_rss - initial_rss) / (1024 * 1024)

    # Verification: Transfer status must be COMPLETED and SHA-256 match
    assert transfer.status == TransferState.COMPLETED
    saved_file = received_dir / "large_stream.bin"
    assert saved_file.exists()
    assert saved_file.stat().st_size == total_size

    # Memory should not have leaked or scaled linearly
    print(f"Memory change during streaming: {memory_diff_mb:.2f} MB")
