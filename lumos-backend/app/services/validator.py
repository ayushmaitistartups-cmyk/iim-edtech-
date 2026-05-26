"""Validator — last line of defence before a reply leaves the orchestrator.

Phase 3 scope (per ``BACKEND_DESIGN.md §4.6.1`` + ``BACKEND_TODO §5.1``):

1. Strip markdown fencing or stray ``$`` delimiters the LLM might emit
   despite the system prompt.
2. Enforce voice payload caps (≤4 sentences, ≤350 chars).
3. Enforce TFT_TEXT payload cap (≤200 bytes).
4. Confirm ``display.kind == "latex"`` content actually renders — fall
   back to a snippet of ``speech`` as plain text if not.

The validator never *raises* — it returns a possibly-massaged reply and
a list of issues for logging. The orchestrator decides whether to ship
the massaged reply or escalate.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from ..providers import latex_renderer
from ..schemas import Display, LlmReply


logger = logging.getLogger(__name__)


MAX_VOICE_CHARS = 350
MAX_VOICE_SENTENCES = 4
MAX_TFT_TEXT_BYTES = 200


# Commands that crash matplotlib mathtext — see BACKEND_DESIGN §4.6.1.
_FORBIDDEN_LATEX_PATTERNS = [
    r"\\tfrac\b",
    r"\\substack\b",
    r"\\boxed\b",
    r"\\xrightarrow\b",
    r"\\overset\b",
    r"\\underset\b",
    r"\\begin\{aligned\}",
    r"\\begin\{align\}",
    r"\\begin\{cases\}",
    r"\\begin\{array\}",
    r"\\color\b",
    r"\\\\",       # line break
]

_FORBIDDEN_LATEX_RE = re.compile("|".join(_FORBIDDEN_LATEX_PATTERNS))


@dataclass
class ValidationResult:
    reply: LlmReply
    issues: list[str]
    confidence_after: float  # may differ from reply.is_confident if we degrade


def _strip_voice_artifacts(speech: str) -> str:
    """Yank markdown fencing, stray dollar-sign math, common emoji noise."""
    s = speech.strip()
    # Remove ```...``` blocks.
    s = re.sub(r"```[\s\S]*?```", "", s)
    # Remove stray $...$ math (read it phonetically).
    s = re.sub(r"\$+([^$]*?)\$+", r"\1", s)
    # Collapse excessive whitespace.
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _truncate_voice(speech: str) -> tuple[str, bool]:
    """Cap speech to ``MAX_VOICE_CHARS`` / ``MAX_VOICE_SENTENCES``. Returns
    (truncated_text, was_truncated)."""
    truncated = False

    # First, cap on sentence count.
    sentences = re.split(r"(?<=[.!?])\s+", speech)
    if len(sentences) > MAX_VOICE_SENTENCES:
        speech = " ".join(sentences[:MAX_VOICE_SENTENCES])
        truncated = True

    # Then cap on raw chars.
    if len(speech) > MAX_VOICE_CHARS:
        speech = speech[:MAX_VOICE_CHARS].rstrip() + "…"
        truncated = True

    return speech, truncated


def _validate_display(display: Display, speech_fallback: str) -> tuple[Display, list[str]]:
    """Return a possibly-rewritten display + list of issues."""
    issues: list[str] = []

    if display.kind == "text":
        encoded = display.content.encode("utf-8")
        if len(encoded) > MAX_TFT_TEXT_BYTES:
            issues.append(f"tft_text_too_long({len(encoded)}B)")
            cropped = encoded[:MAX_TFT_TEXT_BYTES].decode("utf-8", errors="ignore")
            return Display(kind="text", content=cropped), issues
        return display, issues

    if display.kind == "latex":
        latex = display.content.strip()
        if not latex:
            return Display(kind="none", content=""), issues + ["empty_latex"]

        # Hard reject on forbidden mathtext commands.
        if _FORBIDDEN_LATEX_RE.search(latex):
            issues.append("forbidden_latex_command")
            return _latex_to_text_fallback(speech_fallback), issues

        # Try a quick render — if matplotlib chokes, fall back.
        rendered = latex_renderer.render(latex)
        if rendered is None:
            issues.append("latex_render_failed")
            return _latex_to_text_fallback(speech_fallback), issues

        return display, issues

    # kind == "none" — nothing to validate.
    return display, issues


def _latex_to_text_fallback(speech: str) -> Display:
    """When LaTeX is unrenderable, surface a short text snippet instead."""
    snippet = (speech[:MAX_TFT_TEXT_BYTES - 1] + "…") if len(speech) > MAX_TFT_TEXT_BYTES else speech
    return Display(kind="text", content=snippet)


def validate(reply: LlmReply) -> ValidationResult:
    """Massage a reply so it's safe to ship to the lamp."""
    issues: list[str] = []
    confidence = reply.is_confident

    cleaned_speech = _strip_voice_artifacts(reply.speech)
    if cleaned_speech != reply.speech:
        issues.append("voice_artifacts_stripped")

    truncated_speech, was_truncated = _truncate_voice(cleaned_speech)
    if was_truncated:
        issues.append("voice_truncated")
        # Voice truncation is a soft quality hit; nick the confidence so the
        # orchestrator's escalation gate can react.
        confidence = min(confidence, 0.85)

    safe_display, display_issues = _validate_display(reply.display, truncated_speech)
    issues.extend(display_issues)
    if "latex_render_failed" in display_issues or "forbidden_latex_command" in display_issues:
        confidence = min(confidence, 0.70)

    safe_reply = LlmReply(
        speech=truncated_speech or reply.speech[:32],
        display=safe_display,
        is_confident=confidence,
    )
    if issues:
        logger.info("validator: %s (confidence %.2f→%.2f)", issues, reply.is_confident, confidence)
    return ValidationResult(reply=safe_reply, issues=issues, confidence_after=confidence)
