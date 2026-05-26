"""``/lamp/ws`` — single persistent WebSocket per paired lamp.

Phase 1 dispatch:

  IMAGE_PART (0x05)   → session.append_image_part
  IMAGE_JPEG (0x01)   → session.finalize_image
  AUDIO_CHUNK (0x02)  → session.append_audio
  AUDIO_END (0x03)    → orchestrator.run_turn (background task)
  CANCEL (0x04)       → cancel in-flight + STATE(idle) + TFT_CLEAR
  PING (0xF0)         → PONG

Auth: when ``ENABLE_AUTH=false`` the gateway accepts any bearer (or none) and
assigns ``device_id="dev-lamp"``. When auth is on, the existing 4401/4402
split from Phase 0 applies — see ``app.auth.device_jwt``.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from ..auth.device_jwt import DeviceJwtError, verify_device_jwt
from ..config import settings
from ..protocol import DeviceState, FrameDecodeError, FrameType, decode
from ..services.orchestrator import run_turn
from ..session import Session, session_store


logger = logging.getLogger(__name__)
router = APIRouter()


WS_CLOSE_AUTH_FAILED = 4401
WS_CLOSE_REVOKED = 4402


def _get_device_registry() -> Any | None:
    """Overridden by ``main.py`` when ENABLE_AUTH=true."""
    return None


def _authenticate(websocket: WebSocket, registry: Any | None) -> tuple[str, str] | None:
    """Returns ``(device_id, user_id)`` or ``None`` on auth failure."""
    if not settings.enable_auth:
        return ("dev-lamp", "dev-user")

    auth_header = websocket.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:].strip()
    if not token or token == "dev-mode-no-auth":
        # Treat the well-known dev token as anonymous even in enabled mode.
        return ("dev-lamp", "dev-user")
    try:
        claims = verify_device_jwt(token, settings.device_jwt_secret)
    except DeviceJwtError:
        return None
    device_id = claims["sub"]
    user_id = claims["uid"]
    if registry is not None:
        active = registry.get_active_device_for_jwt(device_id, user_id)
        if active is None:
            return ("__revoked__", user_id)
    return (device_id, user_id)


@router.websocket("/lamp/ws")
async def lamp_websocket_endpoint(
    websocket: WebSocket,
    registry: Any | None = Depends(_get_device_registry),
) -> None:
    await websocket.accept()

    auth = _authenticate(websocket, registry)
    if auth is None:
        logger.warning("Lamp WS rejected (4401): bad bearer")
        await websocket.close(code=WS_CLOSE_AUTH_FAILED)
        return
    device_id, user_id = auth
    if device_id == "__revoked__":
        logger.warning("Lamp WS rejected (4402): device revoked or unlinked")
        await websocket.close(code=WS_CLOSE_REVOKED)
        return

    session = Session(device_id=device_id, websocket=websocket, user_id=user_id)
    await session_store.attach(session)
    await session.send_state(DeviceState.IDLE)
    logger.info("Lamp WS connected: device=%s user=%s auth=%s", device_id, user_id, settings.enable_auth)

    try:
        while True:
            message = await websocket.receive_bytes()
            try:
                frame = decode(message)
            except FrameDecodeError as exc:
                logger.warning("Malformed lamp frame from %s: %s", device_id, exc)
                await session.send_state(DeviceState.ERROR)
                continue

            await _dispatch(session, frame.frame_type, frame.payload)

    except WebSocketDisconnect:
        logger.info("Lamp WS disconnected: device=%s", device_id)
    finally:
        await session_store.detach(device_id, websocket)


async def _dispatch(session: Session, frame_type: int, payload: bytes) -> None:
    if frame_type == FrameType.PING:
        await session.send_pong()
    elif frame_type == FrameType.IMAGE_PART:
        try:
            session.append_image_part(payload)
        except ValueError as exc:
            logger.warning("device=%s image too big: %s", session.device_id, exc)
            await session.send_state(DeviceState.ERROR)
    elif frame_type == FrameType.IMAGE_JPEG:
        session.finalize_image(payload)
    elif frame_type == FrameType.AUDIO_CHUNK:
        session.append_audio(payload)
    elif frame_type == FrameType.AUDIO_END:
        snapshot = session.snapshot_and_reset_turn()
        task = asyncio.create_task(
            run_turn(session, snapshot.image_bytes, bytes(snapshot.audio_pcm)),
            name=f"turn-{snapshot.turn_id}",
        )
        session.register_task(snapshot.turn_id, task)
    elif frame_type == FrameType.CANCEL:
        session.cancel_inflight()
        await session.send_clear()
        await session.send_audio_end()
        await session.send_state(DeviceState.IDLE)
    else:
        logger.debug("Ignoring frame 0x%02X from %s", int(frame_type), session.device_id)
