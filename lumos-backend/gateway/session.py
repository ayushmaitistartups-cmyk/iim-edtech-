"""In-memory session state for active lamp connections.

A session is created when a lamp opens ``/lamp/ws`` and torn down on
disconnect. Later phases will move the per-turn payloads (image, audio)
into Redis; for Phase 0 we hold them in process memory only.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class LampSession:
    device_id: str
    user_id: str
    websocket: object  # FastAPI WebSocket; typed loosely to avoid coupling at this layer
    latest_frame: Optional[bytes] = None
    audio_buffer: bytearray = field(default_factory=bytearray)
    current_task: Optional[asyncio.Task] = None

    def reset_turn(self) -> None:
        self.audio_buffer = bytearray()
        self.latest_frame = None

    def cancel_current(self) -> None:
        if self.current_task and not self.current_task.done():
            self.current_task.cancel()
        self.current_task = None


class SessionStore:
    """One session per active lamp (keyed by device_id)."""

    def __init__(self) -> None:
        self._sessions: dict[str, LampSession] = {}
        self._lock = asyncio.Lock()

    async def attach(self, session: LampSession) -> None:
        async with self._lock:
            existing = self._sessions.get(session.device_id)
            if existing:
                existing.cancel_current()
            self._sessions[session.device_id] = session

    async def detach(self, device_id: str, websocket: object) -> None:
        async with self._lock:
            current = self._sessions.get(device_id)
            if current and current.websocket is websocket:
                current.cancel_current()
                self._sessions.pop(device_id, None)

    def get(self, device_id: str) -> Optional[LampSession]:
        return self._sessions.get(device_id)


session_store = SessionStore()
