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

from .routes_device import is_cloud_env

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])

@router.get("")
async def get_diagnostics(request: Request) -> Dict[str, Any]:
    cloud_active = is_cloud_env()
    
    if cloud_active:
        public_host = request.headers.get("x-forwarded-host") or request.url.hostname or "Cloud Relay"
        interfaces = [
            {
                "name": "Cloud Edge Gateway",
                "ip": public_host,
                "netmask": "HTTPS / TLS",
                "is_default": True
            }
        ]
        primary_ip = public_host
        port_num = 443
        os_display = "Cloud Container (Linux / Docker)"
        python_display = "3.11 (Hardened)"
        discovered_mdns = []
        total_storage = 50 * 1024 * 1024 * 1024
        free_storage = 50 * 1024 * 1024 * 1024
    else:
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
        total_storage, _, free_storage = shutil.disk_usage(str(settings.RECEIVED_DIR))
        port_num = settings.PORT
        os_display = f"{platform.system()} {platform.release()}"
        python_display = platform.python_version()
        discovered_mdns = mdns_manager.get_discovered_hosts()

    if cloud_active:
        hostname = "Cloud Edge Gateway"
        device_name = "Cloud Relay Host"
        primary_ip = "Protected"
    else:
        hostname = socket.gethostname()
        device_name = await db.get_setting("device_name", hostname)

    return {
        "device_name": device_name,
        "hostname": hostname,
        "host_ip": primary_ip,
        "server_port": port_num,
        "interfaces": interfaces,
        "connected_devices_count": len(ws_manager.get_online_devices()),
        "discovered_lan_hosts": discovered_mdns,
        "os_name": os_display,
        "python_version": python_display,
        "app_version": settings.VERSION,
        "storage_total_bytes": total_storage,
        "storage_free_bytes": free_storage,
        "is_https": request.url.scheme == "https" or cloud_active,
        "is_cloud": cloud_active
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
