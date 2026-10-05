import os
import shutil
import platform
import socket
import sys
import time
from fastapi import APIRouter, Request
from fastapi.responses import Response, StreamingResponse
from typing import Dict, Any, List
from ..config import settings
from ..database.db import db
from ..websocket.manager import ws_manager
from ..discovery.interfaces import get_primary_lan_ip, get_all_interfaces
from ..discovery.mdns import mdns_manager

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])

@router.get("")
async def get_diagnostics(request: Request) -> Dict[str, Any]:
    primary_ip = get_primary_lan_ip()
    interfaces_raw = get_all_interfaces()
    interfaces = [
        {
            "name": name,
            "ip": ip,
            "netmask": netmask,
            "is_default": is_primary
        }
        for name, ip, netmask, is_primary in interfaces_raw
    ]

    total, used, free = shutil.disk_usage(str(settings.RECEIVED_DIR))
    hostname = socket.gethostname()
    device_name = await db.get_setting("device_name", hostname)

    # Discovered mDNS hosts
    discovered_mdns = mdns_manager.get_discovered_hosts()

    return {
        "device_name": device_name,
        "hostname": hostname,
        "host_ip": primary_ip,
        "server_port": settings.PORT,
        "interfaces": interfaces,
        "connected_devices_count": len(ws_manager.get_online_devices()),
        "discovered_lan_hosts": discovered_mdns,
        "os_name": f"{platform.system()} {platform.release()}",
        "python_version": platform.python_version(),
        "app_version": settings.VERSION,
        "storage_total_bytes": total,
        "storage_free_bytes": free,
        "is_https": request.url.scheme == "https"
    }

@router.get("/speedtest/ping")
async def ping() -> Dict[str, Any]:
    return {"status": "pong", "server_time": time.time()}

@router.post("/speedtest/upload")
async def speedtest_upload(request: Request) -> Dict[str, Any]:
    """Measures LAN upload throughput by receiving chunks without saving to disk"""
    start = time.time()
    total_bytes = 0
    async for chunk in request.stream():
        total_bytes += len(chunk)
    elapsed = max(0.001, time.time() - start)
    mbps = (total_bytes * 8) / (elapsed * 1024 * 1024)
    mb_per_sec = (total_bytes / (1024 * 1024)) / elapsed
    return {
        "bytes_received": total_bytes,
        "elapsed_seconds": round(elapsed, 4),
        "mbps": round(mbps, 2),
        "mb_per_sec": round(mb_per_sec, 2)
    }

@router.get("/speedtest/download")
async def speedtest_download(size_mb: int = 10):
    """Generates dummy data stream for measuring local LAN download throughput"""
    clamped_size = min(max(1, size_mb), 100)  # Between 1MB and 100MB
    chunk = b"\x00" * (1024 * 1024)  # 1MB chunk

    async def generate_chunks():
        for _ in range(clamped_size):
            yield chunk

    return StreamingResponse(
        generate_chunks(),
        media_type="application/octet-stream",
        headers={"Content-Length": str(clamped_size * 1024 * 1024)}
    )
