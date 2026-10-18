"""Password, token, TOTP, recovery-code, and encryption primitives."""

import base64
import hashlib
import hmac
import io
import secrets
import struct
import time
from urllib.parse import quote

import qrcode
from cryptography.fernet import Fernet, InvalidToken

from .config import AUTH_ENCRYPTION_KEY, AUTH_RECOVERY_PEPPER


PASSWORD_N = 2**15
PASSWORD_R = 8
PASSWORD_P = 1
PASSWORD_LENGTH = 64
PASSWORD_MAX_LENGTH = 128
TOTP_PERIOD = 30
TOTP_DIGITS = 6
RECOVERY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def hash_password(password: str) -> str:
    validate_password(password)
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=PASSWORD_N,
        r=PASSWORD_R,
        p=PASSWORD_P,
        dklen=PASSWORD_LENGTH,
        maxmem=64 * 1024 * 1024,
    )
    return "$".join(
        (
            "scrypt",
            str(PASSWORD_N),
            str(PASSWORD_R),
            str(PASSWORD_P),
            base64.urlsafe_b64encode(salt).decode("ascii"),
            base64.urlsafe_b64encode(digest).decode("ascii"),
        )
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = stored.split("$", 5)
        if algorithm != "scrypt":
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=base64.urlsafe_b64decode(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(base64.urlsafe_b64decode(expected)),
            maxmem=64 * 1024 * 1024,
        )
        return hmac.compare_digest(actual, base64.urlsafe_b64decode(expected))
    except (ValueError, TypeError):
        return False


def validate_password(password: str) -> None:
    if len(password) < 12:
        raise ValueError("Use at least 12 characters for your password.")
    if len(password) > PASSWORD_MAX_LENGTH:
        raise ValueError("Use no more than 128 characters for your password.")
    requirements = (
        any(character.islower() for character in password),
        any(character.isupper() for character in password),
        any(character.isdigit() for character in password),
        any(not character.isalnum() for character in password),
    )
    if not all(requirements):
        raise ValueError("Include uppercase, lowercase, a number, and a symbol.")


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def identifier_hash(value: str) -> str:
    return token_hash(value.strip().lower())


def recovery_hash(value: str) -> str:
    normalized = value.replace("-", "").strip().upper()
    return hmac.new(
        AUTH_RECOVERY_PEPPER.encode("utf-8"), normalized.encode("ascii"), hashlib.sha256
    ).hexdigest()


def generate_recovery_codes(count: int = 8) -> list[str]:
    return [
        "-".join(
            "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(4))
            for _ in range(3)
        )
        for _ in range(count)
    ]


def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _base32_decode(secret: str) -> bytes:
    padding = "=" * ((8 - len(secret) % 8) % 8)
    return base64.b32decode(secret.upper() + padding)


def totp_code(secret: str, timestamp: int | None = None) -> str:
    counter = int((timestamp if timestamp is not None else time.time()) // TOTP_PERIOD)
    digest = hmac.new(
        _base32_decode(secret), struct.pack(">Q", counter), hashlib.sha1
    ).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % (
        10**TOTP_DIGITS
    )
    return str(value).zfill(TOTP_DIGITS)


def verify_totp(secret: str, code: str, timestamp: int | None = None) -> bool:
    if not code.isdigit() or len(code) != TOTP_DIGITS:
        return False
    current = int(timestamp if timestamp is not None else time.time())
    return any(
        hmac.compare_digest(totp_code(secret, current + offset * TOTP_PERIOD), code)
        for offset in (-1, 0, 1)
    )


def encrypt_secret(secret: str) -> str:
    return Fernet(AUTH_ENCRYPTION_KEY.encode("ascii")).encrypt(
        secret.encode("ascii")
    ).decode("ascii")


def decrypt_secret(encrypted: str) -> str:
    try:
        return Fernet(AUTH_ENCRYPTION_KEY.encode("ascii")).decrypt(
            encrypted.encode("ascii")
        ).decode("ascii")
    except InvalidToken as error:
        raise RuntimeError("Stored MFA credentials cannot be decrypted") from error


def totp_uri(secret: str, user_id: str) -> str:
    label = quote(f"ValuX:{user_id}")
    issuer = quote("ValuX")
    return (
        f"otpauth://totp/{label}?secret={secret}&issuer={issuer}"
        f"&algorithm=SHA1&digits={TOTP_DIGITS}&period={TOTP_PERIOD}"
    )


def qr_data_uri(value: str) -> str:
    image = qrcode.make(value)
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    encoded = base64.b64encode(stream.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"
