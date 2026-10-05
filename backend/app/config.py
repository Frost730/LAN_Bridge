import sys
from pathlib import Path
import os

if getattr(sys, "frozen", False):
    # PyInstaller extracts bundled assets to sys._MEIPASS
    BUNDLE_DIR = Path(sys._MEIPASS)
    # Write persistent files next to the running executable
    APP_DIR = Path(sys.executable).resolve().parent
else:
    BUNDLE_DIR = Path(__file__).resolve().parent.parent.parent
    APP_DIR = BUNDLE_DIR

BASE_DIR = BUNDLE_DIR
BACKEND_DIR = BUNDLE_DIR / "backend"

class Settings:
    APP_NAME: str = "LANBridge"
    VERSION: str = "1.0.0"
    HOST: str = os.getenv("LANBRIDGE_HOST", "0.0.0.0")
    PORT: int = int(os.getenv("LANBRIDGE_PORT", "8000"))

    # Storage paths
    DATA_DIR: Path = APP_DIR / "data"
    RECEIVED_DIR: Path = APP_DIR / "received"
    TEMP_DIR: Path = APP_DIR / "temp"
    DB_PATH: Path = DATA_DIR / "lanbridge.db"

    # Transfer settings
    DEFAULT_CHUNK_SIZE: int = 2 * 1024 * 1024  # 2MB chunks
    PERFORMANCE_CHUNK_SIZE: int = 4 * 1024 * 1024  # 4MB chunks
    MAX_CONCURRENT_TRANSFERS: int = 3
    PERFORMANCE_CONCURRENT_TRANSFERS: int = 6

    # Security settings
    PAIRING_CODE_EXPIRY_SECONDS: int = 300  # 5 minutes
    PAIRING_TOKEN_EXPIRY_SECONDS: int = 600  # 10 minutes
    MAX_PAIR_ATTEMPTS_PER_MINUTE: int = 5
    REQUIRE_APPROVAL: bool = True

    def ensure_directories(self) -> None:
        self.DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.RECEIVED_DIR.mkdir(parents=True, exist_ok=True)
        self.TEMP_DIR.mkdir(parents=True, exist_ok=True)

settings = Settings()
settings.ensure_directories()
