import asyncio
import json
import logging
import hashlib
from typing import Dict, List, Optional, Set
from fastapi import WebSocket

logger = logging.getLogger(__name__)

def compute_network_room(ip: str, is_cloud: bool) -> str:
    """Groups devices by their public network/router IP. Hashes the IP so raw IPs are never stored."""
    if not is_cloud:
        return "local_lan"
    if not ip or ip in ("unknown", "127.0.0.1", "localhost"):
        return "default_cloud_room"
    return hashlib.sha256(f"lanbridge_net_{ip}".encode()).hexdigest()[:16]

class ConnectedPeer:
    def __init__(self, device_id: str, device_name: str, device_type: str, os_name: str, browser: str, ip: str, websocket: WebSocket, is_cloud: bool = False):
        self.device_id = device_id
        self.device_name = device_name
        self.device_type = device_type
        self.os = os_name
        self.browser = browser
        self.ip = ip
        self.websocket = websocket
        self.network_room = compute_network_room(ip, is_cloud)

    def to_dict(self, is_cloud: bool = False) -> dict:
        return {
            "device_id": self.device_id,
            "device_name": self.device_name,
            "device_type": self.device_type,
            "os": self.os,
            "browser": self.browser,
            "ip_address": "Protected" if is_cloud else self.ip,
            "online": True
        }

class ConnectionManager:
    def __init__(self):
        # Maps websocket to peer info
        self._connections: Dict[WebSocket, ConnectedPeer] = {}
        # Maps device_id to set of active WebSockets (allows multiple tabs from same device)
        self._device_websockets: Dict[str, Set[WebSocket]] = {}
        # Maps device_id to set of explicitly paired remote devices (cross-network pairs)
        self._paired_links: Dict[str, Set[str]] = {}
        self._host_device_id: Optional[str] = None

    def set_host_device_id(self, host_id: str) -> None:
        self._host_device_id = host_id

    def pair_devices(self, id_a: str, id_b: str) -> None:
        """Explicitly links two devices across different networks (e.g. via QR or 6-digit code)."""
        if not id_a or not id_b or id_a == id_b:
            return
        self._paired_links.setdefault(id_a, set()).add(id_b)
        self._paired_links.setdefault(id_b, set()).add(id_a)
        logger.info(f"Devices explicitly linked across networks: {id_a} <-> {id_b}")

    async def connect(self, websocket: WebSocket, device_id: str, device_name: str, device_type: str, os_name: str, browser: str, ip: str) -> ConnectedPeer:
        from ..api.routes_device import is_cloud_env
        cloud_active = is_cloud_env()

        await websocket.accept()
        peer = ConnectedPeer(device_id, device_name, device_type, os_name, browser, ip, websocket, is_cloud=cloud_active)
        self._connections[websocket] = peer

        if device_id not in self._device_websockets:
            self._device_websockets[device_id] = set()
        self._device_websockets[device_id].add(websocket)

        logger.info(f"Peer connected: {device_name} ({device_id}) [network_room: {peer.network_room}]")
        # Broadcast presence only to peers on the same network or paired
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

    def get_online_devices(self, for_device_id: Optional[str] = None, client_ip: Optional[str] = None) -> List[dict]:
        from ..api.routes_device import is_cloud_env
        cloud_active = is_cloud_env()
        if not cloud_active:
            unique: Dict[str, dict] = {}
            for peer in self._connections.values():
                if for_device_id and peer.device_id == for_device_id:
                    continue
                if peer.device_id not in unique:
                    unique[peer.device_id] = peer.to_dict(is_cloud=False)
            return list(unique.values())

        viewer_room = compute_network_room(client_ip or "unknown", is_cloud=True)
        paired_with_viewer = self._paired_links.get(for_device_id, set()) if for_device_id else set()

        unique: Dict[str, dict] = {}
        for peer in self._connections.values():
            if for_device_id and peer.device_id == for_device_id:
                continue
            # Isolated by public Wi-Fi network OR explicitly paired across networks
            if (peer.network_room == viewer_room) or (peer.device_id in paired_with_viewer):
                if peer.device_id not in unique:
                    unique[peer.device_id] = peer.to_dict(is_cloud=True)
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
        from ..api.routes_device import is_cloud_env
        cloud_active = is_cloud_env()

        # Send tailored list of visible peers to each connected websocket
        for ws, viewer in list(self._connections.items()):
            paired_with_viewer = self._paired_links.get(viewer.device_id, set())
            unique_visible: Dict[str, dict] = {}
            for peer in self._connections.values():
                if peer.device_id == viewer.device_id:
                    continue
                # Same Wi-Fi network OR explicitly paired
                if not cloud_active or (viewer.network_room == peer.network_room) or (peer.device_id in paired_with_viewer):
                    if peer.device_id not in unique_visible:
                        unique_visible[peer.device_id] = peer.to_dict(is_cloud=cloud_active)

            try:
                await ws.send_text(json.dumps({
                    "type": "devices_updated",
                    "devices": list(unique_visible.values())
                }))
            except Exception:
                pass

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

    async def disconnect_device(self, device_id: str) -> bool:
        """Forcefully disconnects an active device and notifies it"""
        sockets = list(self._device_websockets.get(device_id, set()))
        if not sockets:
            return False
        for ws in sockets:
            try:
                await ws.send_text(json.dumps({
                    "type": "device_disconnected_by_host",
                    "device_id": device_id,
                    "message": "You have been disconnected / unpaired by the host."
                }))
                await ws.close(code=1000, reason="Disconnected by host")
            except Exception:
                pass
            self._connections.pop(ws, None)
        self._device_websockets.pop(device_id, None)
        await self.broadcast_peer_list()
        return True

ws_manager = ConnectionManager()
