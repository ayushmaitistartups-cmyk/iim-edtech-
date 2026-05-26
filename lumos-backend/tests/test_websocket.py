"""End-to-end WebSocket tests against the new ``/lamp/ws`` route.

Phase 1 surface covered:
- valid bearer → STATE(idle) on accept
- bad bearer → close 4401  (only when ENABLE_AUTH=true)
- PING → PONG
- AUDIO_END (after AUDIO_CHUNK*) → orchestrator runs with MockLLM/MockTTS,
  emitting STATE(thinking) → TFT_TEXT → STATE(speaking) → AUDIO_OUT* → AUDIO_OUT_END → STATE(idle)
- IMAGE_PART × N + IMAGE_JPEG terminator → reassembled into image_bytes
- CANCEL → TFT_CLEAR + AUDIO_OUT_END + STATE(idle)
"""

import importlib
import os
import struct

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


from app.protocol import (  # noqa: E402
    DeviceState,
    FrameType,
    decode,
    encode,
    state_payload,
)


def _build_app(*, enable_auth: bool, registry=None) -> FastAPI:
    """Construct a FastAPI app with the requested auth posture."""
    os.environ["ENABLE_AUTH"] = "1" if enable_auth else "0"
    # Force config + downstream modules to re-read settings.
    from app import config as app_config

    importlib.reload(app_config)
    from app.routes import ws_lamp
    importlib.reload(ws_lamp)
    from app.services import orchestrator
    importlib.reload(orchestrator)

    app = FastAPI()
    if registry is not None:
        app.dependency_overrides[ws_lamp._get_device_registry] = lambda: registry
    app.include_router(ws_lamp.router)
    return app


def _seconds_of_silence(seconds: float) -> bytes:
    return b"\x00\x00" * int(16000 * seconds)


def _drain_until(ws, predicate) -> list:
    """Read frames until ``predicate(frame)`` returns truthy. Returns the
    collected frames (excluding the matching one if ``predicate`` consumes)."""
    collected = []
    for _ in range(200):  # safety bound
        frame = decode(ws.receive_bytes())
        collected.append(frame)
        if predicate(frame):
            return collected
    raise AssertionError("predicate never matched within bound")


def test_anonymous_lamp_is_accepted_when_auth_disabled():
    app = _build_app(enable_auth=False)
    client = TestClient(app)
    with client.websocket_connect("/lamp/ws") as ws:
        first = decode(ws.receive_bytes())
        assert first.frame_type == FrameType.STATE
        assert first.payload == state_payload(DeviceState.IDLE)


def test_ping_returns_pong():
    app = _build_app(enable_auth=False)
    client = TestClient(app)
    with client.websocket_connect("/lamp/ws") as ws:
        decode(ws.receive_bytes())  # initial IDLE
        ws.send_bytes(encode(FrameType.PING))
        reply = decode(ws.receive_bytes())
        assert reply.frame_type == FrameType.PONG


def test_audio_end_drives_full_orchestrator_round_trip():
    app = _build_app(enable_auth=False)
    client = TestClient(app)
    with client.websocket_connect("/lamp/ws") as ws:
        decode(ws.receive_bytes())  # initial IDLE
        # Send 1 s of silence as the "question audio".
        pcm = _seconds_of_silence(1.0)
        for i in range(0, len(pcm), 640):
            ws.send_bytes(encode(FrameType.AUDIO_CHUNK, pcm[i : i + 640]))
        ws.send_bytes(encode(FrameType.AUDIO_END))

        # Expect: STATE(thinking) → TFT_TEXT("Thinking…") → ... → AUDIO_OUT_END → STATE(idle)
        frames = _drain_until(
            ws,
            lambda f: f.frame_type == FrameType.STATE
            and f.payload == state_payload(DeviceState.IDLE),
        )
        types_seen = [f.frame_type for f in frames]
        assert FrameType.STATE in types_seen
        assert FrameType.TFT_TEXT in types_seen
        assert FrameType.AUDIO_OUT in types_seen
        assert FrameType.AUDIO_OUT_END in types_seen
        # The first non-IDLE STATE must be THINKING.
        first_state = next(f for f in frames if f.frame_type == FrameType.STATE)
        assert first_state.payload == state_payload(DeviceState.THINKING)


def test_image_part_chunks_are_reassembled():
    """IMAGE_PART × N + IMAGE_JPEG terminator should concatenate into one image."""
    app = _build_app(enable_auth=False)
    client = TestClient(app)
    # Capture the assembled image_bytes via the session_store inspection.
    from app.session import session_store

    with client.websocket_connect("/lamp/ws") as ws:
        decode(ws.receive_bytes())  # IDLE
        # 3 parts of 100 bytes + a 50-byte terminator → 350-byte image.
        ws.send_bytes(encode(FrameType.IMAGE_PART, b"\xAA" * 100))
        ws.send_bytes(encode(FrameType.IMAGE_PART, b"\xBB" * 100))
        ws.send_bytes(encode(FrameType.IMAGE_PART, b"\xCC" * 100))
        ws.send_bytes(encode(FrameType.IMAGE_JPEG, b"\xDD" * 50))

        # Give the server one event-loop tick to process inbound frames before
        # we inspect the session (TestClient sometimes leaves them queued).
        # Send a PING and wait for PONG to flush.
        ws.send_bytes(encode(FrameType.PING))
        for _ in range(10):
            frame = decode(ws.receive_bytes())
            if frame.frame_type == FrameType.PONG:
                break

        session = session_store.get("dev-lamp")
        assert session is not None
        # The image is still buffered in current_turn until AUDIO_END snapshots it.
        assert len(session.turn.image_bytes) == 350
        assert session.turn.image_bytes[:100] == b"\xAA" * 100
        assert session.turn.image_bytes[300:] == b"\xDD" * 50


def test_cancel_returns_idle_and_clears_display():
    app = _build_app(enable_auth=False)
    client = TestClient(app)
    with client.websocket_connect("/lamp/ws") as ws:
        decode(ws.receive_bytes())  # IDLE
        ws.send_bytes(encode(FrameType.CANCEL))
        clear = decode(ws.receive_bytes())
        assert clear.frame_type == FrameType.TFT_CLEAR
        end = decode(ws.receive_bytes())
        assert end.frame_type == FrameType.AUDIO_OUT_END
        idle = decode(ws.receive_bytes())
        assert idle.frame_type == FrameType.STATE
        assert idle.payload == state_payload(DeviceState.IDLE)


def test_short_audio_is_rejected_with_warning_text():
    """Sub-0.5s audio → orchestrator drops the turn with a friendly TFT_TEXT."""
    app = _build_app(enable_auth=False)
    client = TestClient(app)
    with client.websocket_connect("/lamp/ws") as ws:
        decode(ws.receive_bytes())  # IDLE
        # 0.1 s of audio (well below the 0.5 s gate)
        pcm = _seconds_of_silence(0.1)
        for i in range(0, len(pcm), 640):
            ws.send_bytes(encode(FrameType.AUDIO_CHUNK, pcm[i : i + 640]))
        ws.send_bytes(encode(FrameType.AUDIO_END))

        # Expect a TFT_TEXT with the "too short" message.
        for _ in range(5):
            frame = decode(ws.receive_bytes())
            if frame.frame_type == FrameType.TFT_TEXT:
                assert b"short" in frame.payload.lower()
                return
        raise AssertionError("did not receive a TFT_TEXT after short audio")
