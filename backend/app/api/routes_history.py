from fastapi import APIRouter
from typing import List, Dict, Any
from ..database.db import db

router = APIRouter(prefix="/api/history", tags=["history"])

@router.get("")
async def get_history(limit: int = 100) -> List[Dict[str, Any]]:
    return await db.get_history(limit=limit)

@router.delete("")
async def clear_history() -> Dict[str, Any]:
    await db.clear_history()
    return {"status": "ok", "message": "History cleared"}
