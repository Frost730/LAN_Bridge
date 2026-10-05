# LANBridge ⚡

> **High-speed, private, local network file and folder transfer application.**  
> Transfer files directly between Windows, Android, macOS, and Linux devices over Wi-Fi/Ethernet — **100% offline, zero cloud relay, no user accounts required.**

---

## 📖 Overview

**LANBridge** is an open-source, web-based local file transfer utility engineered for maximum speed, security, and simplicity. It allows any device on your local area network (LAN) to exchange files and folders directly without routing data through third-party servers or the Internet.

The host computer runs a lightweight Python/FastAPI service that binds to your local network interface. Any other device (phones, tablets, laptops) simply opens the host's IP address or scans a generated QR code in their browser to begin transferring at wire speed.

---

## ✨ Features

- 🚀 **Wire-Speed LAN Transfers**: Optimized chunked binary streaming (2MB - 4MB configurable) achieving maximum Gigabit Wi-Fi / Ethernet throughput.
- 📁 **Full Folder Transfers**: Preserves directory trees, nested subfolders, and relative paths (`Project/src/App.tsx`). Graceful ZIP fallback for browsers without native folder writing.
- 🔄 **Resumable Transfers**: Automatic recovery if a Wi-Fi drop occurs. Preserves verified chunks on disk and resumes from the exact missing chunk offset without restarting from 0.
- ⏸️ **Pause / Resume / Cancel**: Real-time transfer controls with immediate temporary file cleanup on cancellation.
- 🔒 **Cryptographic Integrity**: Streaming SHA-256 verification detects corrupted or tampered files before finalizing.
- 📱 **QR Code & 6-Digit Pairing**: Instant device pairing via camera scan or temporary rate-limited 6-digit code.
- 🛡️ **Host Access Control**: Approval prompts for new devices with optional "Trust this device" persistent whitelist.
- 🛡️ **Strict Security & Path Traversal Protection**: Complete sanitization of filenames and relative paths, preventing directory escapes (`../../`, Windows drive letters, null bytes, DOS reserved names).
- 🔍 **mDNS / Zeroconf Discovery**: Automatic discovery of other LANBridge host instances across the local subnet.
- 📊 **Network Diagnostics & LAN Speed Test**: Built-in LAN throughput benchmark measuring true local network bandwidth (latency, upload, download).
- 📱 **Installable PWA & Responsive UI**: Works seamlessly on Desktop (sidebar layout) and Mobile (bottom navigation bar, touch-friendly, offline-ready application shell).
- 🌓 **Dark Mode**: System, Light, and Dark mode preferences with persistent storage.
- 📴 **100% Local & Offline**: Self-contained runtime with zero external CDNs, fonts, or tracking scripts.

---

## 🏛️ Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    Host Machine (Server)                    │
│                                                             │
│   FastAPI + Uvicorn (0.0.0.0:8000)                          │
│   ├── Static React SPA Bundle                               │
│   ├── Chunk Streaming Engine (HTTP PUT binary stream)       │
│   ├── WebSocket Signaling Hub (Presence & Progress)         │
│   ├── mDNS Discovery (Zeroconf _lanbridge._tcp.local)       │
│   └── SQLite Metadata Store (Tokens, History, Devices)      │
└──────────────────────────────┬──────────────────────────────┘
                               │ Local Wi-Fi / Ethernet
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
  │Android Phone │      │    Laptop    │      │    Tablet    │
  │Web Browser   │      │Web Browser   │      │Web Browser   │
  └──────────────┘      └──────────────┘      └──────────────┘
```

---

## 🚀 Quick Start (Production Mode)

LANBridge is designed to run with **a single command**.

### Prerequisites
- Python 3.10+
- Node.js 18+ (only needed if building from source)

### 1. Clone & Set Up
```bash
git clone https://github.com/your-username/lanbridge.git
cd lanbridge

# Create Python virtual environment
python -m venv backend/.venv

# Activate virtual environment
# Windows:
backend\.venv\Scripts\activate
# Linux/macOS:
source backend/.venv/bin/activate

# Install backend dependencies
pip install -r backend/requirements.txt
```

### 2. Build Frontend
```bash
cd frontend
npm install
npm run build
cd ..
```

### 3. Launch Application
```bash
python run.py
```

The terminal will display your connection links:
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

## 💻 Development Mode

To work on backend and frontend concurrently with hot-reloading:

### Terminal 1: Backend
```bash
cd backend
python -m venv .venv
# Activate venv
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Terminal 2: Frontend
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. Vite proxies `/api` and `/ws` to port 8000.

