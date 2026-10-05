#!/usr/bin/env bash
# LANBridge - Local Network File Transfer Launcher for Linux & macOS

set -e

echo "==================================================="
echo "          LANBridge - Starting Server...          "
echo "==================================================="
echo ""

# 1. Check Python 3
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] python3 could not be found!"
    echo "Please install Python 3.9+ using your package manager (e.g. apt install python3 python3-venv, brew install python3)."
    exit 1
fi

# 2. Setup Virtual Environment
if [ ! -d ".venv" ]; then
    echo "[*] Creating virtual environment in .venv..."
    python3 -m venv .venv
fi

# 3. Activate and Install Dependencies
echo "[*] Verifying dependencies..."
source .venv/bin/activate
pip install --upgrade pip --quiet
pip install -r backend/requirements.txt --quiet

# 4. Start Server
echo ""
echo "[*] Launching LANBridge Host Server..."
echo ""
python3 run.py
