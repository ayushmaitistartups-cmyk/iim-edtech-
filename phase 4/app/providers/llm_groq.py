"""Text-only Groq Llama 3.3 70B client for Turn 2+ follow-ups."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator

from ..config import settings
from .llm_gemini import LLMError  # Reuse the same error type for consistency

logger = logging.getLogger(__name__)


class GroqLLM:
    """Wraps the Groq SDK for cheap Turn 2+ text-only follow-ups."""

    def __init__(self, api_key: str, model: str = "llama-3.3-70b-versatile"):
        from groq import AsyncGroq
        self._client = AsyncGroq(api_key=api_key)
        self.model = model

    @property
    def name(self) -> str:
        return f"groq:{self.model}"

    async def transcribe(self, audio_pcm: bytes) -> str:
        """Transcribe PCM audio to text using Groq's Whisper."""
        import io
        import wave
        
        # Convert PCM to WAV
        wav_buf = io.BytesIO()
        with wave.open(wav_buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(audio_pcm)
            
        wav_bytes = wav_buf.getvalue()
        file_tuple = ("audio.wav", wav_bytes, "audio/wav")
        
        try:
            transcription = await self._client.audio.transcriptions.create(
                file=file_tuple,
                model="whisper-large-v3-turbo",
            )
            return transcription.text.strip()
        except Exception as exc:
            logger.warning(f"Groq transcription failed: {exc}")
            return ""

    async def stream(
        self,
        *,
        history_text: str = "",
        msm_text: str = "",
        nudge_instruction: str = "",
    ) -> AsyncIterator[str]:
        """Yields text deltas for Turn 2+."""
        system_prompt = (
            "You are an AI tutoring lamp. You are handling a follow-up turn. "
            "You MUST output valid JSON only.\n"
            "{\n"
            '  "speech": "what you say",\n'
            '  "display": {"kind": "text|latex|none", "content": "what to show"},\n'
            '  "is_confident": 1.0\n'
            "}\n"
            "Here is the Master Solution Model (MSM) for this question:\n"
            f"{msm_text}\n\n"
            f"Your instruction for this turn: {nudge_instruction}\n"
            "Do NOT hallucinate steps. Base everything on the MSM."
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Conversation history:\n{history_text}"}
        ]

        started = time.monotonic()

        try:
            stream = await self._client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7,
                max_tokens=settings.llm_max_output_tokens,
                response_format={"type": "json_object"},
                stream=True,
            )
        except Exception as exc:
            raise LLMError(f"Groq stream failed to start: {exc}") from exc

        try:
            async for chunk in stream:
                if (time.monotonic() - started) > settings.llm_total_timeout_s:
                    raise LLMError("Groq stream exceeded budget")
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            raise LLMError(f"Groq stream broke mid-flight: {exc}") from exc


class MockGroq:
    """Mock for local dev without a Groq key."""
    
    def __init__(self):
        import json
        self._reply_json = json.dumps({
            "speech": "This is a Turn 2 follow up from Mock Groq.",
            "display": {"kind": "text", "content": "Mock Groq Turn 2+"},
            "is_confident": 1.0
        })

    @property
    def name(self) -> str:
        return "mock-groq"

    async def stream(self, **kwargs) -> AsyncIterator[str]:
        await asyncio.sleep(0.15)
        for i in range(0, len(self._reply_json), 32):
            yield self._reply_json[i : i + 32]
            await asyncio.sleep(0.01)

    async def transcribe(self, audio_pcm: bytes) -> str:
        await asyncio.sleep(0.1)
        return "This is a mock transcription of the audio."


def get_groq_llm():
    """Factory: returns real Groq client if key exists, else mock."""
    api_key = getattr(settings, "groq_api_key", None)
    if api_key:
        return GroqLLM(api_key)
    logger.warning("Using MockGroq (set GROQ_API_KEY to enable real Turn 2+)")
    return MockGroq()
