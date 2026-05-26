"""Phase 6+ Gemini context cache manager — size gate + lifecycle."""

import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.providers import cache_manager
from app.providers.cache_manager import (
    DEFAULT_TTL_S,
    GeminiCacheManager,
    MIN_CACHEABLE_CHARS,
)


@pytest.fixture(autouse=True)
def _reset():
    cache_manager.reset_for_testing()
    yield
    cache_manager.reset_for_testing()


def test_small_content_is_rejected_without_calling_provider():
    assert GeminiCacheManager.is_large_enough("hello") is False


def test_large_content_passes_the_size_gate():
    big = "x" * MIN_CACHEABLE_CHARS
    assert GeminiCacheManager.is_large_enough(big) is True


@pytest.mark.asyncio
async def test_get_or_create_returns_none_for_small_prefix_without_calling_api():
    """The current SYSTEM_PROMPT (~700 tokens) is too small. The cache
    manager must NOT call the Gemini API in this case — that would 400."""
    fake_client = MagicMock()
    fake_client.aio = MagicMock()
    fake_client.aio.caches = MagicMock()
    fake_client.aio.caches.create = AsyncMock()
    mgr = GeminiCacheManager(fake_client, default_model="gemini-2.5-flash")
    name = await mgr.get_or_create_for_system_instruction(
        key="system_prompt",
        system_text="small system prompt of only a few hundred chars",
    )
    assert name is None
    fake_client.aio.caches.create.assert_not_called()


@pytest.mark.asyncio
async def test_get_or_create_calls_api_for_large_prefix_and_caches_name():
    fake_created = MagicMock()
    fake_created.name = "cachedContents/abc123"

    fake_client = MagicMock()
    fake_client.aio = MagicMock()
    fake_client.aio.caches = MagicMock()
    fake_client.aio.caches.create = AsyncMock(return_value=fake_created)

    mgr = GeminiCacheManager(fake_client, default_model="gemini-2.5-flash")
    big = "x" * MIN_CACHEABLE_CHARS

    # First call → creates the cache.
    name1 = await mgr.get_or_create_for_system_instruction(
        key="system_prompt", system_text=big
    )
    assert name1 == "cachedContents/abc123"
    fake_client.aio.caches.create.assert_called_once()

    # Second call within TTL → reuses the existing entry.
    name2 = await mgr.get_or_create_for_system_instruction(
        key="system_prompt", system_text=big
    )
    assert name2 == "cachedContents/abc123"
    # Still only called once.
    fake_client.aio.caches.create.assert_called_once()


@pytest.mark.asyncio
async def test_provider_failure_returns_none_so_caller_falls_back():
    fake_client = MagicMock()
    fake_client.aio = MagicMock()
    fake_client.aio.caches = MagicMock()
    fake_client.aio.caches.create = AsyncMock(side_effect=RuntimeError("simulated 503"))

    mgr = GeminiCacheManager(fake_client, default_model="gemini-2.5-flash")
    name = await mgr.get_or_create_for_system_instruction(
        key="system_prompt", system_text="x" * MIN_CACHEABLE_CHARS
    )
    assert name is None  # caller falls through to system_instruction path


@pytest.mark.asyncio
async def test_near_expiry_entries_are_refreshed_in_place():
    fake_a = MagicMock(); fake_a.name = "cachedContents/aaa"
    fake_b = MagicMock(); fake_b.name = "cachedContents/bbb"

    fake_client = MagicMock()
    fake_client.aio = MagicMock()
    fake_client.aio.caches = MagicMock()
    fake_client.aio.caches.create = AsyncMock(side_effect=[fake_a, fake_b])

    mgr = GeminiCacheManager(fake_client, default_model="gemini-2.5-flash")
    big = "x" * MIN_CACHEABLE_CHARS

    name1 = await mgr.get_or_create_for_system_instruction(
        key="system_prompt", system_text=big, ttl_s=120,
    )
    assert name1 == "cachedContents/aaa"

    # Fast-forward the entry's expiry into the past (faking time is simpler
    # than messing with the real monotonic clock).
    mgr._entries["system_prompt"].expires_at = time.monotonic() - 10

    name2 = await mgr.get_or_create_for_system_instruction(
        key="system_prompt", system_text=big, ttl_s=120,
    )
    assert name2 == "cachedContents/bbb"
    assert fake_client.aio.caches.create.call_count == 2


def test_default_ttl_matches_v3_plan_layer_1():
    # Reference: 02_WORKFLOW.md §3 "Layer 1 global cache (TTL 3600s)".
    assert DEFAULT_TTL_S == 3600
