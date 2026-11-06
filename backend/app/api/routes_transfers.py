import os
import io
import time
import uuid
import zipfile
import logging
import asyncio
from pathlib import Path
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Request, HTTPException, Query, Header, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse

from ..config import settings
from ..database.db import db
from ..transfer.protocol import TransferState, FileTransferState
from ..transfer.manager import transfer_manager
from ..websocket.manager import ws_manager
from ..models.schemas import TransferCreatePayload
from ..security.sanitization import sanitize_filename, is_safe_subpath

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/transfers", tags=["transfers"])

@router.post("")
async def create_transfer(payload: TransferCreatePayload) -> Dict[str, Any]:
    transfer_id = str(uuid.uuid4())
    safe_root_name = sanitize_filename(payload.root_name) if payload.root_name else "Transfer"
    sanitized_files = []
    for f in payload.files:
        fd = f.model_dump()
        fd["filename"] = sanitize_filename(fd.get("filename", "unnamed_file"))
        raw_rel = (fd.get("relative_path") or fd["filename"]).replace("\\", "/").lstrip("/")
        parts = [sanitize_filename(p) for p in raw_rel.split("/") if p and p not in (".", "..")]
        fd["relative_path"] = "/".join(parts) if parts else fd["filename"]
        sanitized_files.append(fd)

    session = transfer_manager.create_transfer(
        transfer_id=transfer_id,
        sender_device_id=payload.sender_device_id,
        sender_name=payload.sender_name[:64],
        receiver_device_id=payload.receiver_device_id,
        receiver_name="Target Device",
        is_folder=payload.is_folder,
        root_name=safe_root_name,
        files_data=sanitized_files,
        chunk_size=payload.chunk_size or 2097152,
        is_encrypted=bool(payload.is_encrypted),
        encryption_key=payload.encryption_key
    )

    # Check if sender is a trusted device or auto-approval is enabled
    is_trusted = await db.is_trusted_device(payload.sender_device_id)
    require_approval = await db.get_setting("require_approval", True)

    if is_trusted or not require_approval:
        transfer_manager.accept_transfer(transfer_id)
        # Notify sender to start streaming immediately (direct + broadcast for multi-tab / reconnect reliability)
        accept_event = {
            "type": "transfer_accepted",
            "transfer_id": transfer_id,
            "sender_device_id": payload.sender_device_id,
            "receiver_device_id": payload.receiver_device_id,
            "transfer": session.to_dict()
        }
        await ws_manager.send_to_device(payload.sender_device_id, accept_event)
        await ws_manager.broadcast(accept_event)
        await ws_manager.broadcast({
            "type": "transfer_created",
            "transfer": session.to_dict()
        })
        return session.to_dict()

    # Notify receiver via WebSocket for approval
    await ws_manager.send_to_device(payload.receiver_device_id, {
        "type": "transfer_requested",
        "transfer": session.to_dict()
    })
    # Also broadcast for visibility across host and paired tabs
    await ws_manager.broadcast({
        "type": "transfer_created",
        "transfer": session.to_dict()
    })

    return session.to_dict()

from .routes_device import is_cloud_env

@router.get("")
async def list_transfers(device_id: Optional[str] = Query(None)) -> List[Dict[str, Any]]:
    transfers = transfer_manager.get_all_transfers()
    if is_cloud_env():
        if not device_id:
            return []
        return [t for t in transfers if t.get("sender_device_id") == device_id or t.get("receiver_device_id") == device_id]
    if device_id:
        return [t for t in transfers if t.get("sender_device_id") == device_id or t.get("receiver_device_id") == device_id]
    return transfers

@router.get("/{transfer_id}")
async def get_transfer(transfer_id: str) -> Dict[str, Any]:
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return session.to_dict()

