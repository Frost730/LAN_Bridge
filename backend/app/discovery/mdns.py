import socket
import logging
from typing import Dict, List, Optional
from zeroconf import Zeroconf, ServiceInfo, ServiceBrowser, ServiceListener
from .interfaces import get_primary_lan_ip

logger = logging.getLogger(__name__)

SERVICE_TYPE = "_lanbridge._tcp.local."

class DiscoveredPeer:
    def __init__(self, name: str, ip: str, port: int, properties: Dict[str, str]):
        self.name = name
        self.ip = ip
        self.port = port
        self.properties = properties

class LANBridgeListener(ServiceListener):
    def __init__(self, own_ip: str, own_port: int, on_peer_change=None):
        self.own_ip = own_ip
        self.own_port = own_port
        self.discovered_peers: Dict[str, DiscoveredPeer] = {}
        self.on_peer_change = on_peer_change

    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        info = zc.get_service_info(type_, name)
        if not info:
            return

        addresses = [socket.inet_ntoa(addr) for addr in info.addresses if len(addr) == 4]
        if not addresses:
            return

        ip = addresses[0]
        port = info.port
        # Don't list ourselves
        if ip == self.own_ip and port == self.own_port:
            return

        props = {}
        if info.properties:
            for k, v in info.properties.items():
                try:
                    k_str = k.decode("utf-8") if isinstance(k, bytes) else str(k)
                    v_str = v.decode("utf-8") if isinstance(v, bytes) else str(v)
                    props[k_str] = v_str
                except Exception:
                    pass

        peer_name = props.get("device_name", name.replace(f".{SERVICE_TYPE}", ""))
        self.discovered_peers[name] = DiscoveredPeer(peer_name, ip, port, props)
        logger.info(f"Discovered peer via mDNS: {peer_name} at {ip}:{port}")
        if self.on_peer_change:
            self.on_peer_change()

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        if name in self.discovered_peers:
            removed = self.discovered_peers.pop(name)
            logger.info(f"Lost peer via mDNS: {removed.name}")
            if self.on_peer_change:
                self.on_peer_change()

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        self.add_service(zc, type_, name)

class MDNSManager:
    def __init__(self):
        self._zeroconf: Optional[Zeroconf] = None
        self._service_info: Optional[ServiceInfo] = None
        self._listener: Optional[LANBridgeListener] = None
        self._browser: Optional[ServiceBrowser] = None
        self.is_running: bool = False

    def start(self, device_name: str, port: int, device_id: str) -> None:
        if self.is_running:
            return
        try:
            primary_ip = get_primary_lan_ip()
            ip_bytes = socket.inet_aton(primary_ip)
            service_name = f"{device_name.replace(' ', '-')}-{device_id[:6]}.{SERVICE_TYPE}"

            properties = {
                "device_id": device_id,
                "device_name": device_name,
                "version": "1.0.0",
                "app": "LANBridge"
            }

            self._zeroconf = Zeroconf()
            self._service_info = ServiceInfo(
                SERVICE_TYPE,
                service_name,
                addresses=[ip_bytes],
                port=port,
                properties=properties,
                server=f"{socket.gethostname()}.local."
            )
            self._zeroconf.register_service(self._service_info)

            # Start browser for other LANBridge instances
            self._listener = LANBridgeListener(primary_ip, port)
            self._browser = ServiceBrowser(self._zeroconf, SERVICE_TYPE, self._listener)

            self.is_running = True
            logger.info(f"mDNS registered: {service_name} on {primary_ip}:{port}")
        except Exception as e:
            logger.warning(f"mDNS service registration failed (LANBridge will continue using fallback methods): {e}")

    def get_discovered_hosts(self) -> List[Dict]:
        if not self._listener:
            return []
        return [
            {
                "name": p.name,
                "ip": p.ip,
                "port": p.port,
                "device_id": p.properties.get("device_id", ""),
                "properties": p.properties
            }
            for p in self._listener.discovered_peers.values()
        ]

    def stop(self) -> None:
        if not self.is_running:
            return
        try:
            if self._zeroconf and self._service_info:
                self._zeroconf.unregister_service(self._service_info)
            if self._zeroconf:
                self._zeroconf.close()
        except Exception as e:
            logger.debug(f"Error stopping mDNS: {e}")
        finally:
            self._zeroconf = None
            self._service_info = None
            self._listener = None
            self._browser = None
            self.is_running = False

mdns_manager = MDNSManager()
