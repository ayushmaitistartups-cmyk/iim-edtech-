"""Multimodal Gemini 2.5 Flash client.

One call per turn: audio + image + history → JSON-formatted ``LlmReply``.
No STT step (Gemini accepts raw audio natively). JSON mode guarantees the
output buffer is parseable.

If ``GEMINI_API_KEY`` is unset we fall back to ``MockLLM`` so the orchestrator
loop can be exercised end-to-end on a dev box. Real provider is selected
in ``services/orchestrator.py`` via ``get_llm()``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import wave
from collections.abc import AsyncIterator
from io import BytesIO

from ..config import settings
from ..prompts import SYSTEM_PROMPT
from . import cache_manager


logger = logging.getLogger(__name__)


class LLMError(RuntimeError):
    """Wraps provider 5xx / safety-block / timeout."""


def _wrap_pcm_as_wav(pcm: bytes, sample_rate: int = 16000) -> bytes:
    """Gemini accepts ``audio/wav`` more reliably than raw PCM."""
    buf = BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


class GeminiLLM:
    """Wraps the ``google-genai`` SDK with the per-turn budget."""

    def __init__(self, api_key: str, model: str = "gemini-2.5-flash"):
        # Import lazily so the module loads even if google-genai is missing.
        from google import genai

        self._genai = genai
        self._client = genai.Client(api_key=api_key)
        self.model = model

    @property
    def name(self) -> str:
        return f"gemini:{self.model}"

    async def stream(
        self,
        *,
        image_bytes: bytes,
        audio_pcm: bytes,
        history_text: str = "",
        enable_grounding: bool = False,
    ) -> AsyncIterator[str]:
        """Yields text deltas. The orchestrator concatenates and parses.

        Raises ``LLMError`` on 5xx / safety block / parse failure.

        ``enable_grounding`` switches on Gemini's Google Search tool for
        conceptual exams (UPSC/CAT/SSC current-affairs questions). Phase 4
        opts in based on the classifier's ``needs_grounding`` flag.
        """
        from google.genai import types

        wav_bytes = _wrap_pcm_as_wav(audio_pcm)

        parts: list[types.Part] = []
        if history_text:
            parts.append(types.Part.from_text(text=history_text))
        if image_bytes:
            parts.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))
        parts.append(types.Part.from_bytes(data=wav_bytes, mime_type="audio/wav"))

        tools: list = []
        if enable_grounding:
            try:
                tools.append(types.Tool(google_search=types.GoogleSearch()))
            except Exception:
                # Older SDKs use a different shape; fall back to plain call.
                tools = []

        # Try the explicit context cache. ``cached_content`` only works
        # when the cached prefix is large enough (≥32 K tokens) AND we're
        # not also using the grounding tool (the two are mutually
        # exclusive per ``02_WORKFLOW.md`` §3). If neither condition is
        # met, ``cache_name`` is None and we fall through to the plain
        # ``system_instruction`` path — Gemini's implicit prefix caching
        # still kicks in there automatically.
        cache_name: str | None = None
        if settings.gemini_context_cache and not enable_grounding:
            cache_mgr = cache_manager.get_cache_manager_for(self._client, self.model)
            cache_name = await cache_mgr.get_or_create_for_system_instruction(
                key="system_prompt",
                system_text=SYSTEM_PROMPT,
                model=self.model,
                ttl_s=settings.gemini_cache_ttl_s,
            )

        config_kwargs: dict = dict(
            response_mime_type="application/json",
            max_output_tokens=settings.llm_max_output_tokens,
            temperature=0.7,
        )
        if cache_name:
            config_kwargs["cached_content"] = cache_name
        else:
            config_kwargs["system_instruction"] = SYSTEM_PROMPT
        if tools:
            config_kwargs["tools"] = tools
        config = types.GenerateContentConfig(**config_kwargs)

        started = time.monotonic()

        try:
            stream = await self._client.aio.models.generate_content_stream(
                model=self.model,
                config=config,
                contents=parts,
            )
        except Exception as exc:  # pragma: no cover — network / auth
            raise LLMError(f"Gemini stream failed to start: {exc}") from exc

        try:
            async for chunk in stream:
                if (time.monotonic() - started) > settings.llm_total_timeout_s:
                    raise LLMError("Gemini stream exceeded budget")
                text = getattr(chunk, "text", "") or ""
                if text:
                    yield text
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover — network mid-stream
            raise LLMError(f"Gemini stream broke mid-flight: {exc}") from exc


class MockLLM:
    """Deterministic stand-in used when no API key is configured.

    Emits a fixed JSON reply matching ``LlmReply``. Useful for end-to-end
    tests of the orchestrator + TTS + TFT pipeline without burning credits.
    """

    def __init__(self, reply_json: str | None = None):
        self._reply_json = reply_json or json.dumps(
            {
                "speech": (
                    "I'm running in mock mode — no Gemini key configured. "
                    "Drop GEMINI_API_KEY in your env and restart to wire the real brain."
                ),
                "display": {"kind": "text", "content": "Mock mode: no Gemini key"},
            }
        )

    @property
    def name(self) -> str:
        return "mock-llm"

    async def stream(
        self,
        *,
        image_bytes: bytes,
        audio_pcm: bytes,
        history_text: str = "",
        enable_grounding: bool = False,
    ) -> AsyncIterator[str]:
        # Simulate ~400 ms TTFT to keep latency tests realistic.
        await asyncio.sleep(0.4)
        # Chunk the reply so callers can exercise streaming concat.
        for i in range(0, len(self._reply_json), 32):
            yield self._reply_json[i : i + 32]
            await asyncio.sleep(0.01)


def get_llm(*, model: str | None = None):
    """Factory: returns the real client when a key is present, else the mock.

    Pass ``model`` to override the configured model (Phase 3 escalation
    uses this to spin up a Gemini 2.5 Pro client on top of the same key).
    """
    if settings.llm_provider == "gemini" and settings.gemini_api_key:
        return GeminiLLM(settings.gemini_api_key, model=model or settings.gemini_model)
    if model:
        logger.warning("Using MockLLM for model=%r (set GEMINI_API_KEY to enable Gemini)", model)
    else:
        logger.warning("Using MockLLM (set GEMINI_API_KEY to enable Gemini)")
    return MockLLM()
