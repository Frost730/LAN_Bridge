import pytest
import time
from app.security.tokens import TokenManager

def test_pairing_code_generation_and_verification():
    tm = TokenManager()
    code = tm.generate_pairing_code()
    assert len(code) == 6
    assert code.isdigit()

    # Successful verification
    assert tm.verify_pairing_code(code, "192.168.1.10") is True

    # Code should now be consumed (one-time)
    assert tm.verify_pairing_code(code, "192.168.1.10") is False

def test_pairing_code_invalid_and_rate_limiting():
    tm = TokenManager()
    code = tm.generate_pairing_code()

    # 5 wrong attempts from same IP
    ip = "192.168.1.55"
    for _ in range(5):
        assert tm.verify_pairing_code("000000", ip) is False

    # 6th attempt should be rate-limited
    assert tm.is_rate_limited(ip) is True
    assert tm.verify_pairing_code(code, ip) is False

def test_pairing_token_qr_expiration():
    tm = TokenManager()
    token = tm.generate_pairing_token()
    assert len(token) > 20

    # Valid token
    assert tm.verify_pairing_token(token) is True
    # One-time use: second attempt fails
    assert tm.verify_pairing_token(token) is False

def test_session_lifecycle():
    tm = TokenManager()
    session_token = tm.create_session("device-123", "Galaxy-S24")
    assert session_token is not None

    session = tm.validate_session(session_token)
    assert session is not None
    assert session.device_id == "device-123"
    assert session.device_name == "Galaxy-S24"

    # Revoke
    tm.revoke_session(session_token)
    assert tm.validate_session(session_token) is None

@pytest.mark.asyncio
async def test_trusted_device_api_and_auto_accept(tmp_path, monkeypatch):
    from httpx import ASGITransport, AsyncClient
    from app.main import app
    from app.database.db import db
    from app.config import settings

    monkeypatch.setattr(db, "db_path", tmp_path / "test_trusted.db")
    await db.init_db()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Add trusted device
        resp = await client.post("/api/devices/trusted", json={
            "device_id": "phone-trust-1",
            "device_name": "Alice iPhone"
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

        # 2. List trusted devices
        resp = await client.get("/api/devices/trusted")
        assert resp.status_code == 200
        devices = resp.json()
        assert any(d["device_id"] == "phone-trust-1" for d in devices)

        # 3. Create transfer from trusted device -> should be auto-accepted (transferring)
        resp = await client.post("/api/transfers", json={
            "sender_device_id": "phone-trust-1",
            "sender_name": "Alice iPhone",
            "receiver_device_id": "pc-receiver-1",
            "is_folder": False,
            "root_name": "photo.jpg",
            "files": [{
                "file_id": "f1",
                "filename": "photo.jpg",
                "relative_path": "photo.jpg",
                "size": 100
            }]
        })
        assert resp.status_code == 200
        # Should be auto-accepted into transferring state because sender is trusted!
        assert resp.json()["status"] == "transferring"

        # 4. Remove trusted device
        resp = await client.delete("/api/devices/trusted/phone-trust-1")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

        # 5. Verify no longer trusted
        resp = await client.get("/api/devices/trusted")
        assert not any(d["device_id"] == "phone-trust-1" for d in resp.json())
