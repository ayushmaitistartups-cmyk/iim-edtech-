"""Turn ledger — one row per LLM turn for analytics + audit + cost tracking.

Mirrors the Postgres schema in ``BACKEND_DESIGN §4.7``:

    turns(id, device_id, user_id, asked_at, ended_at,
          audio_url, image_url, response_text, display_kind, display_content,
          llm_model, llm_input_tokens, llm_output_tokens,
          ttft_ms, total_ms, cost_usd, is_confident)

Phase 5 ships an async file-backed JSONL writer so the audit ledger works
without Postgres. Phase 5+ (or a follow-up) swaps the backend for
``sqlalchemy[asyncio] + asyncpg`` without changing the call sites.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

from ..config import settings


logger = logging.getLogger(__name__)

DATA_DIR = Path(settings.device_store_path).parent / "turns"


@dataclass
class TurnRow:
    id: str
    device_id: str
    user_id: str
    asked_at: float
    ended_at: Optional[float] = None
    audio_url: Optional[str] = None
    image_url: Optional[str] = None
    response_text: Optional[str] = None
    display_kind: Optional[str] = None
    display_content: Optional[str] = None
    llm_model: Optional[str] = None
    llm_input_tokens: Optional[int] = None
    llm_output_tokens: Optional[int] = None
    ttft_ms: Optional[int] = None
    total_ms: Optional[int] = None
    cost_usd: Optional[float] = None
    is_confident: Optional[float] = None
    issues: list[str] = field(default_factory=list)


class FileTurnsRepo:
    """JSONL ledger under ``DATA_DIR``. One file per device for fast tailing."""

    name = "file"

    def __init__(self, root: Path = DATA_DIR):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()

    def _path(self, device_id: str) -> Path:
        safe = "".join(c for c in device_id if c.isalnum() or c in "-_") or "anon"
        return self.root / f"{safe}.jsonl"

    async def write(self, row: TurnRow) -> None:
        async with self._lock:
            line = json.dumps(asdict(row), default=str)
            path = self._path(row.device_id)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _append_line, path, line)

    async def read_latest(self, device_id: str, limit: int = 20) -> list[TurnRow]:
        path = self._path(device_id)
        if not path.exists():
            return []
        loop = asyncio.get_event_loop()
        lines = await loop.run_in_executor(None, _read_tail, path, limit)
        out: list[TurnRow] = []
        for line in lines:
            try:
                rec = json.loads(line)
                out.append(TurnRow(**rec))
            except Exception:
                continue
        return out


def _append_line(path: Path, line: str) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def _read_tail(path: Path, limit: int) -> list[str]:
    # Cheap: read whole file (we expect ≤ a few MB per device for a long
    # time). The real Postgres impl will swap to LIMIT-OFFSET queries.
    text = path.read_text(encoding="utf-8")
    return [l for l in text.splitlines()[-limit:] if l]


_repo: FileTurnsRepo | None = None


def get_turns_repo() -> FileTurnsRepo:
    global _repo
    if _repo is None:
        _repo = FileTurnsRepo()
    return _repo


def reset_for_testing(root: Path | None = None) -> None:
    global _repo
    _repo = FileTurnsRepo(root=root) if root else None


def new_turn_id() -> str:
    """uuidv7-shaped time-sortable hex id (millisecond ts + 8 random bytes)."""
    import os
    import struct

    ms = int(time.time() * 1000) & 0xFFFFFFFFFFFF
    rand = os.urandom(8)
    return f"{ms:012x}-{rand.hex()}"
