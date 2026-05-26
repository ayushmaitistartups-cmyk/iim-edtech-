"""Pydantic models for inter-layer contracts."""

from typing import Literal

from pydantic import BaseModel, Field


class Display(BaseModel):
    """What the lamp's TFT will show."""

    kind: Literal["latex", "text", "none"]
    content: str = ""


class LlmReply(BaseModel):
    """The structured response the LLM must emit each turn.

    The Gemini call uses ``response_mime_type='application/json'`` so the
    full output buffer is always a valid object matching this schema.

    ``is_confident`` is a float in ``[0, 1]``. Phase 3 uses it to decide
    whether to escalate to Gemini 2.5 Pro: anything <0.60 escalates;
    0.60–0.85 ships as-is but logs for review.
    """

    speech: str = Field(min_length=1, max_length=2000)
    display: Display
    is_confident: float = Field(default=1.0, ge=0.0, le=1.0)
    master_solution: str | None = None


FALLBACK_REPLY = LlmReply(
    speech="Sorry, I had trouble connecting. Try asking again.",
    display=Display(kind="none", content=""),
    is_confident=1.0,
)


class TurnMetrics(BaseModel):
    """Per-turn latency + cost telemetry."""

    turn_id: str
    audio_bytes: int
    image_bytes: int
    ttft_ms: int | None = None
    total_ms: int | None = None
    llm_model: str | None = None
    llm_input_tokens: int | None = None
    llm_output_tokens: int | None = None
    cost_usd: float | None = None
    error: str | None = None
