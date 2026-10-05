import os
import socket
import platform
from fastapi import APIRouter, Request, HTTPException
from typing import List, Dict, Any
from ..database.db import db
from ..websocket.manager import ws_manager
from ..discovery.interfaces import get_primary_lan_ip
from ..models.schemas import DeviceInfo, AppSettings

router = APIRouter(prefix="/api", tags=["device"])

@router.get("/device")
async def get_host_device(request: Request) -> Dict[str, Any]:
    saved_name = await db.get_setting("device_name", None)
    if not saved_name:
        saved_name = socket.gethostname() or "LANBridge-Host"
        await db.set_setting("device_name", saved_name)

    host_id = await db.get_setting("host_device_id", None)
    if not host_id:
        import uuid
        host_id = str(uuid.uuid4())
        await db.set_setting("host_device_id", host_id)

    ws_manager.set_host_device_id(host_id)
    primary_ip = get_primary_lan_ip()

    return {
        "device_id": host_id,
        "device_name": saved_name,
        "device_type": "desktop",
        "os": platform.system(),
        "browser": "Host Server",
        "ip_address": primary_ip,
        "is_host": True,
        "online": True
    }

@router.put("/device")
async def update_device_name(payload: Dict[str, str]) -> Dict[str, Any]:
    new_name = payload.get("device_name", "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Device name cannot be empty")
    await db.set_setting("device_name", new_name)
    await ws_manager.broadcast_peer_list()
    return {"status": "ok", "device_name": new_name}

@router.get("/devices")
async def list_connected_devices() -> List[Dict[str, Any]]:
    # Get active websocket devices
    online_peers = ws_manager.get_online_devices()
    # Enrich with trusted status from DB
    for peer in online_peers:
        peer["is_trusted"] = await db.is_trusted_device(peer["device_id"])
    return online_peers

@router.get("/devices/trusted")
async def list_trusted_devices() -> List[Dict[str, Any]]:
    return await db.get_trusted_devices()

@router.delete("/devices/trusted/{device_id}")
async def remove_trusted_device(device_id: str) -> Dict[str, Any]:
    await db.remove_trusted_device(device_id)
    return {"status": "ok", "device_id": device_id}

@router.get("/settings")
async def get_settings() -> Dict[str, Any]:
    return {
        "device_name": await db.get_setting("device_name", socket.gethostname()),
        "server_port": await db.get_setting("server_port", 8000),
        "require_approval": await db.get_setting("require_approval", True),
        "concurrent_transfers": await db.get_setting("concurrent_transfers", 3),
        "chunk_size": await db.get_setting("chunk_size", 2097152),
        "performance_mode": await db.get_setting("performance_mode", False),
        "notifications": await db.get_setting("notifications", True),
        "theme": await db.get_setting("theme", "system")
    }

@router.put("/settings")
async def update_settings(new_settings: Dict[str, Any]) -> Dict[str, Any]:
    for k, v in new_settings.items():
        await db.set_setting(k, v)
    return {"status": "ok"}
