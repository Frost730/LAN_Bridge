import os
import io
import uuid
import zipfile
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Request, HTTPException, Query, Header
from fastapi.responses import FileResponse, StreamingResponse

from ..config import settings
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

    # Notify receiver via WebSocket
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

@router.get("")
async def list_transfers() -> List[Dict[str, Any]]:
    return transfer_manager.get_all_transfers()

@router.get("/{transfer_id}")
async def get_transfer(transfer_id: str) -> Dict[str, Any]:
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return session.to_dict()

@router.post("/{transfer_id}/accept")
async def accept_transfer(transfer_id: str) -> Dict[str, Any]:
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")

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

@router.put("/{transfer_id}/files/{file_id}/chunks")
async def upload_chunk(
    transfer_id: str,
    file_id: str,
    request: Request,
    chunk_index: int = Query(...),
    offset: int = Query(...)
) -> Dict[str, Any]:
    # Stream raw binary bytes directly without memory duplication
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty chunk payload")

    success, error = await transfer_manager.write_chunk(
        transfer_id=transfer_id,
        file_id=file_id,
        chunk_index=chunk_index,
        offset=offset,
        data=body
    )

    if not success:
        raise HTTPException(status_code=400, detail=error or "Chunk write failed")

    session = transfer_manager.get_transfer(transfer_id)
    file_obj = session.files.get(file_id) if session else None

    # Periodic/chunk progress event
    await ws_manager.broadcast({
        "type": "transfer_progress",
        "transfer_id": transfer_id,
        "file_id": file_id,
        "bytes_transferred": session.bytes_transferred if session else 0,
        "progress_percentage": session.progress_percentage if session else 0,
        "speed_bps": session.speed_calc.get_speed() if session else 0,
        "status": session.status.value if session else "transferring"
    })

    return {
        "status": "ok",
        "chunk_index": chunk_index,
        "bytes_received": file_obj.bytes_received if file_obj else 0,
        "file_completed": file_obj.status == FileTransferState.COMPLETED if file_obj else False,
        "transfer_completed": session.status == TransferState.COMPLETED if session else False
    }

@router.get("/{transfer_id}/files/{file_id}/download")
async def download_single_file(transfer_id: str, file_id: str):
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")

    file_obj = session.files.get(file_id)
    if not file_obj or not file_obj.final_filepath or not os.path.exists(file_obj.final_filepath):
        raise HTTPException(status_code=404, detail="File not ready or does not exist")

    return FileResponse(
        path=file_obj.final_filepath,
        filename=file_obj.filename,
        media_type="application/octet-stream"
    )

@router.get("/{transfer_id}/download-zip")
async def download_transfer_zip(transfer_id: str):
    """
    Provides graceful fallback for folder and multi-file downloads on browsers
    that do not support native directory writing (Requirement 10 & 49).
    """
    session = transfer_manager.get_transfer(transfer_id)
    if not session:
        raise HTTPException(status_code=404, detail="Transfer not found")

    # Build zip in memory/stream
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for f in session.files.values():
            if f.final_filepath and os.path.exists(f.final_filepath):
                # Archive name preserves relative path
                zip_file.write(f.final_filepath, arcname=f.relative_path)

    zip_buffer.seek(0)
    zip_filename = f"{session.root_name}.zip" if session.is_folder else f"{session.transfer_id[:8]}_files.zip"

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'}
    )
