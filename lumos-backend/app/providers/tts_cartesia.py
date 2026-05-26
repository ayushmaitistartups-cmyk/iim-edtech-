"""Cartesia Sonic streaming TTS, re-chunked for the lamp's I2S ring.

The wire contract is precise:
- Each WS ``AUDIO_OUT`` frame carries **exactly** ``settings.tts_chunk_bytes``
  (4 KB = 2048 int16 samples = 85.3 ms playback @ 24 kHz mono).
- The backend paces sends at ``settings.tts_chunk_pace_s`` (85 ms). This
  matches the lamp's I2S drain rate; sending faster overflows its 64 KB
  ring buffer (see ``BACKEND_TODO.md §7.3`` + ``dummy_backend.py:_respond``).

When ``CARTESIA_API_KEY`` is unset we fall back to ``MockTTS`` that emits
silence at the same shape — enough for end-to-end orchestrator tests.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from ..config import settings


logger = logging.getLogger(__name__)


class TTSError(RuntimeError):
    pass


def _rechunk(stream: AsyncIterator[bytes], chunk_bytes: int) -> AsyncIterator[bytes]:
    """Re-buffer an arbitrary-sized inbound byte stream into fixed-size
    output chunks. Trailing bytes < chunk_bytes are flushed on stream end.
    """

    async def _gen() -> AsyncIterator[bytes]:
        buf = bytearray()
        async for piece in stream:
            buf.extend(piece)
            while len(buf) >= chunk_bytes:
                yield bytes(buf[:chunk_bytes])
                del buf[:chunk_bytes]
        if buf:
            # Zero-pad the tail to a full chunk so the speaker drains cleanly.
            buf.extend(b"\x00" * (chunk_bytes - len(buf)))
            yield bytes(buf)

    return _gen()


async def _paced(stream: AsyncIterator[bytes], pace_s: float) -> AsyncIterator[bytes]:
    """Yield each chunk at ``pace_s`` cadence. The first chunk goes out
    immediately so TTFT stays low; subsequent chunks wait."""
    first = True
    async for chunk in stream:
        if first:
            first = False
        else:
            await asyncio.sleep(pace_s)
        yield chunk


class CartesiaTTS:
    """Streaming TTS client. Output is 24 kHz mono int16 LE PCM."""

    def __init__(self, api_key: str, voice_id: str | None = None):
        from cartesia import Cartesia  # lazy import

        self._client = Cartesia(api_key=api_key)
        self._voice_id = voice_id

    @property
    def name(self) -> str:
        return "cartesia:sonic-2"

    async def _provider_stream(self, text: str) -> AsyncIterator[bytes]:
        # The Cartesia SDK exposes a sync iterator over the byte stream.
        # We bridge it into asyncio via run_in_executor.
        loop = asyncio.get_event_loop()
        stream_iter = await loop.run_in_executor(
            None,
            lambda: self._client.tts.bytes(
                model_id="sonic-2",
                transcript=text,
                voice={"mode": "id", "id": self._voice_id} if self._voice_id else None,
                output_format={
                    "container": "raw",
                    "encoding": "pcm_s16le",
                    "sample_rate": 24000,
                },
            ),
        )

        def _next():
            try:
                return next(stream_iter)
            except StopIteration:
                return None

        while True:
            chunk = await loop.run_in_executor(None, _next)
            if chunk is None:
                return
            yield chunk

    async def stream(self, text: str) -> AsyncIterator[bytes]:
        try:
            raw = self._provider_stream(text)
            rechunked = _rechunk(raw, settings.tts_chunk_bytes)
            paced = _paced(rechunked, settings.tts_chunk_pace_s)
            async for chunk in paced:
                yield chunk
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover
            raise TTSError(f"Cartesia stream failed: {exc}") from exc


class MockTTS:
    """Silence generator. Same chunk size + pacing as the real provider."""

    @property
    def name(self) -> str:
        return "mock-tts"

    async def stream(self, text: str) -> AsyncIterator[bytes]:
        # Approximate a 60-word speech at 150 wpm = 24 s of audio.
        seconds = max(0.5, min(24.0, len(text.split()) * 0.4))
        total_samples = int(24000 * seconds)
        total_bytes = total_samples * 2
        chunk_bytes = settings.tts_chunk_bytes
        sent = 0
        first = True
        while sent < total_bytes:
            n = min(chunk_bytes, total_bytes - sent)
            # Pad short tail to chunk_bytes.
            payload = b"\x00" * n
            if n < chunk_bytes:
                payload += b"\x00" * (chunk_bytes - n)
            sent += n
            if not first:
                await asyncio.sleep(settings.tts_chunk_pace_s)
            first = False
            yield payload


def get_tts():
    """Factory: real client when a key is present, else the silent mock."""
    if settings.tts_provider == "cartesia" and settings.cartesia_api_key:
        try:
            import cartesia  # noqa: F401
        except ImportError:
            logger.warning("cartesia SDK not installed; using MockTTS. `pip install cartesia`.")
            return MockTTS()
        return CartesiaTTS(settings.cartesia_api_key, voice_id=settings.cartesia_voice_id)
    logger.warning("Using MockTTS (set CARTESIA_API_KEY to enable Cartesia)")
    return MockTTS()
