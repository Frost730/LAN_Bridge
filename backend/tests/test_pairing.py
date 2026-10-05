import pytest
import time
from app.security.tokens import TokenManager

def test_pairing_code_generation_and_verification():
    tm = TokenManager()
    code = tm.generate_pairing_code()
    assert len(code) == 6
    assert code.isdigit()

    # Successful verification
    assert tm.verify_pairing_code(code, "192.168.1.10") is True

    # Code should now be consumed (one-time)
    assert tm.verify_pairing_code(code, "192.168.1.10") is False

def test_pairing_code_invalid_and_rate_limiting():
    tm = TokenManager()
    code = tm.generate_pairing_code()

    # 5 wrong attempts from same IP
    ip = "192.168.1.55"
    for _ in range(5):
        assert tm.verify_pairing_code("000000", ip) is False

    # 6th attempt should be rate-limited
    assert tm.is_rate_limited(ip) is True
    assert tm.verify_pairing_code(code, ip) is False

def test_pairing_token_qr_expiration():
    tm = TokenManager()
    token = tm.generate_pairing_token()
    assert len(token) > 20

    # Valid token
    assert tm.verify_pairing_token(token) is True
    # One-time use: second attempt fails
    assert tm.verify_pairing_token(token) is False

def test_session_lifecycle():
    tm = TokenManager()
    session_token = tm.create_session("device-123", "Galaxy-S24")
    assert session_token is not None

    session = tm.validate_session(session_token)
    assert session is not None
    assert session.device_id == "device-123"
    assert session.device_name == "Galaxy-S24"

    # Revoke
    tm.revoke_session(session_token)
    assert tm.validate_session(session_token) is None
