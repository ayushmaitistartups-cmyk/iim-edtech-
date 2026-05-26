"""Async Redis client with an in-process fallback.

If ``REDIS_URL`` is set and ``redis-py`` is importable, we use the real
client. Otherwise we fall back to ``MemoryRedis`` so the gateway boots
without a Redis server — useful for tests + dev where you just need the
short-term history to round-trip.

The wrapper exposes the subset of Redis we actually use in Phase 2:
``lpush``, ``ltrim``, ``lrange``, ``expire``, ``set``, ``get``, ``delete``.
Phase 4+ will extend with ``zadd`` / ``zrange`` if we end up needing it.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Iterable, Optional


logger = logging.getLogger(__name__)


class MemoryRedis:
    """Tiny in-process stand-in for ``redis.asyncio.Redis``.

    Implements only what Phase 2 needs. TTLs are honoured (lazy: stale keys
    are evicted on read). Not thread-safe across event loops — fine for
    asyncio single-loop use.
    """

    def __init__(self) -> None:
        self._lists: dict[str, list[bytes]] = {}
        self._strings: dict[str, bytes] = {}
        self._expires_at: dict[str, float] = {}
        self._lock = asyncio.Lock()

    def _now(self) -> float:
        return time.monotonic()

    def _expire_if_stale(self, key: str) -> None:
        exp = self._expires_at.get(key)
        if exp is not None and exp <= self._now():
            self._lists.pop(key, None)
            self._strings.pop(key, None)
            self._expires_at.pop(key, None)

    async def lpush(self, key: str, *values: bytes | str) -> int:
        async with self._lock:
            self._expire_if_stale(key)
            lst = self._lists.setdefault(key, [])
            for v in values:
                lst.insert(0, v.encode() if isinstance(v, str) else v)
            return len(lst)

    async def ltrim(self, key: str, start: int, stop: int) -> bool:
        async with self._lock:
            self._expire_if_stale(key)
            lst = self._lists.get(key, [])
            # Mirror Redis: positive index inclusive, negative from the tail.
            length = len(lst)
            s = start if start >= 0 else max(0, length + start)
            e = stop if stop >= 0 else length + stop
            self._lists[key] = lst[s : e + 1]
            return True

    async def lrange(self, key: str, start: int, stop: int) -> list[bytes]:
        async with self._lock:
            self._expire_if_stale(key)
            lst = self._lists.get(key, [])
            length = len(lst)
            s = start if start >= 0 else max(0, length + start)
            e = stop if stop >= 0 else length + stop
            return list(lst[s : e + 1])

    async def expire(self, key: str, seconds: int) -> bool:
        async with self._lock:
            if key in self._lists or key in self._strings:
                self._expires_at[key] = self._now() + seconds
                return True
            return False

    async def set(self, key: str, value: bytes | str, ex: int | None = None) -> bool:
        async with self._lock:
            self._strings[key] = value.encode() if isinstance(value, str) else value
            if ex is not None:
                self._expires_at[key] = self._now() + ex
            return True

    async def get(self, key: str) -> bytes | None:
        async with self._lock:
            self._expire_if_stale(key)
            return self._strings.get(key)

    async def delete(self, *keys: str) -> int:
        async with self._lock:
            n = 0
            for k in keys:
                if k in self._lists:
                    self._lists.pop(k, None)
                    n += 1
                if k in self._strings:
                    self._strings.pop(k, None)
                    n += 1
                self._expires_at.pop(k, None)
            return n

    async def close(self) -> None:
        return None


_client: Optional[object] = None


def get_redis():
    """Return the singleton Redis client. Real client when ``REDIS_URL`` is
    set and ``redis-py`` is installed, else ``MemoryRedis``."""
    global _client
    if _client is not None:
        return _client

    url = os.getenv("REDIS_URL")
    if not url:
        logger.info("REDIS_URL unset — using in-process MemoryRedis")
        _client = MemoryRedis()
        return _client

    try:
        import redis.asyncio as aioredis  # type: ignore[import-not-found]
    except ImportError:
        logger.warning("redis-py not installed; falling back to MemoryRedis")
        _client = MemoryRedis()
        return _client

    _client = aioredis.from_url(url, encoding=None, decode_responses=False)
    logger.info("Redis client connected to %s", url.split("@")[-1])
    return _client


def reset_for_testing() -> None:
    """Drop the singleton so tests can swap clients between cases."""
    global _client
    _client = None
