from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = Path(__file__).resolve().parent.parent

class Settings:
    APP_NAME: str = "LANBridge"
    VERSION: str = "1.0.0"
    HOST: str = os.getenv("LANBRIDGE_HOST", "0.0.0.0")
    PORT: int = int(os.getenv("LANBRIDGE_PORT", "8000"))

    # Storage paths
    DATA_DIR: Path = BASE_DIR / "data"
    RECEIVED_DIR: Path = BASE_DIR / "received"
    TEMP_DIR: Path = BASE_DIR / "temp"
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
