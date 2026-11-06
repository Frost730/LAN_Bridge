import pytest
import hashlib
import os
from pathlib import Path
from app.transfer.manager import TransferManager
from app.transfer.protocol import TransferState, FileTransferState
from app.config import settings
from app.database.db import db

@pytest.mark.asyncio
async def test_chunk_upload_and_sha256_verification(tmp_path, monkeypatch):
    # Redirect temp, received, and db paths to tmp_path
    temp_dir = tmp_path / "temp"
    received_dir = tmp_path / "received"
    temp_dir.mkdir()
    received_dir.mkdir()
    monkeypatch.setattr(settings, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)
    
    from app.database.db import db
    monkeypatch.setattr(db, "db_path", tmp_path / "test.db")
    await db.init_db()

    manager = TransferManager()

    # Create dummy 100KB payload
    payload = b"LANBridge High Speed Transfer Test! " * 2800  # ~100KB
    expected_hash = hashlib.sha256(payload).hexdigest()

    transfer = manager.create_transfer(
        transfer_id="test-xfer-1",
        sender_device_id="sender-1",
        sender_name="Gaming-PC",
        receiver_device_id="receiver-1",
        receiver_name="Galaxy-Phone",
        is_folder=False,
        root_name="test.bin",
        files_data=[{
            "file_id": "file-1",
            "filename": "test.bin",
            "relative_path": "test.bin",
            "size": len(payload),
            "sha256": expected_hash
        }]
    )

    # Receiver accepts
    assert manager.accept_transfer("test-xfer-1") is True
    assert transfer.status == TransferState.TRANSFERRING

    # Split into 3 chunks
    chunk_size = 35000
    chunks = [payload[i:i+chunk_size] for i in range(0, len(payload), chunk_size)]

    offset = 0
    for idx, chunk_data in enumerate(chunks):
        success, err = await manager.write_chunk(
            transfer_id="test-xfer-1",
            file_id="file-1",
            chunk_index=idx,
            offset=offset,
            data=chunk_data
        )
        assert success is True
        assert err is None
        offset += len(chunk_data)

    # Verification: Transfer should be COMPLETED and file saved in received dir
    assert transfer.status == TransferState.COMPLETED
    final_file = received_dir / "test.bin"
    assert final_file.exists()
    assert final_file.read_bytes() == payload

@pytest.mark.asyncio
async def test_out_of_order_and_concurrent_chunks(tmp_path, monkeypatch):
    """Verifies that chunks arriving out-of-order or concurrently do not corrupt or truncate files."""
    temp_dir = tmp_path / "temp"
    received_dir = tmp_path / "received"
    temp_dir.mkdir()
    received_dir.mkdir()
    monkeypatch.setattr(settings, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)
    monkeypatch.setattr(db, "db_path", tmp_path / "test_ooo.db")
    await db.init_db()

    manager = TransferManager()

    payload = b"LANBridge Concurrent Chunk Test Pipelining Data! " * 1500  # ~73.5KB
    expected_hash = hashlib.sha256(payload).hexdigest()

    transfer = manager.create_transfer(
        transfer_id="test-ooo-1",
        sender_device_id="sender-ooo",
        sender_name="Laptop",
        receiver_device_id="receiver-ooo",
        receiver_name="Desktop",
        is_folder=False,
        root_name="ooo_test.dat",
        chunk_size=20000,
        files_data=[{
            "file_id": "file-ooo-1",
            "filename": "ooo_test.dat",
            "relative_path": "ooo_test.dat",
            "size": len(payload),
            "sha256": expected_hash
        }]
    )

    assert manager.accept_transfer("test-ooo-1") is True

    chunk_size = 20000
    chunk_tuples = []
    for idx, i in enumerate(range(0, len(payload), chunk_size)):
        chunk_data = payload[i:i+chunk_size]
        chunk_tuples.append((idx, i, chunk_data))

    # Reverse order: write chunk 3, chunk 2, chunk 1, chunk 0
    for idx, offset, data in reversed(chunk_tuples):
        success, err = await manager.write_chunk(
            transfer_id="test-ooo-1",
            file_id="file-ooo-1",
            chunk_index=idx,
            offset=offset,
            data=data
        )
        assert success is True
        assert err is None

    assert transfer.status == TransferState.COMPLETED
    saved_file = received_dir / "ooo_test.dat"
    assert saved_file.exists()
    assert saved_file.read_bytes() == payload

