"""Short-term conversation memory — last N turns per lamp.

Phase 2 scope (per ``BACKEND_TODO §3.2``): keep the last 3 turns of *text*
in a Redis list, prepend them to every LLM call as a single plaintext block.
Long-term pgvector memory arrives in Phase 4.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from ..storage.redis_client import get_redis


logger = logging.getLogger(__name__)


HISTORY_TTL_S = 24 * 60 * 60      # 24 h — matches BACKEND_TODO §3.2.
HISTORY_KEEP = 3                  # last N turns retained per lamp.


def _key(device_id: str) -> str:
    return f"lamp:hist:{device_id}"


@dataclass(frozen=True)
class TurnRecord:
    speech: str
    display_kind: str  # "latex" | "text" | "none"

    def to_blob(self) -> bytes:
        return json.dumps({"s": self.speech, "k": self.display_kind}).encode("utf-8")

    @staticmethod
    def from_blob(blob: bytes) -> "TurnRecord":
        raw = json.loads(blob.decode("utf-8"))
        return TurnRecord(speech=raw.get("s", ""), display_kind=raw.get("k", "none"))


async def record_turn(device_id: str, speech: str, display_kind: str) -> None:
    """Push a turn onto the head of the device's list and cap to ``HISTORY_KEEP``.

    Best-effort: a Redis hiccup must never break the live response path —
    so we swallow everything and log.
    """
    try:
        client = get_redis()
        key = _key(device_id)
        record = TurnRecord(speech=speech, display_kind=display_kind)
        await client.lpush(key, record.to_blob())
        await client.ltrim(key, 0, HISTORY_KEEP - 1)
        await client.expire(key, HISTORY_TTL_S)
    except Exception as exc:  # pragma: no cover — Redis outage
        logger.warning("memory.record_turn failed for %s: %s", device_id, exc)


async def get_recent_turns(device_id: str) -> list[TurnRecord]:
    """Return up to ``HISTORY_KEEP`` recent turns (newest first)."""
    try:
        client = get_redis()
        blobs = await client.lrange(_key(device_id), 0, HISTORY_KEEP - 1)
        return [TurnRecord.from_blob(b) for b in blobs]
    except Exception as exc:  # pragma: no cover
        logger.warning("memory.get_recent_turns failed for %s: %s", device_id, exc)
        return []


def render_history_for_prompt(turns: list[TurnRecord]) -> str:
    """Format history as the plaintext block prepended to the LLM call.

    Newest turn appears at the bottom (chronological order so the model
    reads from oldest to newest). Empty list → empty string.
    """
    if not turns:
        return ""
    # ``turns`` from Redis is newest-first; reverse for chronological prompt.
    lines = ["Recent conversation with this learner (oldest first):"]
    for t in reversed(turns):
        lines.append(f"- You said: \"{t.speech}\" (display: {t.display_kind})")
    lines.append("Use this as light context only; the new audio/image is the question to answer now.\n")
    return "\n".join(lines)


async def clear_history(device_id: str) -> None:
    """Wipe the device's history. Used by tests + a future ``DELETE /api/devices/{id}/history`` route."""
    try:
        client = get_redis()
        await client.delete(_key(device_id))
    except Exception as exc:  # pragma: no cover
        logger.warning("memory.clear_history failed for %s: %s", device_id, exc)
