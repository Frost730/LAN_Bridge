# -*- mode: python ; coding: utf-8 -*-
import sys
from pathlib import Path

ROOT = Path.cwd()

datas = [
    (str(ROOT / 'frontend' / 'dist'), 'frontend/dist'),
    (str(ROOT / 'backend'), 'backend'),
]

hiddenimports = [
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespans',
    'uvicorn.lifespans.on',
    'websockets',
    'websockets.legacy',
    'websockets.legacy.server',
    'aiosqlite',
    'zeroconf',
    'zeroconf._utils.ipaddress',
    'psutil',
    'cryptography',
    'python_multipart',
]

a = Analysis(
    ['run.py'],
    pathex=[str(ROOT), str(ROOT / 'backend')],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['pytest', 'tkinter', 'unittest'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='LANBridge',
    icon='icon.ico',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
