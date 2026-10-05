import secrets
import string
import time
from typing import Dict, Optional, Tuple
from dataclasses import dataclass
from ..config import settings

@dataclass
class PairingCodeData:
    code: str
    created_at: float
    expires_at: float
    attempts: int = 0

@dataclass
class PairingTokenData:
    token: str
    created_at: float
    expires_at: float
    used: bool = False

@dataclass
class SessionTokenData:
    token: str
    device_id: str
    device_name: str
    created_at: float
    last_seen: float

class TokenManager:
    def __init__(self):
        self._current_pairing_code: Optional[PairingCodeData] = None
        self._pairing_tokens: Dict[str, PairingTokenData] = {}
        self._active_sessions: Dict[str, SessionTokenData] = {}
        self._failed_attempts_by_ip: Dict[str, list[float]] = {}

    def generate_pairing_code(self) -> str:
        """Generates a secure 6-digit temporary pairing code"""
        code = "".join(secrets.choice(string.digits) for _ in range(6))
        now = time.time()
        self._current_pairing_code = PairingCodeData(
            code=code,
            created_at=now,
            expires_at=now + settings.PAIRING_CODE_EXPIRY_SECONDS,
            attempts=0
        )
        return code

    def get_current_pairing_code(self) -> Optional[Tuple[str, int]]:
        """Returns current (code, remaining_seconds) if valid"""
        if not self._current_pairing_code:
            return None
        now = time.time()
        remaining = int(self._current_pairing_code.expires_at - now)
        if remaining <= 0:
            self._current_pairing_code = None
            return None
        return self._current_pairing_code.code, remaining

    def generate_pairing_token(self) -> str:
        """Generates a secure random pairing token for QR code"""
        token = secrets.token_urlsafe(32)
        now = time.time()
        self._pairing_tokens[token] = PairingTokenData(
            token=token,
            created_at=now,
            expires_at=now + settings.PAIRING_TOKEN_EXPIRY_SECONDS,
            used=False
        )
        return token

    def is_rate_limited(self, ip: str) -> bool:
        """Checks if an IP has exceeded failed attempts in the last minute"""
        now = time.time()
        attempts = self._failed_attempts_by_ip.get(ip, [])
        # Keep only attempts in the last 60s
        recent = [t for t in attempts if now - t < 60]
        self._failed_attempts_by_ip[ip] = recent
        return len(recent) >= settings.MAX_PAIR_ATTEMPTS_PER_MINUTE

    def record_failed_attempt(self, ip: str) -> None:
        now = time.time()
        if ip not in self._failed_attempts_by_ip:
            self._failed_attempts_by_ip[ip] = []
        self._failed_attempts_by_ip[ip].append(now)

    def verify_pairing_code(self, code: str, ip: str) -> bool:
        """Verifies the entered 6-digit code with rate-limiting"""
        if self.is_rate_limited(ip):
            return False

        if not self._current_pairing_code:
            self.record_failed_attempt(ip)
            return False

        now = time.time()
        if now > self._current_pairing_code.expires_at:
            self._current_pairing_code = None
            self.record_failed_attempt(ip)
            return False

        self._current_pairing_code.attempts += 1
        # Maximum 5 attempts per generated code before invalidating
        if self._current_pairing_code.attempts > 5:
            self._current_pairing_code = None
            self.record_failed_attempt(ip)
            return False

        # Clean spaces
        clean_code = code.replace(" ", "").strip()
        if secrets.compare_digest(clean_code, self._current_pairing_code.code):
            # Consume pairing code on success
            self._current_pairing_code = None
            return True

        self.record_failed_attempt(ip)
        return False

    def verify_pairing_token(self, token: str) -> bool:
        """Verifies a QR code pairing token"""
        data = self._pairing_tokens.get(token)
        if not data:
            return False
        now = time.time()
        if now > data.expires_at or data.used:
            self._pairing_tokens.pop(token, None)
            return False
        # Invalidate after one-time verification
        data.used = True
        return True

    def create_session(self, device_id: str, device_name: str) -> str:
        """Creates an authenticated session token for an approved device"""
        token = secrets.token_hex(32)
        now = time.time()
        self._active_sessions[token] = SessionTokenData(
            token=token,
            device_id=device_id,
            device_name=device_name,
            created_at=now,
            last_seen=now
        )
        return token

    def validate_session(self, token: Optional[str]) -> Optional[SessionTokenData]:
        """Validates a session token and updates last_seen"""
        if not token:
            return None
        session = self._active_sessions.get(token)
        if session:
            session.last_seen = time.time()
        return session

    def revoke_session(self, token: str) -> None:
        self._active_sessions.pop(token, None)

    def revoke_device_sessions(self, device_id: str) -> None:
        to_delete = [t for t, s in self._active_sessions.items() if s.device_id == device_id]
        for t in to_delete:
            self._active_sessions.pop(t, None)

token_manager = TokenManager()
