"""Per-lamp session state.

A ``Session`` owns a single ``WebSocket`` and the in-flight ``Turn``. It
buffers inbound IMAGE_PART/AUDIO_CHUNK frames, hands a fully-assembled turn
to the orchestrator on AUDIO_END, and cancels everything in flight on
CANCEL / disconnect.

Send helpers enforce the wire-format invariants from
``update/changes/IMPLEMENTATION_WEBSOCKET.md`` (notably the ≤4 KB outbound
WS frame cap, chunked TFT_FRAME).
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

from .config import settings
from .protocol import (
    DeviceState,
    FrameType,
    encode,
    state_payload,
)


logger = logging.getLogger(__name__)


def _new_turn_id() -> str:
    # Phase 5 will switch to uuid7 for time-sortable IDs; uuid4 is fine
    # for an in-process Redis key today.
    return uuid.uuid4().hex


@dataclass
class Turn:
    turn_id: str = field(default_factory=_new_turn_id)
    started_at: float = field(default_factory=time.monotonic)
    image_accum: bytearray = field(default_factory=bytearray)
    image_bytes: bytes = b""
    audio_pcm: bytearray = field(default_factory=bytearray)

    def audio_duration_s(self) -> float:
        return len(self.audio_pcm) / 2 / 16000  # int16 LE @ 16 kHz mono


class Session:
    """One paired lamp WebSocket. Phase 0 + Phase 1 surface."""

    def __init__(self, device_id: str, websocket, user_id: str = "dev-user"):
        self.device_id = device_id
        self.user_id = user_id
        self.ws = websocket
        self.turn: Turn = Turn()
        self.tasks: dict[str, asyncio.Task] = {}
        self._send_lock = asyncio.Lock()
        self._closed = False

    # ---- inbound dispatchers ----------------------------------------

    def append_image_part(self, payload: bytes) -> None:
        self.turn.image_accum.extend(payload)
        if len(self.turn.image_accum) > settings.image_max_bytes:
            raise ValueError("Image accumulator exceeded max size")

    def finalize_image(self, terminator_payload: bytes) -> None:
        """Called on FRAME_IMAGE_JPEG (0x01)."""
        if self.turn.image_accum:
            self.turn.image_accum.extend(terminator_payload)
            self.turn.image_bytes = bytes(self.turn.image_accum)
            self.turn.image_accum.clear()
        else:
            # Backward-compat single-message JPEG (small images).
            self.turn.image_bytes = bytes(terminator_payload)

    def append_audio(self, payload: bytes) -> None:
        if len(payload) % 2:
            logger.warning("device=%s audio chunk has odd length %d", self.device_id, len(payload))
        self.turn.audio_pcm.extend(payload)

    def snapshot_and_reset_turn(self) -> Turn:
        """Called on FRAME_AUDIO_END. The orchestrator owns the snapshot; the
        session immediately resets so the user can speak again."""
        snap = self.turn
        snap.audio_pcm = bytearray(snap.audio_pcm)  # detach
        self.turn = Turn()
        return snap

    def cancel_inflight(self) -> None:
        for name, task in list(self.tasks.items()):
            if not task.done():
                task.cancel()
            self.tasks.pop(name, None)

    def register_task(self, name: str, task: asyncio.Task) -> None:
        prior = self.tasks.pop(name, None)
        if prior and not prior.done():
            prior.cancel()
        self.tasks[name] = task

    # ---- outbound helpers -------------------------------------------

    async def _send_raw(self, frame_type: int | FrameType, payload: bytes = b"") -> None:
        if self._closed:
            return
        async with self._send_lock:
            await self.ws.send_bytes(encode(frame_type, payload))

    async def send_state(self, state: DeviceState) -> None:
        await self._send_raw(FrameType.STATE, state_payload(state))

    async def send_text(self, text: str) -> None:
        payload = text.encode("utf-8")[:200]  # lamp's screen cap
        await self._send_raw(FrameType.TFT_TEXT, payload)

    async def send_clear(self) -> None:
        await self._send_raw(FrameType.TFT_CLEAR)

    async def send_pong(self) -> None:
        await self._send_raw(FrameType.PONG)

    async def send_audio_chunk(self, pcm: bytes) -> None:
        await self._send_raw(FrameType.AUDIO_OUT, pcm)

    async def send_audio_end(self) -> None:
        await self._send_raw(FrameType.AUDIO_OUT_END)

    async def send_tft_frame_chunked(self, payload: bytes) -> None:
        """Split big TFT_FRAME payloads into TFT_PART chunks + a terminator
        TFT_FRAME, matching the lamp's WS RX heap budget (≤4 KB per message;
        we stay at 2 KB for safety). The lamp accumulates parts in PSRAM and
        commits on the terminator. Reference: BACKEND_TODO §6.2.
        """
        chunk_size = settings.ws_inbound_max_bytes
        n = len(payload)
        if n <= chunk_size:
            await self._send_raw(FrameType.TFT_FRAME, payload)
            return
        sent = 0
        while n - sent > chunk_size:
            await self._send_raw(FrameType.TFT_PART, payload[sent : sent + chunk_size])
            sent += chunk_size
        await self._send_raw(FrameType.TFT_FRAME, payload[sent:])

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.cancel_inflight()


class SessionStore:
    """One session per active lamp (keyed by ``device_id``)."""

    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock = asyncio.Lock()

    async def attach(self, session: Session) -> None:
        async with self._lock:
            existing = self._sessions.get(session.device_id)
            if existing:
                await existing.close()
            self._sessions[session.device_id] = session

    async def detach(self, device_id: str, websocket: object) -> None:
        async with self._lock:
            current = self._sessions.get(device_id)
            if current and current.ws is websocket:
                await current.close()
                self._sessions.pop(device_id, None)

    def get(self, device_id: str) -> Optional[Session]:
        return self._sessions.get(device_id)


session_store = SessionStore()
