import os
import socket
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .config import settings, BASE_DIR
from .database.db import db
from .websocket.manager import ws_manager
from .discovery.interfaces import get_primary_lan_ip
from .discovery.mdns import mdns_manager

from .api.routes_device import router as device_router
from .api.routes_pair import router as pair_router
from .api.routes_transfers import router as transfers_router
from .api.routes_history import router as history_router
from .api.routes_diagnostics import router as diagnostics_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("lanbridge")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db.init_db()

    # Ensure host device identity
    host_id = await db.get_setting("host_device_id", None)
    if not host_id:
        import uuid
        host_id = str(uuid.uuid4())
        await db.set_setting("host_device_id", host_id)

    host_name = await db.get_setting("device_name", None)
    if not host_name:
        host_name = socket.gethostname() or "LANBridge-Host"
        await db.set_setting("device_name", host_name)

    ws_manager.set_host_device_id(host_id)

    # Start mDNS discovery service
    mdns_manager.start(host_name, settings.PORT, host_id)

    primary_ip = get_primary_lan_ip()
    port = settings.PORT

    print("\n" + "=" * 55)
    print("  >> LANBridge -- Local Network File Transfer")
    print("=" * 55)
    print(f"  This device:\n    http://localhost:{port}")
    print(f"\n  Other devices on your LAN:\n    http://{primary_ip}:{port}")
    print("=" * 55 + "\n")

    yield

    # Shutdown
    mdns_manager.stop()
    logger.info("LANBridge backend stopped cleanly")

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    lifespan=lifespan
)

# CORS configuration for LAN devices
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Routers
app.include_router(device_router)
app.include_router(pair_router)
app.include_router(transfers_router)
app.include_router(history_router)
app.include_router(diagnostics_router)

# WebSocket Endpoint for Real-time Signaling
@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    device_id: str = Query(...),
    device_name: str = Query("Unknown Device"),
    device_type: str = Query("desktop"),
    os: str = Query("unknown"),
    browser: str = Query("unknown")
):
    client_ip = websocket.client.host if websocket.client else "unknown"
    peer = await ws_manager.connect(
        websocket=websocket,
        device_id=device_id,
        device_name=device_name,
        device_type=device_type,
        os_name=os,
        browser=browser,
        ip=client_ip
    )
    try:
        while True:
            data = await websocket.receive_text()
            # Handle client-side ping/heartbeat
            if data == "ping":
                await websocket.send_text("pong")
                continue

            # Handle WebRTC signaling and targeted peer messaging
            try:
                import json
                msg = json.loads(data)
                target_id = msg.get("target_device_id")
                if target_id:
                    msg["from_device_id"] = device_id
                    await ws_manager.send_to_device(target_id, msg)
            except Exception:
                pass
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception as e:
        logger.debug(f"WebSocket error: {e}")
        await ws_manager.disconnect(websocket)

# Serve built frontend in production mode
DIST_DIR = BASE_DIR / "frontend" / "dist"
if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = DIST_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(DIST_DIR / "index.html")
