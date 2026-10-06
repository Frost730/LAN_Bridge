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
        # Temporary named rooms: room_name -> Set[device_id]
        self._custom_rooms: Dict[str, Set[str]] = {}
        # Device room mapping: device_id -> room_name
        self._device_custom_room: Dict[str, str] = {}
        self._host_device_id: Optional[str] = None

    def set_host_device_id(self, host_id: str) -> None:
        self._host_device_id = host_id

    def join_room(self, device_id: str, room_name: str) -> None:
        clean = room_name.strip().lower()
        if not clean:
            return
        self.leave_room(device_id)
        self._custom_rooms.setdefault(clean, set()).add(device_id)
        self._device_custom_room[device_id] = clean
        logger.info(f"Device {device_id} joined temporary room '{clean}'")

    def leave_room(self, device_id: str) -> Optional[str]:
        room = self._device_custom_room.pop(device_id, None)
        if room and room in self._custom_rooms:
            self._custom_rooms[room].discard(device_id)
            if not self._custom_rooms[room]:
                self._custom_rooms.pop(room, None)
            logger.info(f"Device {device_id} left temporary room '{room}'")
        return room

    def get_device_room(self, device_id: str) -> Optional[str]:
        return self._device_custom_room.get(device_id)

    def pair_devices(self, id_a: str, id_b: str) -> None:
        """Explicitly links two devices across different networks (e.g. via QR or 6-digit code)."""
        if not id_a or not id_b or id_a == id_b:
            return
        self._paired_links.setdefault(id_a, set()).add(id_b)
        self._paired_links.setdefault(id_b, set()).add(id_a)
        logger.info(f"Devices explicitly linked across networks: {id_a} <-> {id_b}")

    async def connect(self, websocket: WebSocket, device_id: str, device_name: str, device_type: str, os_name: str, browser: str, ip: str, initial_room: Optional[str] = None) -> ConnectedPeer:
        from ..api.routes_device import is_cloud_env
        cloud_active = is_cloud_env()

        await websocket.accept()
        peer = ConnectedPeer(device_id, device_name, device_type, os_name, browser, ip, websocket, is_cloud=cloud_active)
        self._connections[websocket] = peer

        if device_id not in self._device_websockets:
            self._device_websockets[device_id] = set()
        self._device_websockets[device_id].add(websocket)

        if initial_room:
            self.join_room(device_id, initial_room)

        logger.info(f"Peer connected: {device_name} ({device_id}) [network_room: {peer.network_room}] [custom_room: {self.get_device_room(device_id)}]")
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
                    self.leave_room(peer.device_id)
            logger.info(f"Peer disconnected: {peer.device_name} ({peer.device_id})")
            await self.broadcast_peer_list()

    def get_online_devices(self, for_device_id: Optional[str] = None, client_ip: Optional[str] = None) -> List[dict]:
        from ..api.routes_device import is_cloud_env
        cloud_active = is_cloud_env()
        viewer_custom_room = self.get_device_room(for_device_id) if for_device_id else None

        viewer_net_room = compute_network_room(client_ip or "unknown", is_cloud=True)
        paired_with_viewer = self._paired_links.get(for_device_id, set()) if for_device_id else set()

        unique: Dict[str, dict] = {}
        for peer in self._connections.values():
            if for_device_id and peer.device_id == for_device_id:
                continue
            peer_custom_room = self.get_device_room(peer.device_id)

            # 1. Custom room check
            if viewer_custom_room:
                if peer_custom_room == viewer_custom_room:
                    if peer.device_id not in unique:
                        unique[peer.device_id] = peer.to_dict(is_cloud=cloud_active)
                continue

            # Target is in a custom room, but viewer is not -> invisible to outsider
            if peer_custom_room:
                continue

            # 2. General network room (same Wi-Fi router) OR explicit pair
            if not cloud_active or (peer.network_room == viewer_net_room) or (peer.device_id in paired_with_viewer):
                if peer.device_id not in unique:
                    unique[peer.device_id] = peer.to_dict(is_cloud=cloud_active)
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
            viewer_custom_room = self.get_device_room(viewer.device_id)
            paired_with_viewer = self._paired_links.get(viewer.device_id, set())
            unique_visible: Dict[str, dict] = {}

            for peer in self._connections.values():
                if peer.device_id == viewer.device_id:
                    continue
                peer_custom_room = self.get_device_room(peer.device_id)

                # 1. Custom room matching
                if viewer_custom_room:
                    if peer_custom_room == viewer_custom_room:
                        if peer.device_id not in unique_visible:
                            unique_visible[peer.device_id] = peer.to_dict(is_cloud=cloud_active)
                    continue

                if peer_custom_room:
                    continue

                # 2. Same Wi-Fi network OR explicitly paired
                if not cloud_active or (viewer.network_room == peer.network_room) or (peer.device_id in paired_with_viewer):
                    if peer.device_id not in unique_visible:
                        unique_visible[peer.device_id] = peer.to_dict(is_cloud=cloud_active)

            try:
                await ws.send_text(json.dumps({
                    "type": "devices_updated",
                    "devices": list(unique_visible.values()),
                    "room": viewer_custom_room
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

    async def send_chat_message(self, from_device_id: str, message: dict) -> None:
        """
        Routes a chat message either to a specific target_device_id, or broadcasts to the
        sender's visible peers (same room or same network).
        """
        target_device_id = message.get("target_device_id")
        if target_device_id and target_device_id not in ("all", "*"):
            await self.send_to_device(target_device_id, message)
            return

        viewer_custom_room = self.get_device_room(from_device_id)
        sender_peer = None
        for p in self._connections.values():
            if p.device_id == from_device_id:
                sender_peer = p
                break

        from ..api.routes_device import is_cloud_env
        cloud_active = is_cloud_env()
        paired = self._paired_links.get(from_device_id, set())

        sent_to = set()
        for peer in self._connections.values():
            if peer.device_id == from_device_id or peer.device_id in sent_to:
                continue
            peer_custom_room = self.get_device_room(peer.device_id)

            # 1. Custom room check
            if viewer_custom_room:
                if peer_custom_room == viewer_custom_room:
                    await self.send_to_device(peer.device_id, message)
                    sent_to.add(peer.device_id)
                continue

            if peer_custom_room:
                continue

            # 2. Network room or paired
            if not cloud_active or (sender_peer and peer.network_room == sender_peer.network_room) or (peer.device_id in paired):
                await self.send_to_device(peer.device_id, message)
                sent_to.add(peer.device_id)

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
        # Clean up any paired links
        self._paired_links.pop(device_id, None)
        for s in self._paired_links.values():
            s.discard(device_id)
        await self.broadcast_peer_list()
        return True

ws_manager = ConnectionManager()
