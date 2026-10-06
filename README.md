---
title: LANBridge
emoji: ⚡
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 8000
pinned: false
license: mit
---

# LANBridge ⚡

> **High-speed, private, local network file and folder transfer application.**  
> Transfer files and folders directly between Windows, Android, macOS, Linux, and iOS devices over Wi-Fi/Ethernet — **100% offline, zero cloud relay, no user accounts required.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.9+](https://img.shields.io/badge/Python-3.9+-brightgreen.svg)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![WebRTC](https://img.shields.io/badge/Transport-WebRTC%20P2P%20%2B%20HTTP-orange.svg)](https://webrtc.org/)

---

## 📖 Overview

**LANBridge** is an open-source, web-based local file transfer application engineered for maximum speed, security, and simplicity. It allows any device on your local area network (LAN) to exchange files and entire directories directly without routing data through third-party servers or the Internet.

The host computer runs a lightweight service that binds to your local network interface (`0.0.0.0:8000`). Any other device (phones, tablets, laptops) simply opens the host's IP address or scans a generated QR code in their browser to begin transferring at wire speed.

---

## ✨ Key Features

- ⚡ **WebRTC P2P + HTTP Streaming**: Direct peer-to-peer browser-to-browser transfers via RTCDataChannel, with automatic fallback to high-speed chunked HTTP streaming.
- 📁 **Full Folder Transfers**: Preserves directory trees, nested subfolders, and relative paths (`Project/src/App.tsx`). Graceful ZIP download fallback for browsers without native folder writing.
- 🔄 **Resumable Transfers**: Automatic recovery if a Wi-Fi drop occurs. Preserves verified chunks on disk and resumes from the exact missing chunk offset without restarting from 0.
- ⏸️ **Pause / Resume / Cancel**: Real-time transfer controls with immediate temporary file cleanup on cancellation.
- 🔒 **Cryptographic Integrity**: Streaming SHA-256 verification detects corrupted or tampered files before finalizing.
- 📱 **All-Device Friendly UI**: Custom-tailored layouts for smartphones (mobile bottom navigation, bottom-sheet dialogs, 48px touch targets, notch/safe-area support) and desktops.
- 🔌 **Disconnect & Unpair Controls**: Easily disconnect or unpair any connected device at any time from the dashboard, device list, or header.
- 📱 **QR Code & 6-Digit Pairing**: Instant device pairing via camera scan or temporary rate-limited 6-digit code.
- 🛡️ **Host Access Control**: Approval prompts for new devices with optional "Trust this device" persistent whitelist.
- 🛡️ **Strict Security & Path Traversal Protection**: Complete sanitization of filenames and relative paths, preventing directory escapes (`../../`, Windows drive letters, null bytes, DOS reserved names).
- 🔍 **mDNS / Zeroconf Discovery**: Automatic discovery of other LANBridge host instances across the local subnet.
- 📊 **Network Diagnostics & LAN Speed Test**: Built-in LAN throughput benchmark measuring true local network bandwidth (latency, upload, download).
- 🌓 **Dark Mode**: System, Light, and Dark mode preferences with persistent storage.
- 📴 **100% Local & Offline**: Self-contained runtime with zero external CDNs, fonts, or tracking scripts.

---

## 📱 Device Compatibility

LANBridge works seamlessly across all platforms:

| Device / OS | Role | Method |
| :--- | :--- | :--- |
| **Windows** | Host or Client | Double-click `start-windows.bat` or open in Chrome / Edge / Firefox |
| **macOS** | Host or Client | Run `./start-linux-mac.sh` or open in Safari / Chrome |
| **Linux** | Host or Client | Run `./start-linux-mac.sh` or Docker |
| **Android** | Client | Open browser (Chrome, Samsung Internet, Firefox) or scan QR code |
| **iOS / iPadOS** | Client | Open Safari or scan QR code with Camera |
| **Docker / NAS** | Host | `docker-compose up` on Unraid, Synology, TrueNAS, Raspberry Pi |

> 💡 **Notice**: Client devices (phones, tablets, other laptops) **do NOT need to install anything**! They simply open the host's network URL in their web browser.

---

## 🚀 How to Run LANBridge

### Option 1: Standalone Executable (Windows — No Python Required)

1. Download **`LANBridge-windows-x64.zip`** (or `LANBridge.exe`) from [GitHub Releases](https://github.com/Frost730/LAN_Bridge/releases).
2. Extract and double-click **`LANBridge.exe`**.
3. It silently starts in the background and automatically opens your default browser at `http://localhost:8000`.
4. You can **Restart** or **Shutdown** the server anytime directly from the **Settings** page in the web app!

---

### Option 2: Portable Script / Multi-Platform Release

1. Download **`lanbridge-v1.0.0-portable.zip`** from [GitHub Releases](https://github.com/Frost730/LAN_Bridge/releases).
2. Extract the ZIP file.
3. Start the server:
   - **Windows**: Double-click **`start-windows.bat`**
   - **Linux / macOS**: Open terminal and run **`./start-linux-mac.sh`**
4. Open the displayed URL in your browser (e.g. `http://localhost:8000`), or scan the QR code from your phone!

---

### Option 3: Docker / Docker Compose

If you have Docker installed, you can launch LANBridge with a single command:

```bash
docker compose up -d
```

Or run with plain Docker:
```bash
docker run -d --name lanbridge --network host -v $(pwd)/received:/app/received -v $(pwd)/data:/app/data lanbridge
```

---

### Option 4: Run from Source

#### 1. Clone Repository
```bash
git clone https://github.com/Frost730/LAN_Bridge.git
cd LAN_Bridge
```

#### 2. Start Host Server
```bash
# Windows
start-windows.bat

# Linux / macOS
chmod +x start-linux-mac.sh
./start-linux-mac.sh
```

*(Optional manual start)*:
```bash
# Setup virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install requirements
pip install -r backend/requirements.txt

# Run server
python run.py
```

The terminal will print:
```text
=======================================================
  >> LANBridge -- Local Network File Transfer
=======================================================
  This device:
    http://localhost:8000

  Other devices on your LAN:
    http://192.168.1.37:8000
=======================================================
```

---

## 📲 How to Connect Other Devices

1. Ensure both devices are connected to the **same Wi-Fi or Ethernet network**.
2. On your host screen, click **Pair New Device** to reveal the **QR Code** and **6-Digit Pairing Code**.
3. On your phone, tablet, or another computer:
   - **Scan QR Code**: Open the camera app and tap the link, **OR**
   - **Type URL**: Open your mobile browser and go to `http://<HOST-IP>:8000` (e.g. `http://192.168.1.37:8000`).
4. Enter the 6-digit code or tap "Request Access".
5. On the host screen, click **Allow** (optionally check *"Trust this device"* to remember it).
6. Start sending files and folders at wire speed!

---

## 🔒 Security Architecture

Because LANBridge is accessible to other devices on your local network, strict security controls are built into every layer:

- **Zero Outside Access**: Does not require or open WAN/Internet ports (UPnP is never used).
- **Strict Path Traversal Defenses**: Strips absolute path roots, drive specifiers (`C:\`), directory traversal sequences (`../`), null bytes, and Windows reserved DOS device names (`CON`, `PRN`, `AUX`, `NUL`).
- **Device Pairing Approval**: Untrusted devices cannot initiate or receive file transfers without explicit host approval.
- **Ephemeral Pairing Credentials**: QR tokens and 6-digit codes automatically expire after 5 minutes and are strictly rate-limited against brute-force attempts.
- **Single-Click Disconnect**: Instantly terminate connections and unpair devices at any time.

---

## 🧪 Automated Testing

LANBridge includes a comprehensive pytest test suite covering security, chunked uploads, resume mechanics, cancellation cleanup, and streaming integrity:

```bash
pytest backend/tests
```

All 16 unit tests verify:
- Path traversal rejection (`../../etc/passwd`, Windows drive escapes)
- Ephemeral pairing token validity & rate-limiting
- Binary chunk validation and streaming memory bounds (<10MB RAM usage)
- Resumption from specific chunk offsets
- Incomplete temporary file cleanup upon cancellation

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.
