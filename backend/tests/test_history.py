import pytest
import os
from pathlib import Path
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.config import settings
from app.database.db import db
from app.transfer.manager import TransferManager
from app.transfer.protocol import TransferState

@pytest.mark.asyncio
async def test_database_history_direct(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "db_path", tmp_path / "test_history_direct.db")
    await db.init_db()

    # Add history for sender A to receiver B
    await db.add_history(
        transfer_id="tx-1",
        device_name="Receiver B",
        direction="sent",
        filename="project.zip",
        size=1024,
        result="completed",
        sender_device_id="dev-A",
        receiver_device_id="dev-B"
    )
    await db.add_history(
        transfer_id="tx-1",
        device_name="Sender A",
        direction="received",
        filename="project.zip",
        size=1024,
        result="completed",
        sender_device_id="dev-A",
        receiver_device_id="dev-B"
    )

    # History for device A (sent)
    hist_A = await db.get_history_for_device("dev-A")
    assert len(hist_A) == 1
    assert hist_A[0]["direction"] == "sent"
    assert hist_A[0]["device_name"] == "Receiver B"

    # History for device B (received)
    hist_B = await db.get_history_for_device("dev-B")
    assert len(hist_B) == 1
    assert hist_B[0]["direction"] == "received"
    assert hist_B[0]["device_name"] == "Sender A"

    # History for unrelated device C
    hist_C = await db.get_history_for_device("dev-C")
    assert len(hist_C) == 0

    # Clear history for device A only
    await db.clear_history_for_device("dev-A")
    assert len(await db.get_history_for_device("dev-A")) == 0
    # Device B history should still exist
    assert len(await db.get_history_for_device("dev-B")) == 1

@pytest.mark.asyncio
async def test_transfer_manager_populates_both_histories(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "db_path", tmp_path / "test_history_mgr.db")
    await db.init_db()

    manager = TransferManager()
    session = manager.create_transfer(
        transfer_id="tx-mgr-1",
        sender_device_id="sender-10",
        sender_name="Alice",
        receiver_device_id="receiver-20",
        receiver_name="Bob",
        is_folder=False,
        root_name="photo.png",
        files_data=[{
            "file_id": "f1",
            "filename": "photo.png",
            "relative_path": "photo.png",
            "size": 500
        }]
    )

    # Complete transfer
    success = await manager.complete_transfer("tx-mgr-1")
    assert success is True
    completed_session = manager.get_transfer("tx-mgr-1")
    assert completed_session is not None
    assert completed_session.status == TransferState.COMPLETED

    # Check sender history
    sender_history = await db.get_history_for_device("sender-10")
    assert len(sender_history) == 1
    assert sender_history[0]["filename"] == "photo.png"
    assert sender_history[0]["direction"] == "sent"
    assert sender_history[0]["device_name"] == "Bob"

    # Check receiver history
    receiver_history = await db.get_history_for_device("receiver-20")
    assert len(receiver_history) == 1
    assert receiver_history[0]["filename"] == "photo.png"
    assert receiver_history[0]["direction"] == "received"
    assert receiver_history[0]["device_name"] == "Alice"

@pytest.mark.asyncio
async def test_api_history_endpoints(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "db_path", tmp_path / "test_history_api.db")
    await db.init_db()

    # Prepopulate history
    await db.add_history(
        transfer_id="tx-api-1",
        device_name="Phone",
        direction="sent",
        filename="report.pdf",
        size=2048,
        result="completed",
        sender_device_id="pc-1",
        receiver_device_id="phone-2"
    )
    await db.add_history(
        transfer_id="tx-api-1",
        device_name="Laptop",
        direction="received",
        filename="report.pdf",
        size=2048,
        result="completed",
        sender_device_id="pc-1",
        receiver_device_id="phone-2"
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Query with device_id=pc-1
        resp = await client.get("/api/history?device_id=pc-1")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["direction"] == "sent"
        assert data[0]["filename"] == "report.pdf"

        # Query with device_id=phone-2
        resp = await client.get("/api/history?device_id=phone-2")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["direction"] == "received"

        # Query with non-existent device
        resp = await client.get("/api/history?device_id=unknown-device")
        assert resp.status_code == 200
        assert resp.json() == []

        # DELETE for phone-2 only
        del_resp = await client.delete("/api/history?device_id=phone-2")
        assert del_resp.status_code == 200

        # phone-2 should now be empty
        resp = await client.get("/api/history?device_id=phone-2")
        assert resp.json() == []

        # pc-1 should still have record
        resp = await client.get("/api/history?device_id=pc-1")
        assert len(resp.json()) == 1

@pytest.mark.asyncio
async def test_history_no_duplicates(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "db_path", tmp_path / "test_history_dedup.db")
    await db.init_db()

    # Call add_history 3 times with the exact same transfer_id and direction
    for i in range(3):
        await db.add_history(
            transfer_id="tx-dup-1",
            device_name="Alice",
            direction="sent",
            filename="document.docx",
            size=4096,
            result="completed",
            sender_device_id="sender-xyz",
            receiver_device_id="receiver-abc"
        )

    # Must only have 1 single record, not 3!
    sender_history = await db.get_history_for_device("sender-xyz")
    assert len(sender_history) == 1

    # Now simulate TransferManager calling complete_transfer twice on the same session
    manager = TransferManager()
    session = manager.create_transfer(
        transfer_id="tx-mgr-dedup",
        sender_device_id="dev-s1",
        sender_name="Alice",
        receiver_device_id="dev-r1",
        receiver_name="Bob",
        is_folder=False,
        root_name="test.txt",
        files_data=[{"file_id": "f1", "filename": "test.txt", "relative_path": "test.txt", "size": 100}]
    )

    # First complete
    await manager.complete_transfer("tx-mgr-dedup")
    # Second complete (e.g. from both frontend calls or chunk finished)
    await manager.complete_transfer("tx-mgr-dedup")

    s1_history = await db.get_history_for_device("dev-s1")
    assert len(s1_history) == 1
    r1_history = await db.get_history_for_device("dev-r1")
    assert len(r1_history) == 1

