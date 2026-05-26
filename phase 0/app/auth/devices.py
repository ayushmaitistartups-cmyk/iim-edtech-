"""File-backed device registry.

Phase 0 keeps device + pairing state in a single JSON file so the gateway
runs without Postgres. Phase 5 will swap this for an async DB adapter that
implements the same surface.
"""

import json
import threading
import time
from pathlib import Path
from typing import Any

from app.auth.device_jwt import (
    create_device_jwt,
    generate_pairing_code,
    hash_device_secret,
    normalize_pairing_code,
    verify_device_secret,
)


class DeviceRegistryError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class DeviceRegistry:
    def __init__(self, path: Path | str | None = None, ttl_seconds: int = 300):
        self.path = Path(path) if path else None
        self.ttl_seconds = ttl_seconds
        self._lock = threading.RLock()
        self._data: dict[str, dict[str, dict[str, Any]]] = {
            "devices": {},
            "pairing_codes": {},
        }
        self._load()

    def register_device(
        self,
        device_id: str,
        device_secret: str,
        frontend_base_url: str,
        now: int | None = None,
    ) -> dict[str, Any]:
        self._require_device_identity(device_id, device_secret)
        current_time = int(now or time.time())

        with self._lock:
            device = self._data["devices"].get(device_id)
            if device:
                self._verify_secret_or_raise(device, device_secret)
            else:
                device = {
                    "device_id": device_id,
                    "device_secret_hash": hash_device_secret(device_secret),
                    "friendly_name": self._friendly_name(device_id),
                    "user_id": None,
                    "created_at": current_time,
                    "paired_at": None,
                    "last_seen": None,
                    "revoked_at": None,
                }
                self._data["devices"][device_id] = device

            code = self._new_unique_pairing_code()
            expires_at = current_time + self.ttl_seconds
            self._data["pairing_codes"][code] = {
                "pairing_code": code,
                "device_id": device_id,
                "expires_at": expires_at,
                "status": "pending",
                "device_jwt": None,
                "claimed_user_id": None,
            }
            self._save()

        pairing_url = f"{frontend_base_url.rstrip('/')}/pair/{code}"
        return {
            "device_id": device_id,
            "friendly_name": device["friendly_name"],
            "pairing_code": code,
            "display_code": self.format_pairing_code(code),
            "pairing_url": pairing_url,
            "expires_at": expires_at,
            "status": "pending",
        }

    def poll_pairing(
        self,
        device_id: str,
        device_secret: str,
        pairing_code: str,
        now: int | None = None,
    ) -> dict[str, Any]:
        self._require_device_identity(device_id, device_secret)
        code = normalize_pairing_code(pairing_code)
        current_time = int(now or time.time())

        with self._lock:
            device = self._data["devices"].get(device_id)
            if not device:
                return {"status": "not_found"}
            self._verify_secret_or_raise(device, device_secret)

            pairing = self._data["pairing_codes"].get(code)
            if not pairing or pairing["device_id"] != device_id:
                return {"status": "not_found"}
            if pairing["expires_at"] < current_time:
                del self._data["pairing_codes"][code]
                self._save()
                return {"status": "expired"}

            if pairing["status"] == "paired" and pairing.get("device_jwt"):
                response = {
                    "status": "paired",
                    "device_jwt": pairing["device_jwt"],
                    "device_id": device_id,
                }
                del self._data["pairing_codes"][code]
                self._save()
                return response

            return {"status": "pending", "expires_at": pairing["expires_at"]}

    def get_pairing_info(self, pairing_code: str, now: int | None = None) -> dict[str, Any]:
        code = normalize_pairing_code(pairing_code)
        current_time = int(now or time.time())

        with self._lock:
            pairing = self._data["pairing_codes"].get(code)
            if not pairing:
                raise DeviceRegistryError("CODE_NOT_FOUND", "Pairing code was not found", 404)
            if pairing["expires_at"] < current_time:
                raise DeviceRegistryError("CODE_EXPIRED", "Pairing code expired", 410)
            if pairing["status"] != "pending":
                raise DeviceRegistryError("ALREADY_PAIRED", "This lamp is already linked", 409)

            device = self._data["devices"].get(pairing["device_id"])
            if not device:
                raise DeviceRegistryError("DEVICE_NOT_FOUND", "Device was not found", 404)
            if device.get("user_id") and not device.get("revoked_at"):
                raise DeviceRegistryError("ALREADY_PAIRED", "This lamp is already linked", 409)

            return {
                "pairing_code": code,
                "display_code": self.format_pairing_code(code),
                "device_id": device["device_id"],
                "friendly_name": device["friendly_name"],
                "expires_at": pairing["expires_at"],
            }

    def complete_pairing(
        self,
        pairing_code: str,
        user_id: str,
        signing_secret: str,
        now: int | None = None,
    ) -> dict[str, Any]:
        if not user_id:
            raise DeviceRegistryError("UNAUTHORIZED", "A signed-in user is required", 401)

        code = normalize_pairing_code(pairing_code)
        current_time = int(now or time.time())

        with self._lock:
            pairing = self._data["pairing_codes"].get(code)
            if not pairing:
                raise DeviceRegistryError("CODE_NOT_FOUND", "Pairing code was not found", 404)
            if pairing["expires_at"] < current_time:
                raise DeviceRegistryError("CODE_EXPIRED", "Pairing code expired", 410)
            if pairing["status"] != "pending":
                raise DeviceRegistryError("ALREADY_PAIRED", "This pairing code has already been used", 409)

            device = self._data["devices"].get(pairing["device_id"])
            if not device:
                raise DeviceRegistryError("DEVICE_NOT_FOUND", "Device was not found", 404)
            if device.get("user_id") and device["user_id"] != user_id and not device.get("revoked_at"):
                raise DeviceRegistryError("ALREADY_PAIRED", "This lamp is already linked", 409)

            device["user_id"] = user_id
            device["paired_at"] = current_time
            device["revoked_at"] = None
            pairing["status"] = "paired"
            pairing["claimed_user_id"] = user_id
            pairing["device_jwt"] = create_device_jwt(
                device_id=device["device_id"],
                user_id=user_id,
                signing_secret=signing_secret,
                issued_at=current_time,
            )
            self._save()

        return {
            "device_id": device["device_id"],
            "friendly_name": device["friendly_name"],
            "paired_at": device["paired_at"],
        }

    def list_devices(self, user_id: str) -> list[dict[str, Any]]:
        with self._lock:
            return [
                self._public_device(device)
                for device in self._data["devices"].values()
                if device.get("user_id") == user_id and not device.get("revoked_at")
            ]

    def unlink_device(self, device_id: str, user_id: str) -> dict[str, Any]:
        with self._lock:
            device = self._owned_device_or_raise(device_id, user_id)
            device["revoked_at"] = int(time.time())
            device["user_id"] = None
            self._save()
            return {"device_id": device_id, "status": "revoked"}

    def rename_device(self, device_id: str, user_id: str, friendly_name: str) -> dict[str, Any]:
        name = friendly_name.strip()
        if not name:
            raise DeviceRegistryError("INVALID_NAME", "Device name is required", 422)
        if len(name) > 64:
            raise DeviceRegistryError("INVALID_NAME", "Device name must be 64 characters or fewer", 422)

        with self._lock:
            device = self._owned_device_or_raise(device_id, user_id)
            device["friendly_name"] = name
            self._save()
            return self._public_device(device)

    def get_active_device_for_jwt(self, device_id: str, user_id: str) -> dict[str, Any] | None:
        with self._lock:
            device = self._data["devices"].get(device_id)
            if not device:
                return None
            if device.get("revoked_at") or device.get("user_id") != user_id:
                return None
            device["last_seen"] = int(time.time())
            self._save()
            return self._public_device(device)

    def device_exists(self, device_id: str) -> bool:
        with self._lock:
            return device_id in self._data["devices"]

    @staticmethod
    def format_pairing_code(code: str) -> str:
        normalized = normalize_pairing_code(code)
        return f"{normalized[:3]}-{normalized[3:]}" if len(normalized) == 6 else normalized

    def _owned_device_or_raise(self, device_id: str, user_id: str) -> dict[str, Any]:
        device = self._data["devices"].get(device_id)
        if not device or device.get("user_id") != user_id or device.get("revoked_at"):
            raise DeviceRegistryError("DEVICE_NOT_FOUND", "Device was not found", 404)
        return device

    def _new_unique_pairing_code(self) -> str:
        for _ in range(20):
            code = generate_pairing_code()
            if code not in self._data["pairing_codes"]:
                return code
        raise DeviceRegistryError("CODE_GENERATION_FAILED", "Could not create pairing code", 500)

    def _verify_secret_or_raise(self, device: dict[str, Any], device_secret: str) -> None:
        if not verify_device_secret(device_secret, device["device_secret_hash"]):
            raise DeviceRegistryError("DEVICE_SECRET_INVALID", "Device secret is invalid", 401)

    @staticmethod
    def _require_device_identity(device_id: str, device_secret: str) -> None:
        if not device_id or not device_secret:
            raise DeviceRegistryError("DEVICE_IDENTITY_REQUIRED", "Device ID and secret are required", 422)

    @staticmethod
    def _friendly_name(device_id: str) -> str:
        suffix = device_id[-6:].upper() if len(device_id) >= 6 else device_id.upper()
        return f"Lumos Lamp {suffix}"

    @staticmethod
    def _public_device(device: dict[str, Any]) -> dict[str, Any]:
        return {
            "device_id": device["device_id"],
            "friendly_name": device["friendly_name"],
            "paired_at": device.get("paired_at"),
            "last_seen": device.get("last_seen"),
        }

    def _load(self) -> None:
        if not self.path or not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            self._data["devices"] = raw.get("devices", {})
            self._data["pairing_codes"] = raw.get("pairing_codes", {})
        except Exception:
            self._data = {"devices": {}, "pairing_codes": {}}

    def _save(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self._data, indent=2, sort_keys=True), encoding="utf-8")
