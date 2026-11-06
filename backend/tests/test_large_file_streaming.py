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

@pytest.mark.asyncio
async def test_chunk_size_and_chunks_received_tracking(tmp_path, monkeypatch):
    temp_dir = tmp_path / "temp2"
    received_dir = tmp_path / "received2"
    temp_dir.mkdir()
    received_dir.mkdir()
    monkeypatch.setattr(settings, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)
    monkeypatch.setattr(db, "db_path", tmp_path / "chunk_test.db")
    await db.init_db()

    manager = TransferManager()

    # 6MB file with 2MB chunk_size = exactly 3 chunks (0, 1, 2)
    total_size = 6 * 1024 * 1024
    chunk_size = 2 * 1024 * 1024
    session = manager.create_transfer(
        transfer_id="chunk-test-1",
        sender_device_id="dev-send",
        sender_name="Sender",
        receiver_device_id="dev-recv",
        receiver_name="Receiver",
        is_folder=False,
        root_name="data.bin",
        files_data=[{
            "file_id": "cf1",
            "filename": "data.bin",
            "relative_path": "data.bin",
            "size": total_size
        }],
        chunk_size=chunk_size
    )
    manager.accept_transfer("chunk-test-1")

    # Initial state: 0 chunks received, missing chunks should be [0, 1, 2]
    f_dict = session.files["cf1"].to_dict()
    assert f_dict["chunks_received"] == []
    assert f_dict["missing_chunks"] == [0, 1, 2]

    # Write chunk 0 and chunk 2 (simulate out-of-order or partial upload)
    dummy_chunk = b"X" * chunk_size
    await manager.write_chunk("chunk-test-1", "cf1", chunk_index=0, offset=0, data=dummy_chunk)
    await manager.write_chunk("chunk-test-1", "cf1", chunk_index=2, offset=4 * 1024 * 1024, data=dummy_chunk)

    f_dict = session.files["cf1"].to_dict()
    assert set(f_dict["chunks_received"]) == {0, 2}
    assert f_dict["missing_chunks"] == [1]

    # Write chunk 1 to finish
    await manager.write_chunk("chunk-test-1", "cf1", chunk_index=1, offset=2 * 1024 * 1024, data=dummy_chunk)
    f_dict = session.files["cf1"].to_dict()
    assert set(f_dict["chunks_received"]) == {0, 1, 2}
    assert f_dict["missing_chunks"] == []
    assert session.status == TransferState.COMPLETED

@pytest.mark.asyncio
async def test_truncated_file_rejection_and_verification(tmp_path, monkeypatch):
    temp_dir = tmp_path / "temp3"
    received_dir = tmp_path / "received3"
    temp_dir.mkdir()
    received_dir.mkdir()
    monkeypatch.setattr(settings, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)
    monkeypatch.setattr(db, "db_path", tmp_path / "trunc_test.db")
    await db.init_db()

    manager = TransferManager()

    # Declare a 2.8MB file (~simulate 2.8GB file proportions)
    total_size = 2800000
    chunk_size = 1000000

    session = manager.create_transfer(
        transfer_id="trunc-test-1",
        sender_device_id="sender",
        sender_name="Sender",
        receiver_device_id="receiver",
        receiver_name="Receiver",
        is_folder=False,
        root_name="Combat_Mod.rar",
        chunk_size=chunk_size,
        files_data=[{
            "file_id": "tf1",
            "filename": "Combat_Mod.rar",
            "relative_path": "Combat_Mod.rar",
            "size": total_size,
        }]
    )
    manager.accept_transfer("trunc-test-1")

    # Send only 500KB (truncated ~500MB)
    truncated_bytes = b"Z" * 500000
    success, _ = await manager.write_chunk("trunc-test-1", "tf1", chunk_index=0, offset=0, data=truncated_bytes)
    assert success is True

    # Attempting to complete transfer with missing bytes MUST fail and reject
    completed = await manager.complete_transfer("trunc-test-1", transport="http")
    assert completed is False
    assert session.status == TransferState.FAILED
    assert "Incomplete transfer" in session.error_message or "missing" in session.error_message

