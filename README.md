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

> **High-speed, private, local network & cross-network file transfer application.**  
> Transfer files, folders, and text messages directly between Windows, Android, macOS, Linux, and iOS devices over Wi-Fi, Ethernet, or Temporary Rooms — **100% private, direct P2P data flow, zero cloud storage, no accounts required.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.9+](https://img.shields.io/badge/Python-3.9+-brightgreen.svg)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![WebRTC](https://img.shields.io/badge/Transport-WebRTC%20P2P%20%2B%20HTTP-orange.svg)](https://webrtc.org/)

---

## 📖 Overview

**LANBridge** is an open-source, web-based file transfer and device collaboration application engineered for maximum speed, security, and simplicity. It allows any device (phones, tablets, laptops, desktops) to exchange files and entire folder trees directly without routing data through third-party servers or uploading your files to the cloud.

Whether you are on the same local Wi-Fi network or connecting across different networks via temporary rooms, LANBridge provides wire-speed peer-to-peer data channels with instant setup, zero installation for client devices, and end-to-end cryptographic verification.

---

## ✨ Key Features

### 🚀 High-Speed Direct Transfers
- **WebRTC P2P + HTTP Streaming**: Direct peer-to-peer browser-to-browser transfers via RTCDataChannel, with automatic fallback to high-speed chunked HTTP streaming.
- **Concurrent Transfers & Stream Multiplexing**: Send multiple files or start second transfers concurrently without collisions or corrupted packets thanks to 32-bit binary stream multiplexing.
- **Live Speed & Dynamic ETA**: Real-time sliding window throughput calculator displaying exact transfer speed (e.g. `24.5 MB/s`) and dynamic remaining time (e.g. `1m 15s remaining`).
- **Full Folder Transfers**: Preserves directory trees, nested subfolders, and relative paths (`Project/src/App.tsx`). Includes graceful ZIP download fallback for browsers without native folder writing.
- **Resumable Transfers**: Automatic recovery if a network drop occurs. Preserves verified chunks on disk and resumes from the exact missing chunk offset without restarting from 0.
- **Full Transfer Controls**: Pause, resume, cancel, or delete any transfer anytime with immediate cleanup of incomplete temporary files.

### 🌐 Temporary Rooms & Cross-Network Sharing
- **Temporary Named Rooms**: Create or join temporary rooms (e.g., `office-files` or `design-team`) to share files across different Wi-Fi networks, mobile data, or public networks.
- **1-Click Room Links**: Share a direct link (`?room=room-name`) for instant group onboarding.
- **Room-Scoped Privacy**: Only devices that know the room name can discover each other or initiate transfers.

### 💬 Real-Time Device Chat
- **Instant Messaging**: Lightweight, zero-configuration chat system between all connected devices.
- **Broadcast & 1-on-1**: Chat with all connected peers or send direct messages to a specific device.
- **Chimes & Badges**: Audio chime notifications and unread message counter badges with quick-reply shortcuts on device cards.

### 🔒 Security & Access Control
- **Cryptographic Integrity**: Streaming SHA-256 hash calculation verifies every file's integrity before finalizing.
- **Strict Path Traversal Defenses**: Complete sanitization of filenames and relative paths, preventing directory escapes (`../../`, drive specifiers, null bytes, DOS reserved names).
- **Host Pairing Approval**: Untrusted devices must be approved before connecting. Includes 1-click "Trust this device" whitelist and instant unpair/disconnect buttons.
- **Ephemeral QR & 6-Digit Codes**: Expiring, rate-limited credentials protect against unauthorized access.
- **Immediate Ephemeral File Shredder (`AUTO_DELETE_ON_DOWNLOAD`)**: In cloud or relay environments, files flowing through HTTP relay are automatically and immediately wiped from the server container the instant the recipient finishes downloading them.
- **Zero Cloud Storage**: Direct WebRTC P2P transfers stream browser-to-browser with 0 bytes ever touching server disk. In HTTP relay mode, files are ephemeral and never stored in any cloud database.

### 📱 Responsive PWA & Native Notifications
- **Mobile & Desktop First**: Tailored layouts for smartphones (mobile navigation, bottom-sheet dialogs, 48px touch targets, notch support) and desktop monitors.
- **OS Notifications**: Native push notifications with the app logo for incoming transfers, completed downloads, pairing requests, and chat messages. Clicking a notification automatically focuses the active tab.
- **Theme Selection**: Dark, Light, and System themes with instant switching and persistent storage.
- **LAN Speed Benchmark**: Built-in network diagnostics measuring real-time local network latency, upload, and download bandwidth.

---

## 📱 Device Compatibility

LANBridge runs in any modern web browser without requiring client apps:

| Device / OS | Role | Method |
| :--- | :--- | :--- |
| **Windows** | Host or Client | Standalone EXE, `start-windows.bat`, or open in Chrome / Edge / Firefox |
| **macOS** | Host or Client | Run `./start-linux-mac.sh` or open in Safari / Chrome |
| **Linux** | Host or Client | Run `./start-linux-mac.sh` or Docker |
| **Android** | Client | Open browser (Chrome, Samsung Internet, Firefox) or scan QR code |
| **iOS / iPadOS** | Client | Open Safari or scan QR code with Camera |
| **Docker / NAS** | Host | `docker compose up` on Unraid, Synology, TrueNAS, Raspberry Pi |

> 💡 **Tip**: Client devices (smartphones, tablets, other PCs) **do NOT need to install any application**! They simply open the URL or scan the QR code in their browser.

---

## 🚀 How to Run LANBridge

### Option 1: Standalone Windows Executable (No Python Required)

1. Download **`LANBridge-windows-x64.zip`** (or `LANBridge.exe`) from [GitHub Releases](https://github.com/Frost730/LAN_Bridge/releases).
2. Extract and double-click **`LANBridge.exe`**.
3. It starts silently and opens your browser at `http://localhost:8000`.
4. You can restart or shut down the host server anytime from the web app's **Settings** page.

---

### Option 2: Portable Scripts (Cross-Platform)

1. Download **`lanbridge-portable.zip`** from [GitHub Releases](https://github.com/Frost730/LAN_Bridge/releases).
2. Extract the archive.
3. Start the application:
   - **Windows**: Double-click **`start-windows.bat`**
   - **Linux / macOS**: Run **`./start-linux-mac.sh`**
4. Open the displayed URL in your browser.

---

### Option 3: Docker / Docker Compose

Run with Docker Compose:

```bash
docker compose up -d
```

Or run with plain Docker:

```bash
docker run -d --name lanbridge --network host -v $(pwd)/received:/app/received -v $(pwd)/data:/app/data lanbridge
```

---

### Option 4: Run from Source

#### 1. Clone the Repository
```bash
git clone https://github.com/Frost730/LAN_Bridge.git
cd LAN_Bridge
```

#### 2. Start the Server
```bash
# Windows
start-windows.bat

# Linux / macOS
chmod +x start-linux-mac.sh
./start-linux-mac.sh
```

*(Optional Manual Setup)*:
```bash
# Python Virtual Environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install backend dependencies
pip install -r backend/requirements.txt

# Build frontend (optional if dist already present)
cd frontend
npm install
npm run build
cd ..

# Run
python run.py
```

---

## 📲 How to Connect & Transfer

### On Local Wi-Fi
1. Ensure both devices are connected to the **same Wi-Fi or Ethernet network**.
2. On your host screen, click **Pair New Device** to reveal the **QR Code** and **6-Digit Code**.
3. On your phone or secondary computer, scan the QR code or navigate to `http://<HOST-IP>:8000`.
4. Approve the connection on the host screen.
5. Drag and drop files or folders to transfer immediately.

### Over Temporary Rooms (Public / Multi-Network)
1. Go to the **Connect** tab and select **Room**.
2. Enter any room name (e.g. `project-sync`) and click **Join Room**.
3. Copy the invite link or have another device enter the same room name.
4. Both devices will appear in the peer list ready to send files and chat directly.

---

## 🛡️ Privacy & Data Handling

LANBridge is designed with uncompromising privacy principles:

- **Zero Telemetry or Analytics**: There are no tracking scripts, analytics SDKs, third-party cookies, or telemetry beacons anywhere in the application.
- **Direct P2P Data Flow**: When devices connect via WebRTC, data streams directly browser-to-browser via `RTCDataChannel`. Exactly **0 bytes** ever touch the server disk or relay memory.
- **Immediate Ephemeral Shredder (`AUTO_DELETE_ON_DOWNLOAD`)**: When strict firewalls require HTTP relay fallback, files are automatically destroyed from the server disk the instant the recipient finishes downloading them.
- **Automated Stale Relay Cleanup**: A periodic background garbage collector automatically purges any abandoned or incomplete relay files older than 1 hour.
- **Local Client Storage**: Device nicknames, trusted device tokens, room preferences, and themes reside strictly inside your browser's private `localStorage`.
- **Ephemeral Memory**: Temporary room codes, active transfer states, and real-time chat messages are stored only in volatile server RAM and automatically vanish when closed.
- **100% Offline Capable**: All web assets, icons, fonts, and scripts are bundled locally inside the project. On local Wi-Fi or Ethernet networks, LANBridge functions completely air-gapped without an internet connection.

---

## ⚙️ Environment Configuration

| Variable | Default | Description |
| :--- | :--- | :--- |
| `AUTO_DELETE_ON_DOWNLOAD` | `true` (Cloud) / `false` (Local) | Automatically unlinks and wipes relay files from disk the instant download completes. |
| `AUTO_CLEANUP_HOURS` | `1` | Maximum lifetime (in hours) before abandoned or incomplete relay files are garbage-collected. |
| `PORT` / `LANBRIDGE_PORT` | `8000` | Port for the HTTP and WebSocket server. |
| `LANBRIDGE_HOST` | `0.0.0.0` | Host IP binding address. |
| `LANBRIDGE_CLOUD` | `false` | Set to `true` when hosting on a cloud container to enforce cloud security defaults. |

---

## 🧪 Automated Testing

LANBridge includes a test suite covering security, chunking, resume mechanics, cancellation cleanup, streaming integrity, and automatic file shredding:

```bash
pytest backend/tests
```

Unit test coverage verifies:
- Path traversal rejection (`../../etc/passwd`, Windows drive escapes)
- Ephemeral pairing token validity & rate-limiting
- Binary chunk validation and streaming memory bounds (<10MB RAM usage)
- Resumption from specific chunk offsets
- Incomplete temporary file cleanup upon cancellation
- Immediate ephemeral file deletion on single and batch ZIP downloads (`AUTO_DELETE_ON_DOWNLOAD`)
- Background garbage collection for stale relay files

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.
