"""End-to-end orchestrator tests using the Mock LLM + Mock TTS.

These exercise the same code path the WS gateway uses; the WS-level
test_websocket.py covers the on-the-wire side.
"""

import asyncio
import json
from dataclasses import dataclass
from typing import Any

import pytest

from app.protocol import DeviceState, FrameType, state_payload
from app.schemas import Display, LlmReply
from app.services import orchestrator


@dataclass
class _RecordingWS:
    """Stand-in for a Starlette WebSocket.send_bytes — just records every send."""

    sent: list[bytes]

    def __init__(self):
        self.sent = []

    async def send_bytes(self, data: bytes) -> None:
        self.sent.append(data)


def _decode_all(ws: _RecordingWS) -> list[tuple[int, bytes]]:
    from app.protocol import decode

    return [(int(decode(frame).frame_type), decode(frame).payload) for frame in ws.sent]


@pytest.mark.asyncio
async def test_full_turn_under_mocks():
    from app.session import Session

    ws = _RecordingWS()
    session = Session(device_id="dev-lamp", websocket=ws)

    # Force the orchestrator to re-pick providers (env may have changed).
    orchestrator.reset_providers_for_testing()

    image = b"\xFF\xD8\xFF\xE0" + b"\x00" * 64  # fake JPEG-ish bytes
    pcm = b"\x00\x00" * int(16000 * 1.0)  # 1 s of silence

    await orchestrator.run_turn(session, image, pcm)

    decoded = _decode_all(ws)
    types_sent = [t for t, _ in decoded]
    # We always emit at minimum: STATE(thinking), TFT_TEXT, STATE(speaking),
    # AUDIO_OUT*, AUDIO_OUT_END, STATE(idle).
    assert FrameType.STATE in types_sent
    assert FrameType.TFT_TEXT in types_sent
    assert FrameType.AUDIO_OUT in types_sent
    assert FrameType.AUDIO_OUT_END in types_sent
    # First STATE must be THINKING.
    first_state = next(p for t, p in decoded if t == FrameType.STATE)
    assert first_state == state_payload(DeviceState.THINKING)
    # Final STATE must be IDLE.
    last_state = [p for t, p in decoded if t == FrameType.STATE][-1]
    assert last_state == state_payload(DeviceState.IDLE)


@pytest.mark.asyncio
async def test_cancellation_during_tts_stops_cleanly():
    """If the session task is cancelled mid-turn, we must not hang."""
    from app.session import Session

    ws = _RecordingWS()
    session = Session(device_id="dev-lamp", websocket=ws)

    orchestrator.reset_providers_for_testing()

    pcm = b"\x00\x00" * int(16000 * 1.0)
    image = b"\xFF\xD8\xFF\xE0" + b"\x00" * 64
    task = asyncio.create_task(orchestrator.run_turn(session, image, pcm))
    # Cancel after a short delay to land mid-TTS.
    await asyncio.sleep(0.5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


def test_pydantic_reply_validation_round_trip():
    reply = LlmReply(speech="ok", display=Display(kind="latex", content=r"x^2"))
    raw = reply.model_dump_json()
    parsed = LlmReply.model_validate_json(raw)
    assert parsed.display.kind == "latex"
    assert parsed.display.content == r"x^2"
