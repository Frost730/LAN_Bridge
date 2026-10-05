import os
import sys
import uvicorn
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.config import settings

def main():
    host = settings.HOST
    port = settings.PORT

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
        app_dir=str(backend_dir)
    )

if __name__ == "__main__":
    main()
