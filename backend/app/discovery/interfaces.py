import socket
import psutil
from typing import List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)

VIRTUAL_IFACE_KEYWORDS = [
    "virtual", "vmware", "vbox", "docker", "wsl", "loopback", "vethernet", "hyper-v", "teredo"
]

def get_primary_lan_ip() -> str:
    """
    Finds the active LAN IPv4 address reachable by other devices on the local network.
    Uses UDP socket connect trick without sending data.
    """
    try:
        # Connect to a common local/external endpoint to determine outgoing routing interface
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(0.5)
            # Doesn't actually send packets
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
    except Exception:
        pass

    # Fallback to inspecting psutil interfaces
    interfaces = get_all_interfaces()
    for iface in interfaces:
        if iface[1] != "127.0.0.1" and not any(k in iface[0].lower() for k in VIRTUAL_IFACE_KEYWORDS):
            return iface[1]

    # Return localhost if nothing else found
    return "127.0.0.1"

def get_all_interfaces() -> List[Tuple[str, str, Optional[str], bool]]:
    """
    Returns a list of (interface_name, ipv4_address, netmask, is_primary)
    """
    results = []
    primary_ip = None
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(0.2)
            s.connect(("8.8.8.8", 80))
            primary_ip = s.getsockname()[0]
    except Exception:
        pass

    addrs = psutil.net_if_addrs()
    stats = psutil.net_if_stats()

    for iface_name, iface_addrs in addrs.items():
        # Check if interface is up
        stat = stats.get(iface_name)
        is_up = stat.isup if stat else True
        if not is_up:
            continue

        for addr in iface_addrs:
            if addr.family == socket.AF_INET:
                ip = addr.address
                if ip == "127.0.0.1":
                    continue
                is_primary = (ip == primary_ip)
                results.append((iface_name, ip, addr.netmask, is_primary))

    # Sort so primary is first, then non-virtual, then virtual
    def sort_key(item):
        name, ip, _, is_primary = item
        if is_primary:
            return 0
        if any(k in name.lower() for k in VIRTUAL_IFACE_KEYWORDS):
            return 2
        return 1

    results.sort(key=sort_key)
    return results
