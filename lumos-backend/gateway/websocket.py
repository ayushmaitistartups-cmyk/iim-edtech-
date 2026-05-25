"""``/lamp/ws`` — single persistent WebSocket per paired lamp.

Authenticates the device JWT, runs the binary-frame dispatch loop, and
emits Phase 0 stub responses. LLM/TTS/grounding orchestration is added
in Phases 1-4; this layer is intentionally transport-only.

Close codes (per ``update/changes/IMPLEMENTATION_WEBSOCKET.md``):
- 4401 — JWT signature invalid / malformed / missing (no retry)
- 4402 — JWT valid but device revoked or unlinked (no retry)
- 4426 — protocol upgrade required (no retry)
"""

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from gateway.auth import DeviceJwtError, verify_device_jwt
from gateway.pairing import get_device_registry
from gateway.session import LampSession, session_store
from schemas.frames import (
    DeviceState,
    FrameDecodeError,
    FrameType,
    decode_frame,
    encode_frame,
    state_payload,
)
from storage.devices import DeviceRegistry


logger = logging.getLogger(__name__)
router = APIRouter()

DEVICE_JWT_SECRET = os.getenv("DEVICE_JWT_SECRET", "dev-device-jwt-secret-change-me")

WS_CLOSE_AUTH_FAILED = 4401
WS_CLOSE_REVOKED = 4402


async def _send_frame(
    websocket: WebSocket,
    frame_type: int | FrameType,
    payload: bytes = b"",
) -> None:
    await websocket.send_bytes(encode_frame(frame_type, payload))


async def _send_state(websocket: WebSocket, state: DeviceState) -> None:
    await _send_frame(websocket, FrameType.STATE, state_payload(state))


def _verify_lamp_authorization(
    websocket: WebSocket,
    registry: DeviceRegistry,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Returns ``(claims, device)``. Raises ``DeviceJwtError`` for 4401 cases."""
    auth_header = websocket.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise DeviceJwtError("Missing device bearer token")
    token = auth_header[7:].strip()
    claims = verify_device_jwt(token, DEVICE_JWT_SECRET)
    device = registry.get_active_device_for_jwt(claims["sub"], claims["uid"])
    return claims, device  # device may be None — caller treats as 4402


async def _complete_phase0_turn(websocket: WebSocket, session: LampSession) -> None:
    """Phase 0 stub: ack the audio turn so the firmware path can be tested
    end-to-end before LLM/TTS providers are wired up (Phase 1+).
    """
    audio_bytes = len(session.audio_buffer)
    image_bytes = len(session.latest_frame) if session.latest_frame else 0
    logger.info(
        "Phase0 turn: device=%s audio_bytes=%d image_bytes=%d",
        session.device_id,
        audio_bytes,
        image_bytes,
    )

    await _send_state(websocket, DeviceState.THINKING)
    await _send_frame(
        websocket,
        FrameType.TFT_TEXT,
        b"Gateway is ready. LLM pipeline ships in Phase 1.",
    )
    await _send_frame(websocket, FrameType.AUDIO_OUT_END)
    await _send_state(websocket, DeviceState.IDLE)
    session.reset_turn()


@router.websocket("/lamp/ws")
async def lamp_websocket_endpoint(
    websocket: WebSocket,
    registry: DeviceRegistry = Depends(get_device_registry),
) -> None:
    await websocket.accept()

    # --- Auth verification ---
    try:
        claims, device = _verify_lamp_authorization(websocket, registry)
    except DeviceJwtError as exc:
        logger.warning("Lamp WS rejected (4401): %s", exc)
        try:
            await _send_state(websocket, DeviceState.AUTH_REVOKED)
        except Exception:
            pass
        await websocket.close(code=WS_CLOSE_AUTH_FAILED)
        return

    if device is None:
        logger.warning("Lamp WS rejected (4402): device revoked or unlinked sub=%s", claims.get("sub"))
        try:
            await _send_state(websocket, DeviceState.AUTH_REVOKED)
        except Exception:
            pass
        await websocket.close(code=WS_CLOSE_REVOKED)
        return

    device_id = claims["sub"]
    user_id = claims["uid"]
    session = LampSession(device_id=device_id, user_id=user_id, websocket=websocket)
    await session_store.attach(session)
    await _send_state(websocket, DeviceState.IDLE)
    logger.info("Lamp WS connected: device=%s user=%s", device_id, user_id)

    try:
        while True:
            message = await websocket.receive_bytes()
            try:
                frame = decode_frame(message)
            except FrameDecodeError as exc:
                logger.warning("Malformed lamp frame from %s: %s", device_id, exc)
                await _send_state(websocket, DeviceState.ERROR)
                continue

            if frame.frame_type == FrameType.PING:
                # 0xF1 PONG is empty per protocol spec.
                await _send_frame(websocket, FrameType.PONG)
            elif frame.frame_type == FrameType.IMAGE_JPEG:
                session.latest_frame = frame.payload
            elif frame.frame_type == FrameType.AUDIO_CHUNK:
                session.audio_buffer.extend(frame.payload)
            elif frame.frame_type == FrameType.AUDIO_END:
                await _complete_phase0_turn(websocket, session)
            elif frame.frame_type == FrameType.CANCEL:
                session.cancel_current()
                session.reset_turn()
                await _send_frame(websocket, FrameType.TFT_CLEAR)
                await _send_frame(websocket, FrameType.AUDIO_OUT_END)
                await _send_state(websocket, DeviceState.IDLE)
            else:
                logger.debug(
                    "Ignoring reserved lamp frame type 0x%02X from %s",
                    int(frame.frame_type),
                    device_id,
                )
    except WebSocketDisconnect:
        logger.info("Lamp WS disconnected: device=%s", device_id)
    finally:
        await session_store.detach(device_id, websocket)
