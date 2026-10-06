import aiosqlite
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
from ..config import settings

logger = logging.getLogger(__name__)

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL DEFAULT 'unknown',
    os TEXT NOT NULL DEFAULT 'unknown',
    browser TEXT NOT NULL DEFAULT 'unknown',
    ip_address TEXT,
    is_trusted INTEGER NOT NULL DEFAULT 0,
    first_seen REAL NOT NULL,
    last_seen REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS trusted_devices (
    device_id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    trusted_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS transfers (
    id TEXT PRIMARY KEY,
    sender_device_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    receiver_device_id TEXT NOT NULL,
    receiver_name TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'received',
    status TEXT NOT NULL,
    total_size INTEGER NOT NULL,
    bytes_transferred INTEGER NOT NULL DEFAULT 0,
    is_folder INTEGER NOT NULL DEFAULT 0,
    root_name TEXT NOT NULL,
    created_at REAL NOT NULL,
    completed_at REAL
);

CREATE TABLE IF NOT EXISTS transfer_files (
    id TEXT PRIMARY KEY,
    transfer_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    bytes_received INTEGER NOT NULL DEFAULT 0,
    sha256_expected TEXT,
    sha256_actual TEXT,
    status TEXT NOT NULL,
    chunks_total INTEGER NOT NULL,
    chunks_received INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(transfer_id) REFERENCES transfers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id TEXT NOT NULL,
    sender_device_id TEXT,
    receiver_device_id TEXT,
    device_name TEXT NOT NULL,
    direction TEXT NOT NULL, -- 'sent' or 'received'
    filename TEXT NOT NULL,
    size INTEGER NOT NULL,
    timestamp REAL NOT NULL,
    result TEXT NOT NULL -- 'completed', 'failed', 'cancelled'
);

CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_history_sender ON history(sender_device_id);
CREATE INDEX IF NOT EXISTS idx_history_receiver ON history(receiver_device_id);
CREATE INDEX IF NOT EXISTS idx_transfer_files_transfer ON transfer_files(transfer_id);
"""

from contextlib import asynccontextmanager

class Database:
    def __init__(self, db_path: Path = settings.DB_PATH):
        self.db_path = db_path

    @asynccontextmanager
    async def get_connection(self):
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            await db.execute("PRAGMA foreign_keys = ON")
            yield db

    async def init_db(self) -> None:
        """Initializes tables and default settings"""
        settings.ensure_directories()
        async with self.get_connection() as db:
            await db.executescript(CREATE_TABLES_SQL)
            # Automatic schema migration for existing databases
            try:
                await db.execute("ALTER TABLE history ADD COLUMN sender_device_id TEXT")
            except Exception:
                pass
            try:
                await db.execute("ALTER TABLE history ADD COLUMN receiver_device_id TEXT")
            except Exception:
                pass
            await db.commit()

    async def get_setting(self, key: str, default: Any = None) -> Any:
        async with self.get_connection() as db:
            async with db.execute("SELECT value FROM settings WHERE key = ?", (key,)) as cursor:
                row = await cursor.fetchone()
                if row:
                    try:
                        return json.loads(row["value"])
                    except json.JSONDecodeError:
                        return row["value"]
                return default

    async def set_setting(self, key: str, value: Any) -> None:
        json_val = json.dumps(value)
        async with self.get_connection() as db:
            await db.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json_val)
            )
            await db.commit()

    # Device & Trusted Device Operations
    async def upsert_device(self, device_id: str, name: str, device_type: str, os_name: str, browser: str, ip: str) -> None:
        import time
        now = time.time()
        async with self.get_connection() as db:
            await db.execute("""
                INSERT INTO devices (device_id, device_name, device_type, os, browser, ip_address, first_seen, last_seen)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET
                    device_name = excluded.device_name,
                    device_type = excluded.device_type,
                    os = excluded.os,
                    browser = excluded.browser,
                    ip_address = excluded.ip_address,
                    last_seen = excluded.last_seen
            """, (device_id, name, device_type, os_name, browser, ip, now, now))
            await db.commit()

    async def is_trusted_device(self, device_id: str) -> bool:
        async with self.get_connection() as db:
            async with db.execute("SELECT 1 FROM trusted_devices WHERE device_id = ?", (device_id,)) as cursor:
                row = await cursor.fetchone()
                return row is not None

    async def trust_device(self, device_id: str, device_name: str) -> None:
        import time
        async with self.get_connection() as db:
            await db.execute(
                "INSERT INTO trusted_devices (device_id, device_name, trusted_at) VALUES (?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET device_name = excluded.device_name",
                (device_id, device_name, time.time())
            )
            await db.execute("UPDATE devices SET is_trusted = 1 WHERE device_id = ?", (device_id,))
            await db.commit()

    async def remove_trusted_device(self, device_id: str) -> None:
        async with self.get_connection() as db:
            await db.execute("DELETE FROM trusted_devices WHERE device_id = ?", (device_id,))
            await db.execute("UPDATE devices SET is_trusted = 0 WHERE device_id = ?", (device_id,))
            await db.commit()

    async def get_trusted_devices(self) -> List[Dict[str, Any]]:
        async with self.get_connection() as db:
            async with db.execute("SELECT device_id, device_name, trusted_at FROM trusted_devices ORDER BY trusted_at DESC") as cursor:
                rows = await cursor.fetchall()
                return [dict(row) for row in rows]

    # History Operations
    async def add_history(
        self,
        transfer_id: str,
        device_name: str,
        direction: str,
        filename: str,
        size: int,
        result: str,
        sender_device_id: Optional[str] = None,
        receiver_device_id: Optional[str] = None
    ) -> None:
        import time
        async with self.get_connection() as db:
            await db.execute("""
                INSERT INTO history (transfer_id, sender_device_id, receiver_device_id, device_name, direction, filename, size, timestamp, result)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (transfer_id, sender_device_id, receiver_device_id, device_name, direction, filename, size, time.time(), result))
            await db.commit()

    async def get_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        async with self.get_connection() as db:
            async with db.execute("SELECT id, transfer_id, device_name, direction, filename, size, timestamp, result FROM history ORDER BY timestamp DESC LIMIT ?", (limit,)) as cursor:
                rows = await cursor.fetchall()
                return [dict(row) for row in rows]

    async def get_history_for_device(self, device_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        async with self.get_connection() as db:
            async with db.execute("""
                SELECT id, transfer_id, device_name, direction, filename, size, timestamp, result
                FROM history
                WHERE (direction = 'sent' AND sender_device_id = ?)
                   OR (direction = 'received' AND receiver_device_id = ?)
                   OR (sender_device_id IS NULL AND receiver_device_id IS NULL)
                ORDER BY timestamp DESC LIMIT ?
            """, (device_id, device_id, limit)) as cursor:
                rows = await cursor.fetchall()
                return [dict(row) for row in rows]

    async def clear_history(self) -> None:
        async with self.get_connection() as db:
            await db.execute("DELETE FROM history")
            await db.commit()

    async def clear_history_for_device(self, device_id: str) -> None:
        async with self.get_connection() as db:
            await db.execute("""
                DELETE FROM history
                WHERE (direction = 'sent' AND sender_device_id = ?)
                   OR (direction = 'received' AND receiver_device_id = ?)
            """, (device_id, device_id))
            await db.commit()

db = Database()
