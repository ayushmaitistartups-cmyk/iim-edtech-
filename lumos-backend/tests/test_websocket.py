"""End-to-end WebSocket tests for /lamp/ws.

Covers:
- valid JWT → connection accepted, STATE(idle) emitted on accept
- bad/missing JWT → close 4401
- valid JWT signature but device revoked → close 4402
- PING → PONG round-trip
- AUDIO_END → AUDIO_OUT_END + STATE(idle)
- CANCEL → TFT_CLEAR + AUDIO_OUT_END + STATE(idle)
"""

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

# conftest.py has set DEVICE_JWT_SECRET; import after to ensure module-level reads it.
DEVICE_JWT_SECRET = os.environ["DEVICE_JWT_SECRET"]

from gateway.auth import create_device_jwt  # noqa: E402
from schemas.frames import (  # noqa: E402
    DeviceState,
    FrameType,
    decode_frame,
    encode_frame,
    state_payload,
)
from storage.devices import DeviceRegistry  # noqa: E402


def _build_app(registry: DeviceRegistry):
    """Construct the FastAPI app with a registry override per test."""
    from fastapi import FastAPI

    from gateway import pairing as pairing_module
    from gateway import websocket as websocket_module

    app = FastAPI()
    app.dependency_overrides[pairing_module.get_device_registry] = lambda: registry
    app.include_router(pairing_module.router)
    app.include_router(websocket_module.router)
    return app


def _pair_device(registry: DeviceRegistry, *, device_id="lamp-TEST01", user_id="user_test") -> str:
    """Register + complete pairing → return signed device_jwt."""
    registered = registry.register_device(device_id, "lamp-secret-1234", "https://app.test.local")
    registry.complete_pairing(
        pairing_code=registered["pairing_code"],
        user_id=user_id,
        signing_secret=DEVICE_JWT_SECRET,
    )
    poll = registry.poll_pairing(device_id, "lamp-secret-1234", registered["pairing_code"])
    assert poll["status"] == "paired"
    return poll["device_jwt"]


def _receive_state(ws) -> int:
    frame = decode_frame(ws.receive_bytes())
    assert frame.frame_type == FrameType.STATE, f"expected STATE, got 0x{int(frame.frame_type):02X}"
    return frame.payload[0]


def test_valid_jwt_accepted_and_sends_idle_state(tmp_path):
    registry = DeviceRegistry(tmp_path / "devices.json")
    jwt = _pair_device(registry)
    app = _build_app(registry)
    client = TestClient(app)

    with client.websocket_connect("/lamp/ws", headers={"Authorization": f"Bearer {jwt}"}) as ws:
        assert _receive_state(ws) == DeviceState.IDLE


def _expect_close(ws, expected_code: int) -> None:
    """The server emits STATE(AUTH_REVOKED) just before close; drain frames
    until WebSocketDisconnect fires, then assert the close code."""
    with pytest.raises(WebSocketDisconnect) as excinfo:
        while True:
            ws.receive_bytes()
    assert excinfo.value.code == expected_code, (
        f"expected close code {expected_code}, got {excinfo.value.code}"
    )


def test_missing_jwt_is_rejected_with_4401(tmp_path):
    registry = DeviceRegistry(tmp_path / "devices.json")
    app = _build_app(registry)
    client = TestClient(app)

    with client.websocket_connect("/lamp/ws") as ws:
        _expect_close(ws, 4401)


def test_tampered_jwt_is_rejected_with_4401(tmp_path):
    registry = DeviceRegistry(tmp_path / "devices.json")
    _pair_device(registry)
    app = _build_app(registry)
    client = TestClient(app)

    bad_jwt = create_device_jwt(
        device_id="lamp-TEST01",
        user_id="user_test",
        signing_secret="wrong-secret",
    )

    with client.websocket_connect(
        "/lamp/ws", headers={"Authorization": f"Bearer {bad_jwt}"}
    ) as ws:
        _expect_close(ws, 4401)


def test_revoked_device_is_rejected_with_4402(tmp_path):
    registry = DeviceRegistry(tmp_path / "devices.json")
    jwt = _pair_device(registry)
    registry.unlink_device("lamp-TEST01", "user_test")
    app = _build_app(registry)
    client = TestClient(app)

    with client.websocket_connect(
        "/lamp/ws", headers={"Authorization": f"Bearer {jwt}"}
    ) as ws:
        _expect_close(ws, 4402)


def test_ping_triggers_pong_round_trip(tmp_path):
    registry = DeviceRegistry(tmp_path / "devices.json")
    jwt = _pair_device(registry)
    app = _build_app(registry)
    client = TestClient(app)

    with client.websocket_connect("/lamp/ws", headers={"Authorization": f"Bearer {jwt}"}) as ws:
        _receive_state(ws)  # initial IDLE
        ws.send_bytes(encode_frame(FrameType.PING))
        reply = decode_frame(ws.receive_bytes())
        assert reply.frame_type == FrameType.PONG
        assert reply.payload == b""


def test_audio_end_triggers_phase0_stub_response(tmp_path):
    registry = DeviceRegistry(tmp_path / "devices.json")
    jwt = _pair_device(registry)
    app = _build_app(registry)
    client = TestClient(app)

    with client.websocket_connect("/lamp/ws", headers={"Authorization": f"Bearer {jwt}"}) as ws:
        assert _receive_state(ws) == DeviceState.IDLE
        ws.send_bytes(encode_frame(FrameType.AUDIO_END))

        # Expect: STATE(thinking) → TFT_TEXT → AUDIO_OUT_END → STATE(idle)
        assert decode_frame(ws.receive_bytes()).payload == state_payload(DeviceState.THINKING)
        assert decode_frame(ws.receive_bytes()).frame_type == FrameType.TFT_TEXT
        assert decode_frame(ws.receive_bytes()).frame_type == FrameType.AUDIO_OUT_END
        assert decode_frame(ws.receive_bytes()).payload == state_payload(DeviceState.IDLE)


def test_cancel_clears_state_and_returns_idle(tmp_path):
    registry = DeviceRegistry(tmp_path / "devices.json")
    jwt = _pair_device(registry)
    app = _build_app(registry)
    client = TestClient(app)

    with client.websocket_connect("/lamp/ws", headers={"Authorization": f"Bearer {jwt}"}) as ws:
        assert _receive_state(ws) == DeviceState.IDLE
        ws.send_bytes(encode_frame(FrameType.CANCEL))

        assert decode_frame(ws.receive_bytes()).frame_type == FrameType.TFT_CLEAR
        assert decode_frame(ws.receive_bytes()).frame_type == FrameType.AUDIO_OUT_END
        assert decode_frame(ws.receive_bytes()).payload == state_payload(DeviceState.IDLE)
