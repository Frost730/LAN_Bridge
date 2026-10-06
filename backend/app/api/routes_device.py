import os
import sys
import socket
import platform
from fastapi import APIRouter, Request, HTTPException
from typing import List, Dict, Any
from ..database.db import db
from ..websocket.manager import ws_manager
from ..discovery.interfaces import get_primary_lan_ip
from ..models.schemas import DeviceInfo, AppSettings

router = APIRouter(prefix="/api", tags=["device"])

def is_cloud_env() -> bool:
    return bool(
        os.getenv("RENDER")
        or os.getenv("LANBRIDGE_CLOUD")
        or os.getenv("SPACE_ID")
        or (os.getenv("PORT") and not getattr(sys, "frozen", False))
    )

@router.get("/device")
async def get_host_device(request: Request) -> Dict[str, Any]:
    cloud_active = is_cloud_env()
    
    if cloud_active:
        saved_name = "Cloud Relay Host"
        os_display = "Cloud Platform"
        browser_display = "Cloud Relay"
        primary_ip = "Protected"
    else:
        saved_name = await db.get_setting("device_name", None)
        if not saved_name or saved_name.startswith("srv-"):
            saved_name = socket.gethostname() or "LANBridge-Host"
            await db.set_setting("device_name", saved_name)
        os_display = platform.system()
        browser_display = "Host Server"
        primary_ip = get_primary_lan_ip()

    host_id = await db.get_setting("host_device_id", None)
    if not host_id:
        import uuid
        host_id = str(uuid.uuid4())
        await db.set_setting("host_device_id", host_id)

    ws_manager.set_host_device_id(host_id)

    return {
        "device_id": host_id,
        "device_name": saved_name,
        "device_type": "desktop",
        "os": os_display,
        "browser": browser_display,
        "ip_address": primary_ip,
        "is_host": True,
        "online": True,
        "is_cloud": cloud_active,
        "can_shutdown": not cloud_active
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
async def list_connected_devices(request: Request, device_id: Optional[str] = None) -> List[Dict[str, Any]]:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    elif request.client:
        client_ip = request.client.host
    else:
        client_ip = "unknown"

    # Get active websocket devices isolated to same Wi-Fi/network room or explicitly paired
    online_peers = ws_manager.get_online_devices(for_device_id=device_id, client_ip=client_ip)
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

@router.post("/devices/{device_id}/disconnect")
async def disconnect_device(device_id: str, untrust: bool = False) -> Dict[str, Any]:
    from ..security.tokens import token_manager
    token_manager.revoke_device_sessions(device_id)
    if untrust:
        await db.remove_trusted_device(device_id)
    disconnected = await ws_manager.disconnect_device(device_id)
    return {"status": "ok", "device_id": device_id, "disconnected": disconnected}

@router.get("/settings")
async def get_settings() -> Dict[str, Any]:
    cloud_active = is_cloud_env()
    default_name = "Cloud Relay Host" if cloud_active else socket.gethostname()
    saved_name = await db.get_setting("device_name", default_name)
    if cloud_active and (saved_name.startswith("srv-") or "hibernate" in saved_name):
        saved_name = "Cloud Relay Host"
        await db.set_setting("device_name", saved_name)

    return {
        "device_name": saved_name,
        "server_port": 443 if cloud_active else await db.get_setting("server_port", 8000),
        "require_approval": False if cloud_active else await db.get_setting("require_approval", True),
        "concurrent_transfers": await db.get_setting("concurrent_transfers", 3),
        "chunk_size": await db.get_setting("chunk_size", 2097152),
        "performance_mode": await db.get_setting("performance_mode", False),
        "notifications": await db.get_setting("notifications", True),
        "theme": await db.get_setting("theme", "system")
    }

@router.put("/settings")
async def update_settings(new_settings: Dict[str, Any]) -> Dict[str, Any]:
    cloud_active = is_cloud_env()
    for k, v in new_settings.items():
        if cloud_active and k in ("device_name", "server_port"):
            continue
        await db.set_setting(k, v)
    return {"status": "ok"}

@router.post("/shutdown")
async def shutdown_server():
    """Cleanly exit the host server process when running in windowed/noconsole mode."""
    if is_cloud_env():
        raise HTTPException(
            status_code=403,
            detail="Server shutdown is disabled in cloud hosting environments."
        )
    import threading
    import time
    def _exit():
        time.sleep(0.5)
        os._exit(0)
    threading.Thread(target=_exit, daemon=True).start()
    return {"status": "shutting_down", "message": "LANBridge server is shutting down..."}

@router.post("/restart")
async def restart_server():
    """Restart the host server process."""
    if is_cloud_env():
        raise HTTPException(
            status_code=403,
            detail="Server restart is managed automatically by your cloud platform."
        )
    import sys
    import subprocess
    import threading
    import time
    
    def _do_restart():
        time.sleep(0.5)
        try:
            if getattr(sys, "frozen", False):
                exe_path = sys.executable
                if os.name == "nt":
                    cmd = f'timeout /t 1 /nobreak >nul & "{exe_path}"'
                    subprocess.Popen(cmd, shell=True, close_fds=True)
                else:
                    subprocess.Popen([exe_path], close_fds=True)
            else:
                py_exe = sys.executable
                args = [py_exe] + sys.argv
                if os.name == "nt":
                    quoted_args = " ".join(f'"{a}"' for a in sys.argv)
                    cmd = f'timeout /t 1 /nobreak >nul & "{py_exe}" {quoted_args}'
                    subprocess.Popen(cmd, shell=True, close_fds=True)
                else:
                    subprocess.Popen(args, close_fds=True)
        except Exception:
            pass
        finally:
            os._exit(0)

    threading.Thread(target=_do_restart, daemon=True).start()
    return {"status": "restarting", "message": "LANBridge server is restarting..."}
