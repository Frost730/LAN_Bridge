from fastapi import APIRouter, Query
from typing import List, Dict, Any, Optional
from ..database.db import db
from .routes_device import is_cloud_env

router = APIRouter(prefix="/api/history", tags=["history"])

@router.get("")
async def get_history(device_id: Optional[str] = Query(None), limit: int = 100) -> List[Dict[str, Any]]:
    # In cloud mode, strictly isolate history per device so visitors cannot inspect each other's transfers
    if is_cloud_env():
        if not device_id:
            return []
        return await db.get_history_for_device(device_id, limit=limit)
    if device_id:
        return await db.get_history_for_device(device_id, limit=limit)
    return await db.get_history(limit=limit)

@router.delete("")
async def clear_history() -> Dict[str, Any]:
    await db.clear_history()
    return {"status": "ok", "message": "History cleared"}
