import pytest
import os
from pathlib import Path
from app.security.sanitization import sanitize_filename, sanitize_relative_path, get_unique_destination_path, is_safe_subpath
from app.main import app, is_allowed_origin
from httpx import ASGITransport
import httpx

def test_sanitize_filename_basic():
    assert sanitize_filename("simple.txt") == "simple.txt"
    assert sanitize_filename("My Vacation Photo.JPG") == "My Vacation Photo.JPG"

def test_sanitize_filename_unsafe_chars():
    # Invalid characters: < > : " | ? *
    assert ":" not in sanitize_filename("video:stream.mp4")
    assert "<" not in sanitize_filename("file<1>.zip")
    assert "?" not in sanitize_filename("who?where.pdf")
    assert "*" not in sanitize_filename("all*files.txt")
    assert "\0" not in sanitize_filename("evil.txt\0.png")

def test_sanitize_filename_windows_reserved():
    assert sanitize_filename("CON.txt") == "safe_CON.txt"
    assert sanitize_filename("prn.doc") == "safe_prn.doc"
    assert sanitize_filename("AUX") == "safe_AUX"
    assert sanitize_filename("NUL") == "safe_NUL"

def test_sanitize_filename_empty_or_dots():
    assert sanitize_filename("") == "unnamed_file"
    assert sanitize_filename(".") == "unnamed_file"
    assert sanitize_filename("..") == "unnamed_file"

def test_sanitize_relative_path_traversal_attempts(tmp_path):
    base_dir = tmp_path / "received"
    base_dir.mkdir()

    # Traversals using ../ or ..\
    traversal_attacks = [
        "../../test.txt",
        "..\\..\\test.txt",
        "/etc/passwd",
        "/var/log/syslog",
        "C:\\Windows\\System32\\cmd.exe",
        "C:secret.txt",
        "subfolder/../../../escape.txt",
        "a/b/../../../../root.txt"
    ]

    for attack in traversal_attacks:
        # Either sanitizes to inside base_dir or raises ValueError
        try:
            resolved = sanitize_relative_path(attack, base_dir)
            # Crucial: must be strictly inside base_dir
            assert os.path.commonpath([str(base_dir.resolve()), str(resolved)]) == str(base_dir.resolve())
            assert not str(resolved).lower().startswith("c:\\windows")
            assert str(resolved) != "/etc/passwd"
        except ValueError:
            # Traversal safely blocked by exception
            pass

def test_sanitize_relative_path_legitimate_nested_folders(tmp_path):
    base_dir = tmp_path / "received"
    base_dir.mkdir()

    valid_folder_path = "Project/src/components/App.tsx"
    resolved = sanitize_relative_path(valid_folder_path, base_dir)

    assert os.path.commonpath([str(base_dir.resolve()), str(resolved)]) == str(base_dir.resolve())
    assert resolved.name == "App.tsx"
    assert "components" in str(resolved)

def test_get_unique_destination_path(tmp_path):
    target = tmp_path / "document.txt"
    target.write_text("first")

    unique1 = get_unique_destination_path(target)
    assert unique1.name == "document (1).txt"

    unique1.write_text("second")
    unique2 = get_unique_destination_path(target)
    assert unique2.name == "document (2).txt"

def test_is_safe_subpath(tmp_path):
    base = tmp_path / "base"
    base.mkdir()
    inside = base / "nested" / "file.txt"
    outside = tmp_path / "outside.txt"

    assert is_safe_subpath(inside, base) is True
    assert is_safe_subpath(outside, base) is False
    assert is_safe_subpath(base / ".." / "outside.txt", base) is False

def test_cors_origin_validator():
    assert is_allowed_origin("http://localhost:3000") is True
    assert is_allowed_origin("http://127.0.0.1:5173") is True
    assert is_allowed_origin("http://192.168.1.55:8000") is True
    assert is_allowed_origin("http://10.0.0.4:8000") is True
    assert is_allowed_origin("https://lanbridge.onrender.com") is True
    assert is_allowed_origin("http://my-pc.local:8000") is True
    # Malicious external origin should be blocked
    assert is_allowed_origin("https://evil.com") is False
    assert is_allowed_origin("https://attacker.net") is False

@pytest.mark.asyncio
async def test_remote_shutdown_blocked():
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Remote IP attempting shutdown must receive 403 Forbidden
        resp = await client.post("/api/shutdown", headers={"x-forwarded-for": "203.0.113.195"})
        assert resp.status_code == 403

@pytest.mark.asyncio
async def test_remote_restart_blocked():
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Remote IP attempting restart must receive 403 Forbidden
        resp = await client.post("/api/restart", headers={"x-forwarded-for": "198.51.100.22"})
        assert resp.status_code == 403

@pytest.mark.asyncio
async def test_chunk_upload_boundary_checks():
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Negative chunk parameters must be rejected
        resp = await client.put(
            "/api/transfers/fake-id/files/fake-f/chunks?chunk_index=-1&offset=0",
            content=b"test"
        )
        assert resp.status_code == 400

        # Oversized chunk header > 32MB must be rejected with 413
        resp2 = await client.put(
            "/api/transfers/fake-id/files/fake-f/chunks?chunk_index=0&offset=0",
            headers={"content-length": "35000000"},
            content=b""
        )
        assert resp2.status_code == 413

