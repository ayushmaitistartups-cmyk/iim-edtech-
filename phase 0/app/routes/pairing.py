"""Pairing REST endpoints — moved from ``gateway/pairing.py`` (Phase 0).

Behaviour matches the Phase 0 contract. The endpoints are mounted whether
``ENABLE_AUTH`` is true or false; the lamp simply does not call them while
``ENABLE_AUTH=0`` on its side. See ``IMPLEMENTATION_AUTH_PAIRING.md``.
"""

import base64
import json
import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from ..auth.devices import DeviceRegistry, DeviceRegistryError
from ..config import settings


logger = logging.getLogger(__name__)
router = APIRouter()


def get_device_registry() -> DeviceRegistry:
    raise RuntimeError("DeviceRegistry has not been wired into the FastAPI app")


class DeviceRegisterRequest(BaseModel):
    device_id: str = Field(min_length=3, max_length=128)
    device_secret: str = Field(min_length=8, max_length=256)


class DevicePollRequest(DeviceRegisterRequest):
    pairing_code: str = Field(min_length=4, max_length=16)


class CompletePairingRequest(BaseModel):
    pairing_code: str = Field(min_length=4, max_length=16)


class RenameDeviceRequest(BaseModel):
    friendly_name: str = Field(min_length=1, max_length=64)


def _registry_http_error(exc: DeviceRegistryError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={"code": exc.code, "message": str(exc)},
    )


def _decode_jwt_payload_without_verification(token: str) -> dict[str, Any] | None:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        padding = "=" * (-len(parts[1]) % 4)
        payload = base64.urlsafe_b64decode(parts[1] + padding)
        return json.loads(payload)
    except Exception:
        return None


async def current_clerk_user_id(authorization: str | None = Header(default=None)) -> str:
    dev_user_id = os.getenv("AUTH_DEV_USER_ID")
    if dev_user_id and not authorization:
        return dev_user_id

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHORIZED", "message": "Missing Clerk bearer token"},
        )

    token = authorization[7:].strip()
    if token.startswith("dev:"):
        return token[4:]

    if settings.trust_unsigned_clerk_jwt:
        payload = _decode_jwt_payload_without_verification(token)
        user_id = payload.get("sub") if payload else None
        if isinstance(user_id, str) and user_id:
            return user_id

    raise HTTPException(
        status_code=401,
        detail={"code": "UNVERIFIED_CLERK_TOKEN", "message": "Unable to resolve Clerk user ID"},
    )


@router.post("/api/device/register")
async def register_device(
    payload: DeviceRegisterRequest,
    registry: DeviceRegistry = Depends(get_device_registry),
) -> dict[str, Any]:
    try:
        return registry.register_device(
            device_id=payload.device_id,
            device_secret=payload.device_secret,
            frontend_base_url=settings.frontend_base_url,
        )
    except DeviceRegistryError as exc:
        raise _registry_http_error(exc) from exc


@router.post("/api/device/poll-pairing")
async def poll_pairing(
    payload: DevicePollRequest,
    registry: DeviceRegistry = Depends(get_device_registry),
) -> dict[str, Any]:
    try:
        return registry.poll_pairing(
            device_id=payload.device_id,
            device_secret=payload.device_secret,
            pairing_code=payload.pairing_code,
        )
    except DeviceRegistryError as exc:
        raise _registry_http_error(exc) from exc


@router.get("/api/pairing-info/{pairing_code}")
async def get_pairing_info(
    pairing_code: str,
    _: str = Depends(current_clerk_user_id),
    registry: DeviceRegistry = Depends(get_device_registry),
) -> dict[str, Any]:
    try:
        return registry.get_pairing_info(pairing_code)
    except DeviceRegistryError as exc:
        raise _registry_http_error(exc) from exc


@router.post("/api/device/complete-pairing")
async def complete_pairing(
    payload: CompletePairingRequest,
    user_id: str = Depends(current_clerk_user_id),
    registry: DeviceRegistry = Depends(get_device_registry),
) -> dict[str, Any]:
    try:
        return registry.complete_pairing(
            pairing_code=payload.pairing_code,
            user_id=user_id,
            signing_secret=settings.device_jwt_secret,
        )
    except DeviceRegistryError as exc:
        raise _registry_http_error(exc) from exc


@router.get("/api/devices")
async def list_devices(
    user_id: str = Depends(current_clerk_user_id),
    registry: DeviceRegistry = Depends(get_device_registry),
) -> dict[str, Any]:
    return {"devices": registry.list_devices(user_id)}


@router.post("/api/device/{device_id}/unlink")
async def unlink_device(
    device_id: str,
    user_id: str = Depends(current_clerk_user_id),
    registry: DeviceRegistry = Depends(get_device_registry),
) -> dict[str, Any]:
    try:
        return registry.unlink_device(device_id, user_id)
    except DeviceRegistryError as exc:
        raise _registry_http_error(exc) from exc


@router.post("/api/device/{device_id}/rename")
async def rename_device(
    device_id: str,
    payload: RenameDeviceRequest,
    user_id: str = Depends(current_clerk_user_id),
    registry: DeviceRegistry = Depends(get_device_registry),
) -> dict[str, Any]:
    try:
        return registry.rename_device(device_id, user_id, payload.friendly_name)
    except DeviceRegistryError as exc:
        raise _registry_http_error(exc) from exc
