import os
import io
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

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/transfers", tags=["transfers"])

@router.post("")
async def create_transfer(payload: TransferCreatePayload) -> Dict[str, Any]:
    transfer_id = str(uuid.uuid4())
    session = transfer_manager.create_transfer(
        transfer_id=transfer_id,
        sender_device_id=payload.sender_device_id,
        sender_name=payload.sender_name,
        receiver_device_id=payload.receiver_device_id,
        receiver_name="Target Device",
        is_folder=payload.is_folder,
        root_name=payload.root_name,
        files_data=[f.model_dump() for f in payload.files]
    )

    # Check if sender is a trusted device or auto-approval is enabled
    is_trusted = await db.is_trusted_device(payload.sender_device_id)
    require_approval = await db.get_setting("require_approval", True)

    if is_trusted or not require_approval:
        transfer_manager.accept_transfer(transfer_id)
        # Notify sender to start streaming immediately
        await ws_manager.send_to_device(payload.sender_device_id, {
            "type": "transfer_accepted",
            "transfer_id": transfer_id
        })
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
    await ws_manager.send_to_device(session.sender_device_id, {
        "type": "transfer_accepted",
        "transfer_id": transfer_id
    })
    await ws_manager.broadcast({
        "type": "transfer_updated",
        "transfer": session.to_dict()
    })

    return session.to_dict()

@router.post("/{transfer_id}/reject")
async def reject_transfer(transfer_id: str) -> Dict[str, Any]:
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")

    transfer_manager.reject_transfer(transfer_id)
    await ws_manager.send_to_device(session.sender_device_id, {
        "type": "transfer_rejected",
        "transfer_id": transfer_id
    })
    await ws_manager.broadcast({
        "type": "transfer_updated",
        "transfer": session.to_dict()
    })

    return session.to_dict()

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
    # Stream raw binary bytes directly without memory duplication
    session = transfer_manager.get_transfer(transfer_id)
    file_obj = session.files.get(file_id) if session else None

    body = await request.body()
    if not body and not (file_obj and file_obj.size == 0):
        raise HTTPException(status_code=400, detail="Empty chunk payload")

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

    speed = session.speed_calc.get_speed() if session else 0.0
    remaining_bytes = max(0, session.total_size - session.bytes_transferred) if session else 0
    eta = int(remaining_bytes / speed) if speed > 1024 else None

    # Periodic/chunk progress event
    await ws_manager.broadcast({
        "type": "transfer_progress",
        "transfer_id": transfer_id,
        "file_id": file_id,
        "bytes_transferred": session.bytes_transferred if session else 0,
        "progress_percentage": round(session.progress_percentage, 1) if session else 0,
        "speed_bps": round(speed, 1),
        "eta_seconds": eta,
        "status": session.status.value if session else "transferring"
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

async def delete_file_safely(file_path: str, delay_seconds: int = 180):
    """
    Safely unlinks/destroys ephemeral files from disk after transfer stream finishes
    and a grace period has passed (settings.AUTO_DELETE_DELAY_SECONDS) to prevent
    race conditions with browser HEAD requests, range inspection, or chunk retries.
    """
    try:
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
            logger.info(f"Ephemeral privacy: safely deleted {file_path} after {delay_seconds}s grace period.")
            p = Path(file_path).parent
            received_p = Path(settings.RECEIVED_DIR).resolve()
            while p.resolve() != received_p and p.exists():
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
            cand = settings.RECEIVED_DIR / matched["filename"]
            if cand.exists():
                if await should_auto_delete():
                    background_tasks.add_task(delete_file_safely, str(cand), settings.AUTO_DELETE_DELAY_SECONDS)
                return FileResponse(
                    path=str(cand),
                    filename=matched["filename"],
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
        # As last check, verify if filename exists in settings.RECEIVED_DIR
        cand = settings.RECEIVED_DIR / file_obj.filename
        if cand.exists():
            file_obj.final_filepath = str(cand)
        else:
            raise HTTPException(status_code=404, detail="File not ready or does not exist")

    filepath = file_obj.final_filepath
    if await should_auto_delete():
        background_tasks.add_task(delete_file_safely, filepath, settings.AUTO_DELETE_DELAY_SECONDS)

    return FileResponse(
        path=filepath,
        filename=file_obj.filename,
        media_type="application/octet-stream"
    )

@router.get("/{transfer_id}/download-zip")
async def download_transfer_zip(transfer_id: str, background_tasks: BackgroundTasks):
    """
    Provides graceful fallback for folder and multi-file downloads on browsers
    that do not support native directory writing (Requirement 10 & 49).
    """
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")

    # Build zip in memory/stream
    zip_buffer = io.BytesIO()
    files_to_delete = []
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for f in session.files.values():
            if f.final_filepath and os.path.exists(f.final_filepath):
                # Archive name preserves relative path
                zip_file.write(f.final_filepath, arcname=f.relative_path)
                files_to_delete.append(f.final_filepath)

    zip_buffer.seek(0)
    zip_filename = f"{session.root_name}.zip" if session.is_folder else f"{session.transfer_id[:8]}_files.zip"

    if await should_auto_delete():
        for fp in files_to_delete:
            background_tasks.add_task(delete_file_safely, fp, settings.AUTO_DELETE_DELAY_SECONDS)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'}
    )