@pytest.mark.asyncio
async def test_resume_interrupted_transfer(tmp_path, monkeypatch):
    temp_dir = tmp_path / "temp"
    received_dir = tmp_path / "received"
    temp_dir.mkdir()
    received_dir.mkdir()
    monkeypatch.setattr(settings, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)
    monkeypatch.setattr(db, "db_path", tmp_path / "test_resume.db")
    await db.init_db()

    manager = TransferManager()
    payload = b"Resume Test Buffer " * 1000
    expected_hash = hashlib.sha256(payload).hexdigest()

    transfer = manager.create_transfer(
        transfer_id="test-resume-1",
        sender_device_id="dev-a",
        sender_name="Laptop",
        receiver_device_id="dev-b",
        receiver_name="Desktop",
        is_folder=False,
        root_name="resume.txt",
        files_data=[{
            "file_id": "f1",
            "filename": "resume.txt",
            "relative_path": "resume.txt",
            "size": len(payload),
            "sha256": expected_hash
        }]
    )
    manager.accept_transfer("test-resume-1")

    # Send only first chunk of 5000 bytes
    chunk1 = payload[:5000]
    await manager.write_chunk("test-resume-1", "f1", chunk_index=0, offset=0, data=chunk1)

    # Pause transfer
    assert manager.pause_transfer("test-resume-1") is True
    assert transfer.status == TransferState.PAUSED

    # Attempting to write while paused should fail
    success, _ = await manager.write_chunk("test-resume-1", "f1", chunk_index=1, offset=5000, data=payload[5000:])
    assert success is False

    # Check status for resume query
    status_data = transfer.to_dict()
    assert status_data["bytes_transferred"] == 5000
    assert status_data["status"] == "paused"

    # Resume transfer
    assert manager.resume_transfer("test-resume-1") is True
    assert transfer.status == TransferState.TRANSFERRING

    # Send remaining chunk
    chunk2 = payload[5000:]
    success, err = await manager.write_chunk("test-resume-1", "f1", chunk_index=1, offset=5000, data=chunk2)
    assert success is True

    # Entire transfer completes successfully
    assert transfer.status == TransferState.COMPLETED
    assert (received_dir / "resume.txt").read_bytes() == payload

@pytest.mark.asyncio
async def test_transfer_cancellation_cleans_temp_files(tmp_path, monkeypatch):
    temp_dir = tmp_path / "temp"
    received_dir = tmp_path / "received"
    temp_dir.mkdir()
    received_dir.mkdir()
    monkeypatch.setattr(settings, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)

    manager = TransferManager()
    transfer = manager.create_transfer(
        transfer_id="test-cancel-1",
        sender_device_id="dev-a",
        sender_name="Laptop",
        receiver_device_id="dev-b",
        receiver_name="Desktop",
        is_folder=False,
        root_name="cancel.dat",
        files_data=[{
            "file_id": "f_cancel",
            "filename": "cancel.dat",
            "relative_path": "cancel.dat",
            "size": 10000
        }]
    )
    manager.accept_transfer("test-cancel-1")
    await manager.write_chunk("test-cancel-1", "f_cancel", chunk_index=0, offset=0, data=b"partial data")

    temp_file = Path(transfer.files["f_cancel"].temp_filepath)
    assert temp_file.exists()

    # Cancel transfer
    assert manager.cancel_transfer("test-cancel-1") is True
    assert transfer.status == TransferState.CANCELLED
    # Incomplete temp file must be cleaned up
    assert not temp_file.exists()

