"""Device identity primitives — moved from ``gateway/auth.py`` (Phase 0).

Disabled at the WS gateway when ``settings.enable_auth`` is false; the
gateway then accepts any (or no) bearer and assigns ``device_id="dev-lamp"``.
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any


JWT_ISSUER = "lumos-auth"
JWT_VERSION = 1
PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
SECRET_HASH_PREFIX = "scrypt"
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1


class DeviceJwtError(ValueError):
    """Bad signature, malformed token, or missing claims."""


def normalize_pairing_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def generate_pairing_code(length: int = 6) -> str:
    return "".join(secrets.choice(PAIRING_CODE_ALPHABET) for _ in range(length))


def hash_device_secret(secret: str, salt: bytes | None = None) -> str:
    if not secret:
        raise ValueError("Device secret is required")
    salt_bytes = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(
        secret.encode("utf-8"), salt=salt_bytes, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P
    )
    return "$".join(
        [
            SECRET_HASH_PREFIX,
            str(SCRYPT_N),
            str(SCRYPT_R),
            str(SCRYPT_P),
            base64.b64encode(salt_bytes).decode("ascii"),
            base64.b64encode(digest).decode("ascii"),
        ]
    )


def verify_device_secret(secret: str, encoded_hash: str) -> bool:
    try:
        prefix, n_raw, r_raw, p_raw, salt_raw, digest_raw = encoded_hash.split("$", 5)
        if prefix != SECRET_HASH_PREFIX:
            return False
        salt = base64.b64decode(salt_raw)
        expected = base64.b64decode(digest_raw)
        actual = hashlib.scrypt(
            secret.encode("utf-8"),
            salt=salt,
            n=int(n_raw),
            r=int(r_raw),
            p=int(p_raw),
        )
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw + padding)


def _json_b64url(data: dict[str, Any]) -> str:
    return _b64url_encode(json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8"))


def create_device_jwt(
    *,
    device_id: str,
    user_id: str,
    signing_secret: str,
    issued_at: int | None = None,
) -> str:
    if not device_id or not user_id:
        raise ValueError("Device and user IDs are required")
    if not signing_secret:
        raise ValueError("Device JWT signing secret is required")

    now = int(issued_at or time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": JWT_ISSUER,
        "sub": device_id,
        "uid": user_id,
        "iat": now,
        "ver": JWT_VERSION,
    }
    signing_input = f"{_json_b64url(header)}.{_json_b64url(payload)}"
    signature = hmac.new(
        signing_secret.encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{signing_input}.{_b64url_encode(signature)}"


def verify_device_jwt(token: str, signing_secret: str) -> dict[str, Any]:
    if not token or not signing_secret:
        raise DeviceJwtError("Missing device JWT or signing secret")

    parts = token.split(".")
    if len(parts) != 3:
        raise DeviceJwtError("Malformed device JWT")

    signing_input = f"{parts[0]}.{parts[1]}"
    expected_signature = hmac.new(
        signing_secret.encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()
    try:
        actual_signature = _b64url_decode(parts[2])
    except Exception as exc:
        raise DeviceJwtError("Malformed device JWT signature") from exc

    if not hmac.compare_digest(actual_signature, expected_signature):
        raise DeviceJwtError("Invalid device JWT signature")

    try:
        header = json.loads(_b64url_decode(parts[0]))
        claims = json.loads(_b64url_decode(parts[1]))
    except Exception as exc:
        raise DeviceJwtError("Malformed device JWT payload") from exc

    if header.get("alg") != "HS256" or claims.get("iss") != JWT_ISSUER:
        raise DeviceJwtError("Unsupported device JWT")
    if not claims.get("sub") or not claims.get("uid"):
        raise DeviceJwtError("Device JWT is missing required claims")

    return claims
