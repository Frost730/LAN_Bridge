import logging
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from typing import Dict, Any, Optional
from ..config import settings
from ..security.tokens import token_manager
from ..database.db import db
from ..websocket.manager import ws_manager
from ..discovery.interfaces import get_primary_lan_ip
from ..models.schemas import PairRequestPayload, PairApprovalPayload

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/pair", tags=["pair"])

# Store in-memory pending pairing requests: device_id -> details
pending_pair_requests: Dict[str, dict] = {}

@router.post("/code")
async def get_or_create_pairing_code() -> Dict[str, Any]:
    active = token_manager.get_current_pairing_code()
    if active:
        code, remaining = active
    else:
        code = token_manager.generate_pairing_code()
        remaining = settings.PAIRING_CODE_EXPIRY_SECONDS
    return {
        "code": code,
        "formatted": f"{code[:3]} {code[3:]}",
        "expires_in_seconds": remaining
    }

@router.post("/token")
async def generate_qr_pairing_token(request: Request) -> Dict[str, Any]:
    token = token_manager.generate_pairing_token()
    primary_ip = get_primary_lan_ip()
    port = settings.PORT
    url = f"http://{primary_ip}:{port}/?pair={token}"
    return {
        "token": token,
        "connect_url": url,
        "expires_in_seconds": settings.PAIRING_TOKEN_EXPIRY_SECONDS
    }

@router.post("/request")
async def request_pairing(payload: PairRequestPayload, request: Request) -> Dict[str, Any]:
    client_ip = request.client.host if request.client else "unknown"

    # 1. Check if device is already trusted
    if await db.is_trusted_device(payload.device_id):
        session_token = token_manager.create_session(payload.device_id, payload.device_name)
        await db.upsert_device(
            device_id=payload.device_id,
            name=payload.device_name,
            device_type=payload.device_type,
            os_name=payload.os,
            browser=payload.browser,
            ip=client_ip
        )
        return {
            "status": "approved",
            "session_token": session_token,
            "message": "Trusted device connected automatically"
        }

    # 2. Verify code or token if provided
    is_valid = False
    if payload.pairing_token:
        is_valid = token_manager.verify_pairing_token(payload.pairing_token)
        if not is_valid:
            raise HTTPException(status_code=400, detail="Invalid or expired QR pairing token")
    elif payload.pairing_code:
        is_valid = token_manager.verify_pairing_code(payload.pairing_code, client_ip)
        if not is_valid:
            raise HTTPException(status_code=400, detail="Invalid or expired 6-digit pairing code")
    else:
        raise HTTPException(status_code=400, detail="Pairing code or QR token required")

    # 3. Check if host requires approval
    require_approval = await db.get_setting("require_approval", True)
    if not require_approval:
        session_token = token_manager.create_session(payload.device_id, payload.device_name)
        await db.upsert_device(
            device_id=payload.device_id,
            name=payload.device_name,
            device_type=payload.device_type,
            os_name=payload.os,
            browser=payload.browser,
            ip=client_ip
        )
        return {
            "status": "approved",
            "session_token": session_token,
            "message": "Connected successfully"
        }

    # 4. Save to pending and notify host via WebSocket
    pending_pair_requests[payload.device_id] = {
        "device_id": payload.device_id,
        "device_name": payload.device_name,
        "device_type": payload.device_type,
        "os": payload.os,
        "browser": payload.browser,
        "ip_address": client_ip
    }

    # Notify host or broadcast
    await ws_manager.broadcast({
        "type": "pair_request",
        "device": pending_pair_requests[payload.device_id]
    })

    return {
        "status": "pending",
        "message": "Pairing request sent. Waiting for host approval..."
    }

@router.post("/approve")
async def approve_pairing(payload: PairApprovalPayload) -> Dict[str, Any]:
    pending = pending_pair_requests.pop(payload.device_id, None)
    device_name = pending["device_name"] if pending else "Paired Device"

    if payload.trust_device:
        await db.trust_device(payload.device_id, device_name)

    session_token = token_manager.create_session(payload.device_id, device_name)

    # Notify the client via WebSocket
    await ws_manager.send_to_device(payload.device_id, {
        "type": "pair_approved",
        "session_token": session_token,
        "device_id": payload.device_id
    })

    return {"status": "ok", "message": f"Approved {device_name}"}

@router.post("/reject")
async def reject_pairing(payload: PairApprovalPayload) -> Dict[str, Any]:
    pending = pending_pair_requests.pop(payload.device_id, None)
    device_name = pending["device_name"] if pending else "Device"

    await ws_manager.send_to_device(payload.device_id, {
        "type": "pair_rejected",
        "device_id": payload.device_id,
        "message": "Pairing request was declined"
    })

    return {"status": "ok", "message": f"Rejected {device_name}"}
