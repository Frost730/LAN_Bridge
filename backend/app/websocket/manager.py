import asyncio
import json
import logging
from typing import Dict, List, Optional, Set
from fastapi import WebSocket

logger = logging.getLogger(__name__)

class ConnectedPeer:
    def __init__(self, device_id: str, device_name: str, device_type: str, os_name: str, browser: str, ip: str, websocket: WebSocket):
        self.device_id = device_id
        self.device_name = device_name
        self.device_type = device_type
        self.os = os_name
        self.browser = browser
        self.ip = ip
        self.websocket = websocket

    def to_dict(self) -> dict:
        return {
            "device_id": self.device_id,
            "device_name": self.device_name,
            "device_type": self.device_type,
            "os": self.os,
            "browser": self.browser,
            "ip_address": self.ip,
            "online": True
        }

class ConnectionManager:
    def __init__(self):
        # Maps websocket to peer info
        self._connections: Dict[WebSocket, ConnectedPeer] = {}
        # Maps device_id to set of active WebSockets (allows multiple tabs from same device)
        self._device_websockets: Dict[str, Set[WebSocket]] = {}
        self._host_device_id: Optional[str] = None

    def set_host_device_id(self, host_id: str) -> None:
        self._host_device_id = host_id

    async def connect(self, websocket: WebSocket, device_id: str, device_name: str, device_type: str, os_name: str, browser: str, ip: str) -> ConnectedPeer:
        await websocket.accept()
        peer = ConnectedPeer(device_id, device_name, device_type, os_name, browser, ip, websocket)
        self._connections[websocket] = peer

        if device_id not in self._device_websockets:
            self._device_websockets[device_id] = set()
        self._device_websockets[device_id].add(websocket)

        logger.info(f"Peer connected: {device_name} ({device_id}) from {ip}")
        # Broadcast presence
        await self.broadcast_peer_list()
        return peer

    async def disconnect(self, websocket: WebSocket) -> None:
        peer = self._connections.pop(websocket, None)
        if peer:
            device_sockets = self._device_websockets.get(peer.device_id)
            if device_sockets:
                device_sockets.discard(websocket)
                if not device_sockets:
                    self._device_websockets.pop(peer.device_id, None)
            logger.info(f"Peer disconnected: {peer.device_name} ({peer.device_id})")
            await self.broadcast_peer_list()

    def get_online_devices(self) -> List[dict]:
        unique: Dict[str, dict] = {}
        for peer in self._connections.values():
            if peer.device_id not in unique:
                unique[peer.device_id] = peer.to_dict()
        return list(unique.values())

    async def broadcast(self, message: dict) -> None:
        data = json.dumps(message)
        dead_sockets = []
        for ws in list(self._connections.keys()):
            try:
                await ws.send_text(data)
            except Exception:
                dead_sockets.append(ws)
        for ws in dead_sockets:
            await self.disconnect(ws)

    async def broadcast_peer_list(self) -> None:
        devices = self.get_online_devices()
        await self.broadcast({
            "type": "devices_updated",
            "devices": devices
        })

    async def send_to_device(self, target_device_id: str, message: dict) -> bool:
        """Sends message to all active sockets of a target device"""
        sockets = self._device_websockets.get(target_device_id, set())
        if not sockets:
            return False
        data = json.dumps(message)
        dead = []
        sent_any = False
        for ws in list(sockets):
            try:
                await ws.send_text(data)
                sent_any = True
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)
        return sent_any

    async def send_to_host(self, message: dict) -> bool:
        if self._host_device_id:
            return await self.send_to_device(self._host_device_id, message)
        return False

ws_manager = ConnectionManager()