@router.post("/{transfer_id}/accept")
async def accept_transfer(transfer_id: str, trust_device: bool = Query(False)) -> Dict[str, Any]:
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")

    # If trust_device requested, register sender as trusted device
    if trust_device and session.sender_device_id:
        await db.trust_device(session.sender_device_id, session.sender_name)
        await ws_manager.broadcast_peer_list()

    # Idempotent check: if already accepted / transferring, avoid duplicate notification
    if session.status == TransferState.TRANSFERRING:
        return session.to_dict()

    success = transfer_manager.accept_transfer(transfer_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot accept transfer in current state")

    # Notify sender that transfer was accepted and it can start sending chunks
    accept_event = {
        "type": "transfer_accepted",
        "transfer_id": transfer_id,
        "sender_device_id": session.sender_device_id,
        "receiver_device_id": session.receiver_device_id,
        "transfer": session.to_dict()
    }
    await ws_manager.send_to_device(session.sender_device_id, accept_event)
    await ws_manager.broadcast(accept_event)
    await ws_manager.broadcast({
        "type": "transfer_updated",
        "transfer": session.to_dict()
    })

    return session.to_dict()

@router.post("/{transfer_id}/reject")
async def reject_transfer(transfer_id: str) -> Dict[str, Any]:
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        return {"status": "ok", "deleted": True, "transfer_id": transfer_id}

    sender_device_id = session.sender_device_id
    transfer_manager.delete_transfer(transfer_id)

    if sender_device_id:
        await ws_manager.send_to_device(sender_device_id, {
            "type": "transfer_rejected",
            "transfer_id": transfer_id
        })

    await ws_manager.broadcast({
        "type": "transfer_deleted",
        "transfer_id": transfer_id
    })

    return {"status": "ok", "deleted": True, "transfer_id": transfer_id}

@router.post("/{transfer_id}/pause")
async def pause_transfer(transfer_id: str) -> Dict[str, Any]:
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")

    if not transfer_manager.pause_transfer(transfer_id):
        raise HTTPException(status_code=400, detail="Cannot pause transfer")

    await ws_manager.broadcast({
        "type": "transfer_paused",
        "transfer": session.to_dict()
    })
    return session.to_dict()

@router.post("/{transfer_id}/resume")
async def resume_transfer(transfer_id: str) -> Dict[str, Any]:
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")

    if not transfer_manager.resume_transfer(transfer_id):
        raise HTTPException(status_code=400, detail="Cannot resume transfer")

    await ws_manager.broadcast({
        "type": "transfer_resumed",
        "transfer": session.to_dict()
    })
    # Return status with missing chunks so client can resume
    return session.to_dict()

@router.post("/{transfer_id}/cancel")
async def cancel_transfer(transfer_id: str) -> Dict[str, Any]:
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")

    transfer_manager.cancel_transfer(transfer_id)
    await ws_manager.broadcast({
        "type": "transfer_cancelled",
        "transfer": session.to_dict()
    })
    return session.to_dict()

@router.post("/{transfer_id}/complete")
async def complete_transfer(transfer_id: str, transport: str = Query("webrtc")) -> Dict[str, Any]:
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")

    success = await transfer_manager.complete_transfer(transfer_id, transport=transport)
    if not success:
        await ws_manager.broadcast({
            "type": "transfer_updated",
            "transfer": session.to_dict()
        })
        raise HTTPException(status_code=400, detail=session.error_message or "Could not complete transfer")

    await ws_manager.broadcast({
        "type": "transfer_completed",
        "transfer_id": transfer_id,
        "transfer": session.to_dict()
    })
    return session.to_dict()

@router.delete("/{transfer_id}")
async def delete_transfer(transfer_id: str) -> Dict[str, Any]:
    deleted = transfer_manager.delete_transfer(transfer_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Transfer not found")

    await ws_manager.broadcast({
        "type": "transfer_deleted",
        "transfer_id": transfer_id
    })
    return {"status": "ok", "deleted": True, "transfer_id": transfer_id}

@router.put("/{transfer_id}/files/{file_id}/chunks")
async def upload_chunk(
    transfer_id: str,
    file_id: str,
    request: Request,
    chunk_index: int = Query(...),
    offset: int = Query(...)
) -> Dict[str, Any]:
    if chunk_index < 0 or offset < 0:
        raise HTTPException(status_code=400, detail="Invalid chunk parameters: chunk_index and offset must be non-negative")

    # Limit chunk payload size to prevent memory exhaustion (max 32MB)
    content_len = request.headers.get("content-length")
    if content_len and int(content_len) > 33554432:
        raise HTTPException(status_code=413, detail="Chunk payload exceeds maximum allowed size (32MB)")

    body = await request.body()
    if len(body) > 33554432:
        raise HTTPException(status_code=413, detail="Chunk payload exceeds maximum allowed size (32MB)")

    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")

    file_obj = session.files.get(file_id)
    if not file_obj:
        raise HTTPException(status_code=404, detail="File not found in transfer")

    if not body and not (file_obj and file_obj.size == 0):
        raise HTTPException(status_code=400, detail="Empty chunk payload")

    if file_obj and offset > file_obj.size + 16777216:
        raise HTTPException(status_code=400, detail="Chunk offset exceeds declared file boundary")

    # If empty file and not yet materialized, finalize it
    if session and file_obj and file_obj.size == 0 and not file_obj.final_filepath:
        transfer_manager._finalize_empty_file(session, file_obj)

    try:
        success, error = await transfer_manager.write_chunk(
            transfer_id=transfer_id,
            file_id=file_id,
            chunk_index=chunk_index,
            offset=offset,
            data=body
        )
    except OSError as e:
        if getattr(e, "errno", None) == 28:  # ENOSPC
            logger.error(f"Render disk full during chunk upload for transfer {transfer_id}: {e}")
            if session:
                session.status = TransferState.FAILED
                session.error_message = "Server disk full. For large files, use direct WebRTC P2P or local Wi-Fi."
                await ws_manager.broadcast({
                    "type": "transfer_updated",
                    "transfer": session.to_dict()
                })
            raise HTTPException(
                status_code=507,
                detail="Server storage full. Use WebRTC P2P or local Wi-Fi for files larger than cloud capacity."
            )
        raise HTTPException(status_code=500, detail=str(e))

    if not success:
        raise HTTPException(status_code=400, detail=error or "Chunk write failed")

    session = transfer_manager.get_transfer(transfer_id)
    file_obj = session.files.get(file_id) if session else None

    if session:
        session.transport = "http"

    speed = session.speed_calc.get_speed() if session else 0.0
    remaining_bytes = max(0, session.total_size - session.bytes_transferred) if session else 0
    eta = max(1, int(remaining_bytes / speed)) if (speed > 1024 and remaining_bytes > 0) else (0 if remaining_bytes == 0 else None)

    # Throttled progress broadcast (at most once every 200ms or on completion) to eliminate event-loop congestion
    now = time.time()
    is_finished = (session and session.status == TransferState.COMPLETED) or (file_obj and file_obj.status == FileTransferState.COMPLETED)
    if is_finished or (now - getattr(session, "last_progress_broadcast", 0.0) >= 0.20):
        if session:
            session.last_progress_broadcast = now
        await ws_manager.broadcast({
            "type": "transfer_progress",
            "transfer_id": transfer_id,
            "file_id": file_id,
            "bytes_transferred": session.bytes_transferred if session else 0,
            "progress_percentage": round(session.progress_percentage, 1) if session else 0,
            "speed_bps": round(speed, 1),
            "eta_seconds": eta,
            "status": session.status.value if session else "transferring",
            "transport": "http"
        })

    if session and session.status == TransferState.COMPLETED:
        session.transport = "http"
        await ws_manager.broadcast({
            "type": "transfer_completed",
            "transfer_id": transfer_id,
            "transfer": session.to_dict()
        })

    return {
        "status": "ok",
        "chunk_index": chunk_index,
        "bytes_received": file_obj.bytes_received if file_obj else 0,
        "file_completed": file_obj.status == FileTransferState.COMPLETED if file_obj else False,
        "transfer_completed": session.status == TransferState.COMPLETED if session else False
    }

async def delete_file_safely(file_path: str, delay_seconds: int = 1800):
    """
    Safely unlinks/destroys ephemeral files from disk after transfer stream finishes
    and a grace period has passed (settings.AUTO_DELETE_DELAY_SECONDS) to prevent
    race conditions with browser HEAD requests, range inspection, or chunk retries.
    Strictly verifies that file_path resolves within RECEIVED_DIR.
    """
    try:
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)
        if not file_path:
            return
        resolved = Path(file_path).resolve()
        received_p = Path(settings.RECEIVED_DIR).resolve()
        if not resolved.is_relative_to(received_p) or resolved == received_p:
            logger.warning(f"Refusing to delete path outside RECEIVED_DIR: {file_path}")
            return
        if resolved.exists():
            resolved.unlink(missing_ok=True)
            logger.info(f"Ephemeral privacy: safely deleted {file_path} after {delay_seconds}s grace period.")
            p = resolved.parent
            while p != received_p and p.exists():
                try:
                    if not any(p.iterdir()):
                        p.rmdir()
                        p = p.parent
                    else:
                        break
                except Exception:
                    break
    except Exception as e:
        logger.warning(f"Could not auto-delete ephemeral file {file_path}: {e}")

class LargeFileResponse(FileResponse):
    """
    Optimized FileResponse with 1MB chunk size to dramatically improve streaming
    throughput and prevent reverse-proxy timeouts on large multi-gigabyte transfers.
    """
    chunk_size = 1024 * 1024

async def should_auto_delete() -> bool:
    if settings.AUTO_DELETE_ON_DOWNLOAD:
        return True
    return bool(await db.get_setting("auto_delete_on_download", False))

@router.get("/{transfer_id}/files/{file_id}/download")
@router.get("/{transfer_id}/download")
async def download_file(
    transfer_id: str,
    background_tasks: BackgroundTasks,
    file_id: Optional[str] = None
):
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        # Check DB history fallback if container restarted
        history = await db.get_history(limit=50)
        matched = next((h for h in history if h.get("transfer_id") == transfer_id), None)
        if matched:
            safe_fname = sanitize_filename(matched["filename"])
            cand = (settings.RECEIVED_DIR / safe_fname).resolve()
            if cand.exists() and is_safe_subpath(cand, settings.RECEIVED_DIR):
                if matched.get("size") and cand.stat().st_size < matched["size"]:
                    raise HTTPException(status_code=409, detail="File on server is incomplete or truncated")
                if await should_auto_delete():
                    background_tasks.add_task(delete_file_safely, str(cand), settings.AUTO_DELETE_DELAY_SECONDS)
                return LargeFileResponse(
                    path=str(cand),
                    filename=safe_fname,
                    media_type="application/octet-stream"
                )
        raise HTTPException(status_code=404, detail="Transfer not found or expired")

    file_obj = None
    if file_id:
        file_obj = session.files.get(file_id)
    if not file_obj and len(session.files) == 1:
        file_obj = list(session.files.values())[0]

    # If it's a folder or multi-file transfer and no single file requested, redirect to zip download
    if not file_obj and (session.is_folder or len(session.files) > 1):
        return await download_transfer_zip(transfer_id, background_tasks)

    if not file_obj:
        raise HTTPException(status_code=404, detail="File not found in transfer")

    # If empty file and final_filepath not set yet, finalize it now
    if file_obj.size == 0 and not file_obj.final_filepath:
        transfer_manager._finalize_empty_file(session, file_obj)

    if not file_obj.final_filepath or not os.path.exists(file_obj.final_filepath):
        cand = (settings.RECEIVED_DIR / sanitize_filename(file_obj.filename)).resolve()
        if cand.exists() and is_safe_subpath(cand, settings.RECEIVED_DIR) and cand.stat().st_size >= file_obj.size:
            file_obj.final_filepath = str(cand)
        elif file_obj.temp_filepath and os.path.exists(file_obj.temp_filepath):
            temp_sz = os.path.getsize(file_obj.temp_filepath)
            if temp_sz >= file_obj.size:
                verified, _ = await transfer_manager._verify_and_finalize_file(session, file_obj)
                if not verified:
                    raise HTTPException(status_code=409, detail="File failed verification on server")
            else:
                raise HTTPException(
                    status_code=409,
                    detail=f"File transfer incomplete on server ({temp_sz}/{file_obj.size} bytes received)"
                )
        else:
            raise HTTPException(status_code=404, detail="File not ready or does not exist")

    filepath = file_obj.final_filepath
    if not is_safe_subpath(filepath, settings.RECEIVED_DIR):
        raise HTTPException(status_code=403, detail="Access denied: invalid file path")

    actual_size = os.path.getsize(filepath)
    if file_obj.size > 0 and actual_size < file_obj.size:
        raise HTTPException(
            status_code=409,
            detail=f"File transfer incomplete on server ({actual_size}/{file_obj.size} bytes received)"
        )

    if await should_auto_delete():
        background_tasks.add_task(delete_file_safely, filepath, settings.AUTO_DELETE_DELAY_SECONDS)

    return LargeFileResponse(
        path=filepath,
        filename=sanitize_filename(file_obj.filename),
        media_type="application/octet-stream"
    )

@router.get("/{transfer_id}/download-zip")
async def download_transfer_zip(transfer_id: str, background_tasks: BackgroundTasks):
    """
    Provides graceful fallback for folder and multi-file downloads on browsers
    that do not support native directory writing.
    Streams to temporary disk file to avoid Out-Of-Memory (OOM) crashes
    and strictly sanitizes archive paths to prevent Zip Slip vulnerability.
    """
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")

    safe_root = sanitize_filename(session.root_name) if session.root_name else "Transfer"
    zip_filename = f"{safe_root}.zip" if session.is_folder else f"{session.transfer_id[:8]}_files.zip"

    # Write to a temporary file on disk instead of memory BytesIO to avoid OOM crashes
    temp_zip_file = settings.TEMP_DIR / f"zip_{session.transfer_id}_{uuid.uuid4().hex[:8]}.tmp"
    files_to_delete = []

    try:
        with zipfile.ZipFile(temp_zip_file, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for f in session.files.values():
                if f.final_filepath and os.path.exists(f.final_filepath) and is_safe_subpath(f.final_filepath, settings.RECEIVED_DIR):
                    # Prevent Zip Slip: sanitize archive relative path
                    clean_arc = f.relative_path.replace("\\", "/").lstrip("/")
                    arc_parts = [sanitize_filename(p) for p in clean_arc.split("/") if p and p not in (".", "..")]
                    safe_arcname = "/".join(arc_parts) if arc_parts else sanitize_filename(f.filename)
                    zip_file.write(f.final_filepath, arcname=safe_arcname)
                    files_to_delete.append(f.final_filepath)
    except Exception as e:
        if temp_zip_file.exists():
            temp_zip_file.unlink(missing_ok=True)
        logger.error(f"Error creating zip archive: {e}")
        raise HTTPException(status_code=500, detail="Failed to create zip archive")

    # Clean up temporary zip and ephemeral files after download
    async def cleanup_zip_response(zip_path: Path, src_files: List[str]):
        try:
            if zip_path.exists():
                zip_path.unlink(missing_ok=True)
        except Exception:
            pass
        if await should_auto_delete():
            for fp in src_files:
                await delete_file_safely(fp, settings.AUTO_DELETE_DELAY_SECONDS)

    background_tasks.add_task(cleanup_zip_response, temp_zip_file, files_to_delete)

    return LargeFileResponse(
        path=str(temp_zip_file),
        filename=zip_filename,
        media_type="application/zip"
    )
