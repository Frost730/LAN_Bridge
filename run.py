import os
import sys
import threading
import time
import webbrowser
from pathlib import Path

# Add backend directory to sys.path
if getattr(sys, "frozen", False):
    backend_dir = Path(sys._MEIPASS) / "backend"
else:
    backend_dir = Path(__file__).resolve().parent / "backend"

sys.path.insert(0, str(backend_dir))

import uvicorn
from app.config import settings
from app.main import app

def open_browser(port: int):
    time.sleep(1.0)
    webbrowser.open(f"http://localhost:{port}")

def main():
    host = settings.HOST
    port = settings.PORT

    # Automatically open default browser on desktop launch
    if "--no-browser" not in sys.argv:
        threading.Thread(target=open_browser, args=(port,), daemon=True).start()

    uvicorn.run(
        app,
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )

if __name__ == "__main__":
    main()
