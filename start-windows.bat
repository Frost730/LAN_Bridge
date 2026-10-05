@echo off
title LANBridge - Local Network File Transfer
echo ===================================================
echo           LANBridge - Starting Server...
echo ===================================================
echo.

:: 1. Verify Python availability
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in your PATH!
    echo Please install Python 3.9 or newer from https://www.python.org/downloads/
    echo Make sure to check the box "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

:: 2. Create virtual environment if missing
if not exist ".venv" (
    echo [*] Creating virtual environment in .venv...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)

:: 3. Install/verify dependencies
echo [*] Checking dependencies...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip --quiet
pip install -r backend\requirements.txt --quiet
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install backend dependencies.
    pause
    exit /b 1
)

:: 4. Start LANBridge
echo.
echo [*] Launching LANBridge Host Server...
echo.
python run.py

if %errorlevel% neq 0 (
    echo.
    echo [!] Server stopped with error code %errorlevel%.
    pause
)
