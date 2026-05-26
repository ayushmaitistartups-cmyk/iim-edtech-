"""Validator — last line of defence before a reply leaves the orchestrator.

Phase 3/4 scope (per ``BACKEND_DESIGN.md §4.6.1`` + ``BACKEND_TODO §5.1``):

1. Strip markdown fencing or stray ``$`` delimiters the LLM might emit
   despite the system prompt.
2. Enforce voice payload caps (≤4 sentences, ≤350 chars).
3. Enforce TFT_TEXT layout (≤4 lines, ≤200 bytes).
4. Enforce conceptual-track display as plain text (no LaTeX).
5. Confirm ``display.kind == "latex"`` content actually renders — fall
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
MAX_TFT_TEXT_LINES = 4
MAX_TFT_LINE_CHARS = 40


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
    """Yank markdown, LaTeX commands, and screen-oriented symbols from speech."""
    s = speech.strip()
    # Remove ```...``` blocks.
    s = re.sub(r"```[\s\S]*?```", "", s)
    # Remove stray $...$ math delimiters but keep the content.
    s = re.sub(r"\$+([^$]*?)\$+", r"\1", s)
    # Convert common display math commands into rough spoken/plain forms.
    s = re.sub(r"\\(?:dfrac|frac)\{([^{}]+)\}\{([^{}]+)\}", r"\1 over \2", s)
    s = re.sub(r"\\sqrt\{([^{}]+)\}", r"square root of \1", s)
    s = re.sub(r"\\([A-Za-z]+)", r"\1", s)
    # Drop markdown/control glyphs that should never be spoken verbatim.
    s = s.replace("**", "").replace("*", "")
    s = s.replace("#", "")
    s = s.replace("_", " ")
    s = s.replace("\\", "")
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


def _fit_utf8_bytes(text: str, max_bytes: int) -> tuple[str, bool]:
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text, False
    cropped = encoded[:max_bytes].decode("utf-8", errors="ignore").rstrip()
    return cropped, True


def _wrap_tft_text(text: str) -> tuple[str, list[str]]:
    """Fit TFT text into the lamp's four-line / 200-byte display budget."""
    issues: list[str] = []
    original_bytes = len(text.encode("utf-8"))
    if original_bytes > MAX_TFT_TEXT_BYTES:
        issues.append(f"tft_text_too_long({original_bytes}B)")
    raw_lines = text.splitlines() or [text]
    lines: list[str] = []

    for raw in raw_lines:
        line = re.sub(r"\s+", " ", raw).strip()
        if not line:
            continue
        while len(line) > MAX_TFT_LINE_CHARS:
            cutoff = line.rfind(" ", 0, MAX_TFT_LINE_CHARS + 1)
            if cutoff <= 0:
                cutoff = MAX_TFT_LINE_CHARS
            lines.append(line[:cutoff].rstrip())
            line = line[cutoff:].strip()
            if "tft_text_wrapped" not in issues:
                issues.append("tft_text_wrapped")
        if line:
            lines.append(line)

    if len(lines) > MAX_TFT_TEXT_LINES:
        issues.append("tft_text_too_many_lines")
        lines = lines[:MAX_TFT_TEXT_LINES]

    fitted = "\n".join(lines)
    fitted, cropped = _fit_utf8_bytes(fitted, MAX_TFT_TEXT_BYTES)
    if cropped and not any(issue.startswith("tft_text_too_long(") for issue in issues):
        issues.append(f"tft_text_too_long({original_bytes}B)")
        fitted = "\n".join(fitted.splitlines()[:MAX_TFT_TEXT_LINES])
    return fitted, issues


def _latex_to_plain(latex: str, speech_fallback: str) -> str:
    """Best-effort LaTeX-to-plain text for conceptual displays."""
    s = latex_renderer._normalise_latex(latex)  # defensive alias/delimiter cleanup
    s = re.sub(r"\\(?:dfrac|frac)\{([^{}]+)\}\{([^{}]+)\}", r"\1 / \2", s)
    s = re.sub(r"\\sqrt\{([^{}]+)\}", r"sqrt(\1)", s)
    replacements = {
        r"\cdot": "*",
        r"\times": "x",
        r"\leq": "<=",
        r"\geq": ">=",
        r"\neq": "!=",
        r"\approx": "~",
        r"\rightarrow": "->",
        r"\Rightarrow": "=>",
        r"\infty": "infinity",
    }
    for old, new in replacements.items():
        s = s.replace(old, new)
    s = re.sub(r"\\[A-Za-z]+", "", s)
    s = s.replace("{", "").replace("}", "")
    s = s.replace("$", "").replace("\\", "")
    s = re.sub(r"\s+", " ", s).strip()
    return s or speech_fallback


def _validate_display(
    display: Display,
    speech_fallback: str,
    exam_track: str = "unknown",
) -> tuple[Display, list[str]]:
    """Return a possibly-rewritten display + list of issues."""
    issues: list[str] = []

    if display.kind == "text":
        fitted, text_issues = _wrap_tft_text(display.content)
        return Display(kind="text", content=fitted), issues + text_issues

    if display.kind == "latex":
        latex = display.content.strip()
        if not latex:
            return Display(kind="none", content=""), issues + ["empty_latex"]

        if exam_track == "conceptual":
            issues.append("conceptual_latex_stripped")
            fitted, text_issues = _wrap_tft_text(_latex_to_plain(latex, speech_fallback))
            return Display(kind="text", content=fitted), issues + text_issues

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
    snippet, _issues = _wrap_tft_text(speech)
    return Display(kind="text", content=snippet)


def validate(reply: LlmReply, exam_track: str = "unknown") -> ValidationResult:
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

    safe_display, display_issues = _validate_display(reply.display, truncated_speech, exam_track)
    issues.extend(display_issues)
    if "latex_render_failed" in display_issues or "forbidden_latex_command" in display_issues:
        confidence = min(confidence, 0.70)
    if "conceptual_latex_stripped" in display_issues:
        confidence = min(confidence, 0.85)

    safe_reply = LlmReply(
        speech=truncated_speech or reply.speech[:32],
        display=safe_display,
        is_confident=confidence,
    )
    if issues:
        logger.info("validator: %s (confidence %.2f→%.2f)", issues, reply.is_confident, confidence)
    return ValidationResult(reply=safe_reply, issues=issues, confidence_after=confidence)
