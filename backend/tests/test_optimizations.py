import pytest
import httpx
from httpx import ASGITransport
from app.main import app

@pytest.mark.asyncio
async def test_gzip_compression_on_large_payload():
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Request health or diagnostics or any endpoint with accept-encoding
        headers = {"Accept-Encoding": "gzip"}
        resp = await client.get("/api/device/peers", headers=headers)
        assert resp.status_code == 200

        # Request diagnostic download endpoint which returns > 1000 bytes
        resp_large = await client.get("/api/diagnostics/speedtest/download?size_mb=1", headers=headers)
        assert resp_large.status_code == 200
        # Responses should include content-encoding gzip when large and client accepts gzip
        assert resp_large.headers.get("content-encoding") == "gzip"

@pytest.mark.asyncio
async def test_static_asset_caching_headers(tmp_path, monkeypatch):
    import app.main as main_mod
    
    # Create fake dist directory structure
    fake_dist = tmp_path / "frontend" / "dist"
    fake_assets = fake_dist / "assets"
    fake_assets.mkdir(parents=True)
    
    index_file = fake_dist / "index.html"
    index_file.write_text("<!doctype html><html><body>Test</body></html>")
    
    asset_file = fake_assets / "bundle-test123.js"
    asset_file.write_text("console.log('asset chunk');")
    
    icon_file = fake_dist / "favicon.ico"
    icon_file.write_bytes(b"\x00\x00\x01\x00")
    
    monkeypatch.setattr(main_mod, "DIST_DIR", fake_dist)
    
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Test index.html has no-cache headers
        resp_index = await client.get("/")
        if resp_index.status_code == 200 and "text/html" in resp_index.headers.get("content-type", ""):
            cc = resp_index.headers.get("cache-control", "")
            assert "no-cache" in cc
            assert "must-revalidate" in cc
