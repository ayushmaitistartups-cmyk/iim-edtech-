"""Gemini explicit context cache lifecycle.

Gemini bills cached prefix tokens at **25 % of normal cost**. The catch:
the API requires the cached content to be at least **32,768 tokens** —
roughly ~25 KB of plain text. The current SYSTEM_PROMPT is ~700 tokens,
so it's far below the threshold and trying to cache it would 400.

This module ships the *machinery* (lifecycle, TTL refresh, fallback to
no-cache) so the day we cross the threshold — adding a textbook prefix,
a long student profile, or a giant rule book — we flip a flag and it
works. Until then, ``get_cache_for_system_instruction()`` returns
``None`` and the LLM call proceeds without cached prefix.

Gemini also performs **implicit prefix caching** automatically when you
send identical leading content across calls. That happens silently in
the SDK and gives ~50 % discount on the cached portion — no code change
needed for that benefit. The explicit cache below is the *additional*
gain you only get for very large prefixes.

References:
- https://ai.google.dev/gemini-api/docs/caching
- ``update/changes/01_MASTER_PLAN.md`` row "Context caching"
- ``update/changes/02_WORKFLOW.md`` §3 "Gemini Context Cache Lifecycle"
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional


logger = logging.getLogger(__name__)


# Gemini's documented minimum for explicit caching. Below this the API
# returns 400. Tokens ≈ chars/4 for English; using chars is a conservative
# floor so we never even attempt a too-small cache.
MIN_CACHEABLE_TOKENS = 32_768
MIN_CACHEABLE_CHARS = MIN_CACHEABLE_TOKENS * 4   # ~131 K chars

# Default TTL for the system-prompt cache. Long-lived because the prompt
# barely changes between deploys. Matches the v3 plan's "Layer 1" 3600 s.
DEFAULT_TTL_S = 3600


@dataclass
class CacheEntry:
    name: str           # Gemini resource name, e.g. "cachedContents/abc123"
    expires_at: float   # monotonic time
    chars: int          # length of source text — telemetry only


class GeminiCacheManager:
    """Owns the Gemini cached-content lifecycle for a single client.

    Keys are arbitrary strings (e.g. ``"system_prompt"``, ``"profile:user_123"``)
    so callers can stage multiple caches if needed.
    """

    def __init__(self, client, *, default_model: str):
        self._client = client
        self._default_model = default_model
        self._entries: dict[str, CacheEntry] = {}

    @staticmethod
    def is_large_enough(text: str) -> bool:
        return len(text) >= MIN_CACHEABLE_CHARS

    async def get_or_create_for_system_instruction(
        self,
        *,
        key: str,
        system_text: str,
        model: str | None = None,
        ttl_s: int = DEFAULT_TTL_S,
    ) -> Optional[str]:
        """Return a ``cachedContents/...`` name if Gemini will accept this
        text as a cache, else ``None``. Refreshes near-expiry caches in
        place. Never raises — falls back to None on any failure."""
        if not self.is_large_enough(system_text):
            return None

        now = time.monotonic()
        entry = self._entries.get(key)
        if entry and entry.expires_at - now > 60:  # >1 min headroom
            return entry.name

        # Either no entry or about to expire → create a fresh one.
        try:
            from google.genai import types

            cfg = types.CreateCachedContentConfig(
                system_instruction=system_text,
                ttl=f"{ttl_s}s",
            )
            created = await self._client.aio.caches.create(
                model=model or self._default_model,
                config=cfg,
            )
            name = created.name
            self._entries[key] = CacheEntry(
                name=name,
                expires_at=now + ttl_s,
                chars=len(system_text),
            )
            logger.info(
                "Gemini cache created: key=%s name=%s chars=%d ttl=%ds",
                key,
                name,
                len(system_text),
                ttl_s,
            )
            return name
        except Exception as exc:  # pragma: no cover — network / quota / size
            logger.warning("Gemini cache create failed for %s: %s", key, exc)
            return None

    async def delete(self, key: str) -> None:
        entry = self._entries.pop(key, None)
        if not entry:
            return
        try:
            await self._client.aio.caches.delete(name=entry.name)
        except Exception as exc:  # pragma: no cover
            logger.warning("Gemini cache delete failed for %s: %s", key, exc)

    def has(self, key: str) -> bool:
        entry = self._entries.get(key)
        return entry is not None and entry.expires_at > time.monotonic()

    def stats(self) -> dict:
        return {
            "tracked": len(self._entries),
            "keys": list(self._entries.keys()),
        }


_manager: Optional[GeminiCacheManager] = None


def get_cache_manager_for(client, model: str) -> GeminiCacheManager:
    global _manager
    if _manager is None or _manager._client is not client:
        _manager = GeminiCacheManager(client, default_model=model)
    return _manager


def reset_for_testing() -> None:
    global _manager
    _manager = None