---

## 📱 Cross-Platform Usage Guide

### Windows ↔ Android Phone
1. Start LANBridge on your Windows PC (`python run.py`).
2. Click **Pair Device** on the PC screen to display the QR Code.
3. Open your phone camera or browser and scan the QR code.
4. The phone opens `http://<PC-IP>:8000/?pair=<token>` and sends a pairing request.
5. Click **Allow** (and optionally **Trust this device**) on the PC.
6. Now you can drag & drop or select files on either device to transfer instantly.

### Windows ↔ macOS / Linux
Open `http://<host-ip>:8000` in Safari, Chrome, or Firefox on macOS/Linux. Enter the 6-digit pairing code shown on the host PC or pair via QR.

---

## 🔒 Security Model

- **Local Network Scope**: The server only accepts traffic on the local subnet. It never connects to an external cloud or relays your data.
- **Ephemeral Pairing Codes**: 6-digit codes and QR tokens expire after 5 to 10 minutes and are invalidated once consumed.
- **Rate Limiting**: Brute-force protection blocks pairing code guessing after 5 failed attempts per minute.
- **Path Traversal Defenses**:
  - Filenames are sanitized, stripping invalid OS characters and Windows reserved devices (`CON`, `PRN`, `AUX`, `NUL`).
  - Directory components containing `..` or leading `/` or Windows drive letters (`C:`) are rejected.
  - Final target file paths are strictly asserted to be contained within the dedicated `received/` folder using `os.path.commonpath`.
- **Integrity Validation**: Transfers are verified against a streaming SHA-256 hash. Files with hash mismatches are flagged as failed and quarantined.

---

## 🔥 Windows Firewall Troubleshooting

When running `python run.py` for the first time, Windows Defender Firewall may prompt:  
*"Windows Defender Firewall has blocked some features of this app"*.

1. Check **Private networks, such as my home or work network**.
2. Click **Allow access**.
3. If phones cannot reach `http://<PC-IP>:8000`, verify that your PC's network profile is set to **Private Network** (Windows Settings → Network & Internet → Wi-Fi/Ethernet → Network Profile Type → **Private**).

---

## 🌐 Browser Capabilities & Limitations

| Feature | Desktop Chrome / Edge | Firefox | Safari (iOS/macOS) | Android Chrome |
|---|---|---|---|---|
| Single / Multi-file Transfer | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Folder Drag & Drop | ✅ Full | ✅ Full | ✅ Full | ⚠️ Pick via files |
| Directory Picker (`webkitdirectory`) | ✅ Full | ✅ Full | ⚠️ Files only | ⚠️ Files only |
| Resumable Chunk Streaming | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| SHA-256 Web Crypto | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Folder Download Fallback | 📦 ZIP Download | 📦 ZIP Download | 📦 ZIP Download | 📦 ZIP Download |

*Note: Mobile browsers do not grant arbitrary directory write access. When receiving folders on mobile or browsers without directory write APIs, LANBridge provides a one-click **Save ZIP** download containing the full preserved folder hierarchy.*

---

## 🧪 Automated Testing

LANBridge includes a comprehensive test suite covering security, tokens, chunk uploads, pause/resume, and large file streaming:

```bash
# Run backend pytest suite
pytest backend/tests
```

### Tested Scenarios:
- ✅ Malicious path traversal attempts (`../../`, `..\..\`, `/etc/passwd`, `C:\Windows`)
- ✅ Windows reserved names sanitization (`CON`, `PRN`, `AUX`)
- ✅ Pairing token expiration and 6-digit code rate limiting
- ✅ Chunk upload, reassembly, and streaming SHA-256 hash verification
- ✅ Interrupted transfer resumption from partial chunk offsets
- ✅ Cancellation temporary file cleanup
- ✅ Memory-bounded streaming for 10MB+ files (non-linear memory growth)

---

## 🔮 Future Improvements

- **WebRTC DataChannel Mode**: Browser-to-browser peer direct transfers without passing chunks through the host daemon.
- **TLS Self-Signed Wizard**: Optional internal HTTPS certificate generation for environments where secure context APIs are needed.
- **Native Tray Application**: Lightweight desktop system tray wrapper for Windows, macOS, and Linux.

---

## 📄 License

MIT License. Free for personal and commercial use.