@pytest.mark.asyncio
async def test_sha256_integrity_failure_detection(tmp_path, monkeypatch):
    temp_dir = tmp_path / "temp"
    received_dir = tmp_path / "received"
    temp_dir.mkdir()
    received_dir.mkdir()
    monkeypatch.setattr(settings, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)

    manager = TransferManager()
    data = b"Authentic payload"
    wrong_hash = "0000000000000000000000000000000000000000000000000000000000000000"

    manager.create_transfer(
        transfer_id="test-tamper-1",
        sender_device_id="dev-a",
        sender_name="Laptop",
        receiver_device_id="dev-b",
        receiver_name="Desktop",
        is_folder=False,
        root_name="tampered.bin",
        files_data=[{
            "file_id": "f_tamper",
            "filename": "tampered.bin",
            "relative_path": "tampered.bin",
            "size": len(data),
            "sha256": wrong_hash
        }]
    )
    manager.accept_transfer("test-tamper-1")

    # Upload corrupt/mismatched data
    success, err = await manager.write_chunk("test-tamper-1", "f_tamper", chunk_index=0, offset=0, data=data)
    assert success is False
    assert "Integrity check failed" in err

@pytest.mark.asyncio
async def test_encrypted_transfer_session(tmp_path, monkeypatch):
    temp_dir = tmp_path / "temp"
    received_dir = tmp_path / "received"
    temp_dir.mkdir()
    received_dir.mkdir()
    monkeypatch.setattr(settings, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)

    manager = TransferManager()
    ciphertext = b"\x00" * 12 + b"ENCRYPTED_AES_GCM_PAYLOAD" + b"\xff" * 16

    transfer = manager.create_transfer(
        transfer_id="test-e2ee-1",
        sender_device_id="sender-e2ee",
        sender_name="Secure-Device",
        receiver_device_id="receiver-e2ee",
        receiver_name="Target-Device",
        is_folder=False,
        root_name="secret.docx",
        files_data=[{
            "file_id": "f_e2ee",
            "filename": "secret.docx",
            "relative_path": "secret.docx",
            "size": len(ciphertext),
            "sha256": None
        }],
        is_encrypted=True
    )
    assert transfer.is_encrypted is True
    transfer_dict = transfer.to_dict()
    assert transfer_dict["is_encrypted"] is True

@pytest.mark.asyncio
async def test_pause_and_resume_api(tmp_path, monkeypatch):
    import httpx
    from app.main import app
    from app.transfer.manager import transfer_manager

    temp_dir = tmp_path / "temp"
    received_dir = tmp_path / "received"
    temp_dir.mkdir()
    received_dir.mkdir()
    monkeypatch.setattr(settings, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)
    monkeypatch.setattr(db, "db_path", tmp_path / "test_api.db")
    await db.init_db()

    payload = b"Hello pause and resume test" * 50
    expected_hash = hashlib.sha256(payload).hexdigest()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create transfer
        r_create = await client.post("/api/transfers", json={
            "sender_device_id": "sender_dev",
            "sender_name": "Laptop",
            "receiver_device_id": "receiver_dev",
            "is_folder": False,
            "root_name": "pause_test.txt",
            "files": [{
                "file_id": "f_p1",
                "filename": "pause_test.txt",
                "relative_path": "pause_test.txt",
                "size": len(payload),
                "sha256": expected_hash
            }]
        })
        assert r_create.status_code == 200
        transfer_id = r_create.json()["transfer_id"]

        # Accept transfer
        r_accept = await client.post(f"/api/transfers/{transfer_id}/accept")
        assert r_accept.status_code == 200

        # Upload first chunk of 500 bytes
        chunk1 = payload[:500]
        r_c1 = await client.put(f"/api/transfers/{transfer_id}/files/f_p1/chunks?chunk_index=0&offset=0", content=chunk1)
        assert r_c1.status_code == 200

        # Pause transfer
        r_pause = await client.post(f"/api/transfers/{transfer_id}/pause")
        assert r_pause.status_code == 200
        assert r_pause.json()["status"] == "paused"

        # Resume transfer
        r_resume = await client.post(f"/api/transfers/{transfer_id}/resume")
        assert r_resume.status_code == 200
        assert r_resume.json()["status"] == "transferring"

        # Upload second chunk after resume
        chunk2 = payload[500:]
        r_c2 = await client.put(f"/api/transfers/{transfer_id}/files/f_p1/chunks?chunk_index=1&offset=500", content=chunk2)
        assert r_c2.status_code == 200
        assert r_c2.json()["file_completed"] is True
        assert r_c2.json()["transfer_completed"] is True
