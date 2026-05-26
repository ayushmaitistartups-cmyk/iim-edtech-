"""Phase 5 persistence service — wraps blob + turns_repo writes.

Lives outside the orchestrator's hot path. The orchestrator fires
``persistence.commit_turn(...)`` as a background ``asyncio.create_task``;
this module handles blob uploads + ledger writes without ever blocking
the user-facing response.
"""

from __future__ import annotations

import asyncio
import logging
import time

from ..schemas import LlmReply
from ..storage import blobs, turns_repo


logger = logging.getLogger(__name__)


async def commit_turn(
    *,
    turn_id: str,
    device_id: str,
    user_id: str,
    asked_at: float,
    image_bytes: bytes,
    audio_pcm: bytes,
    reply: LlmReply,
    llm_model: str,
    ttft_ms: int | None = None,
    total_ms: int | None = None,
    issues: list[str] | None = None,
) -> None:
    """Persist the per-turn artefacts + analytics row. Best-effort."""
    issues = issues or []
    blob_store = blobs.get_blob_store()
    repo = turns_repo.get_turns_repo()

    audio_url: str | None = None
    image_url: str | None = None

    try:
        if audio_pcm:
            wav = blobs.pcm_to_wav_bytes(audio_pcm)
            audio_url = await blob_store.put(f"{device_id}/{turn_id}.wav", wav, "audio/wav")
        if image_bytes:
            image_url = await blob_store.put(f"{device_id}/{turn_id}.jpg", image_bytes, "image/jpeg")
    except Exception as exc:  # pragma: no cover
        logger.warning("persistence: blob upload failed for %s: %s", turn_id, exc)

    row = turns_repo.TurnRow(
        id=turn_id,
        device_id=device_id,
        user_id=user_id,
        asked_at=asked_at,
        ended_at=time.time(),
        audio_url=audio_url,
        image_url=image_url,
        response_text=reply.speech,
        display_kind=reply.display.kind,
        display_content=reply.display.content,
        llm_model=llm_model,
        ttft_ms=ttft_ms,
        total_ms=total_ms,
        is_confident=reply.is_confident,
        issues=issues,
    )

    try:
        await repo.write(row)
    except Exception as exc:  # pragma: no cover
        logger.warning("persistence: ledger write failed for %s: %s", turn_id, exc)
