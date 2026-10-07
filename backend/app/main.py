import os
import socket
import logging
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response

from .config import settings, BASE_DIR, is_cloud_env
from .database.db import db
from .websocket.manager import ws_manager
from .transfer.manager import transfer_manager
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

    # Background task for periodic stale transfer & ephemeral relay cleanup
    async def periodic_ephemeral_cleanup():
        while True:
            try:
                await asyncio.sleep(600)  # every 10 minutes
                transfer_manager.cleanup_stale_transfers()
                transfer_manager.cleanup_old_files(settings.AUTO_CLEANUP_HOURS)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"Periodic cleanup error: {e}")

    cleanup_task = asyncio.create_task(periodic_ephemeral_cleanup())

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
    cleanup_task.cancel()
    mdns_manager.stop()
    logger.info("LANBridge backend stopped cleanly")

cloud_deployment = is_cloud_env()

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    docs_url=None if cloud_deployment else "/docs",
    redoc_url=None if cloud_deployment else "/redoc",
    openapi_url=None if cloud_deployment else "/openapi.json",
    lifespan=lifespan
)

# Security Headers & Hardening Middleware
@app.middleware("http")
async def apply_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=(), payment=()"
    if cloud_deployment or request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# GZip Compression Middleware (Compresses responses >= 1000 bytes)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
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
    browser: str = Query("unknown"),
    room: Optional[str] = Query(None)
):
    forwarded_for = websocket.headers.get("x-forwarded-for")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    elif websocket.client:
        client_ip = websocket.client.host
    else:
        client_ip = "unknown"

    peer = await ws_manager.connect(
        websocket=websocket,
        device_id=device_id,
        device_name=device_name,
        device_type=device_type,
        os_name=os,
        browser=browser,
        ip=client_ip,
        initial_room=room
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
                msg_type = msg.get("type")

                # Handle temporary room commands
                if msg_type == "join_room":
                    room_name = msg.get("room")
                    if room_name:
                        ws_manager.join_room(device_id, str(room_name).strip())
                        await ws_manager.broadcast_peer_list()
                    continue
                elif msg_type == "leave_room":
                    ws_manager.leave_room(device_id)
                    await ws_manager.broadcast_peer_list()
                    continue

                # Handle peer-to-peer / room chat messages
                if msg_type == "chat_message":
                    msg["from_device_id"] = device_id
                    await ws_manager.send_chat_message(device_id, msg)
                    continue

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

DIST_DIR = BASE_DIR / "frontend" / "dist"

def get_index_response(index_path: Path) -> FileResponse:
    """Return index.html with cache-control headers so new deployments take effect immediately."""
    response = FileResponse(index_path)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

class CachedStaticFiles(StaticFiles):
    """Serve content-hashed bundle assets with 1-year immutable caching."""
    def file_response(self, *args, **kwargs) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

@app.api_route("/health", methods=["GET", "HEAD"])
@app.api_route("/healthz", methods=["GET", "HEAD"])
async def health_check():
    return {"status": "ok", "app": settings.APP_NAME, "version": settings.VERSION}

# Explicit root endpoint for Render health checker (responds 200 OK to both GET and HEAD)
@app.api_route("/", methods=["GET", "HEAD"])
async def root_index():
    index_file = DIST_DIR / "index.html"
    if index_file.is_file():
        return get_index_response(index_file)
    return Response(content="OK", media_type="text/plain", status_code=200)

# Serve built frontend in production mode
if DIST_DIR.exists():
    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", CachedStaticFiles(directory=str(assets_dir)), name="assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
    async def serve_spa(full_path: str):
        file_path = DIST_DIR / full_path
        if file_path.is_file():
            # If index.html is requested directly, ensure no-cache
            if file_path.name == "index.html":
                return get_index_response(file_path)
            res = FileResponse(file_path)
            # Manifest, icons, favicons: cache for 1 day
            if file_path.suffix.lower() in (".ico", ".png", ".jpg", ".jpeg", ".svg", ".webmanifest"):
                res.headers["Cache-Control"] = "public, max-age=86400"
            return res

        index_file = DIST_DIR / "index.html"
        if index_file.is_file():
            return get_index_response(index_file)
        return Response(content="OK", media_type="text/plain", status_code=200)
