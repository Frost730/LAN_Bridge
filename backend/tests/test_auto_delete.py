import pytest
import os
import time
from pathlib import Path
import httpx
from httpx import ASGITransport

from app.main import app
from app.config import settings
from app.database.db import db
from app.transfer.manager import transfer_manager
from app.transfer.protocol import TransferState, FileTransferState, ActiveFile

@pytest.mark.asyncio
async def test_auto_delete_on_single_file_download(tmp_path, monkeypatch):
    received_dir = tmp_path / "received"
    received_dir.mkdir(parents=True, exist_ok=True)
    temp_dir = tmp_path / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)
    monkeypatch.setattr(settings, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(settings, "AUTO_DELETE_ON_DOWNLOAD", True)
    monkeypatch.setattr(db, "db_path", tmp_path / "test_autodel.db")
    await db.init_db()

    # Create dummy finalized file
    test_file = received_dir / "ephemeral_secret.pdf"
    content = b"Super confidential PDF content"
    test_file.write_bytes(content)

    session = transfer_manager.create_transfer(
        transfer_id="xfer-autodel-1",
        sender_device_id="sender1",
        sender_name="Alice",
        receiver_device_id="receiver1",
        receiver_name="Bob",
        is_folder=False,
        root_name="ephemeral_secret.pdf",
        files_data=[{
            "file_id": "file-1",
            "filename": "ephemeral_secret.pdf",
            "relative_path": "ephemeral_secret.pdf",
            "size": len(content)
        }]
    )
    file_obj = session.files["file-1"]
    file_obj.final_filepath = str(test_file)
    file_obj.status = FileTransferState.COMPLETED
    session.status = TransferState.COMPLETED

    assert test_file.exists()

    # Perform download request
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/transfers/xfer-autodel-1/files/file-1/download")
        assert resp.status_code == 200
        assert resp.content == content

    # The file should be purged from disk immediately
    assert not test_file.exists()

@pytest.mark.asyncio
async def test_no_delete_when_auto_delete_disabled(tmp_path, monkeypatch):
    received_dir = tmp_path / "received"
    received_dir.mkdir(parents=True, exist_ok=True)
    temp_dir = tmp_path / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)
    monkeypatch.setattr(settings, "TEMP_DIR", temp_dir)
    monkeypatch.setattr(settings, "AUTO_DELETE_ON_DOWNLOAD", False)
    monkeypatch.setattr(db, "db_path", tmp_path / "test_nodelete.db")
    await db.init_db()

    test_file = received_dir / "keep_local.txt"
    content = b"Keep this file permanently"
    test_file.write_bytes(content)

    session = transfer_manager.create_transfer(
        transfer_id="xfer-keep-1",
        sender_device_id="sender1",
        sender_name="Alice",
        receiver_device_id="receiver1",
        receiver_name="Bob",
        is_folder=False,
        root_name="keep_local.txt",
        files_data=[{
            "file_id": "f-keep",
            "filename": "keep_local.txt",
            "relative_path": "keep_local.txt",
            "size": len(content)
        }]
    )
    file_obj = session.files["f-keep"]
    file_obj.final_filepath = str(test_file)
    file_obj.status = FileTransferState.COMPLETED

    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/transfers/xfer-keep-1/files/f-keep/download")
        assert resp.status_code == 200
        assert resp.content == content

    # File must still exist when auto-delete is disabled
    assert test_file.exists()

@pytest.mark.asyncio
async def test_auto_delete_on_zip_download(tmp_path, monkeypatch):
    received_dir = tmp_path / "received"
    received_dir.mkdir(parents=True, exist_ok=True)
    
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)
    monkeypatch.setattr(settings, "AUTO_DELETE_ON_DOWNLOAD", True)
    monkeypatch.setattr(db, "db_path", tmp_path / "test_zipdel.db")
    await db.init_db()

    f1 = received_dir / "doc1.txt"
    f2 = received_dir / "doc2.txt"
    f1.write_bytes(b"Document 1")
    f2.write_bytes(b"Document 2")

    session = transfer_manager.create_transfer(
        transfer_id="xfer-zip-1",
        sender_device_id="sender1",
        sender_name="Alice",
        receiver_device_id="receiver1",
        receiver_name="Bob",
        is_folder=True,
        root_name="project_folder",
        files_data=[
            {"file_id": "z1", "filename": "doc1.txt", "relative_path": "project_folder/doc1.txt", "size": 10},
            {"file_id": "z2", "filename": "doc2.txt", "relative_path": "project_folder/doc2.txt", "size": 10}
        ]
    )
    session.files["z1"].final_filepath = str(f1)
    session.files["z2"].final_filepath = str(f2)

    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/transfers/xfer-zip-1/download-zip")
        assert resp.status_code == 200
        assert len(resp.content) > 0

    # Both files must be removed
    assert not f1.exists()
    assert not f2.exists()

def test_stale_ephemeral_file_cleanup(tmp_path, monkeypatch):
    received_dir = tmp_path / "received"
    received_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "RECEIVED_DIR", received_dir)
    monkeypatch.setattr(settings, "AUTO_DELETE_ON_DOWNLOAD", True)

    stale_file = received_dir / "abandoned_relay.dat"
    stale_file.write_bytes(b"Forgotten transfer payload")
    
    # Backdate modified time to 2 hours ago
    past_time = time.time() - (2 * 3600)
    os.utime(str(stale_file), (past_time, past_time))

    fresh_file = received_dir / "active_relay.dat"
    fresh_file.write_bytes(b"Fresh transfer")

    # Run cleanup with 1 hour threshold
    transfer_manager.cleanup_old_files(max_age_hours=1)

    assert not stale_file.exists()
    assert fresh_file.exists()
