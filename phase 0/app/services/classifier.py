"""Phase 4 query classifier — decides exam_track + needs_grounding.

The cheap text heuristic is used in tests and dev fallback. When a Gemini key
is configured, ``classify_turn`` runs the spec's current-turn classifier over
audio + image before the main answer call. The classifier output drives:

1. ``enable_grounding`` on the Gemini Flash call (Google Search tool).
2. ``exam_track`` hinting (technical/conceptual) for display validation.

Returning ``ClassificationResult.unknown()`` is safe — the orchestrator treats
it as "default routing: no grounding, no track hint".
"""

from __future__ import annotations

import json
import logging
import re
import wave
from dataclasses import dataclass
from io import BytesIO
from typing import Literal

from ..config import settings


logger = logging.getLogger(__name__)


QueryType = Literal[
    "conceptual_doubt",
    "solving_support_concept",
    "solving_support_formula",
    "solving_support_calc",
    "validation",
    "mistake_identification",
]
Difficulty = Literal["easy", "medium", "hard"]
ExamType = Literal["jee", "gate", "neet", "upsc", "cat", "ssc", "other"]
ExamTrack = Literal["technical", "conceptual", "unknown"]


# Cheap keyword set; the full classifier per `03_SYSTEM_PROMPTS_AND_INSTRUCTIONS.md`
# is a Gemini Flash call. This heuristic is good enough until we wire that in
# (it's cheap and never wrong-in-a-dangerous-way: worst case we skip grounding).
_CURRENT_AFFAIRS_HINTS = re.compile(
    r"\b(today|yesterday|latest|recent|2024|2025|2026|prime\s+minister|president|minister|"
    r"current\s+affairs|news|election|world\s+cup|treaty|sanction|budget|award|appointment)\b",
    re.IGNORECASE,
)

# Both regexes allow a trailing-suffix wildcard so "equations", "trigonometry",
# "geometry", "differential" etc. all hit a single root. ``\b...\w*\b`` anchors
# at a word start but permits the rest of the word.
_TECHNICAL_HINTS = re.compile(
    r"\b(integral|derivative|equation|matrix|matrices|theorem|polynomial|reaction|enzyme|"
    r"oxidation|electric|magnetic|kinematics|geometr|trigonometr|differentiat|integrat|"
    r"physics|chemistry|math)\w*\b",
    re.IGNORECASE,
)

_CONCEPTUAL_HINTS = re.compile(
    r"\b(history|economy|economic|polity|political|constitution|essay|reading\s+comprehension|"
    r"social|geography|literature|grammar|vocab|aptitude|reasoning|culture|current\s+affairs)\w*\b",
    re.IGNORECASE,
)

_EXAM_HINTS: list[tuple[ExamType, re.Pattern[str]]] = [
    ("jee", re.compile(r"\bjee\b", re.IGNORECASE)),
    ("gate", re.compile(r"\bgate\b", re.IGNORECASE)),
    ("neet", re.compile(r"\bneet\b", re.IGNORECASE)),
    ("upsc", re.compile(r"\bupsc|ias|civil\s+services\b", re.IGNORECASE)),
    ("cat", re.compile(r"\bcat\b", re.IGNORECASE)),
    ("ssc", re.compile(r"\bssc\b", re.IGNORECASE)),
]

_SUBJECT_HINTS: list[tuple[str, re.Pattern[str]]] = [
    ("current_affairs", _CURRENT_AFFAIRS_HINTS),
    ("math", re.compile(r"\b(math|integral|derivative|equation|matrix|trigonometr|geometr)\w*\b", re.I)),
    ("physics", re.compile(r"\b(physics|kinematics|electric|magnetic|force|velocity)\w*\b", re.I)),
    ("chemistry", re.compile(r"\b(chemistry|reaction|oxidation|enzyme|molecule)\w*\b", re.I)),
    ("history", re.compile(r"\bhistory|ancient|medieval|modern\s+india\b", re.I)),
    ("polity", re.compile(r"\bpolity|constitution|parliament|federal\b", re.I)),
    ("economy", re.compile(r"\beconomy|economic|budget|inflation|gdp\b", re.I)),
    ("geography", re.compile(r"\bgeography|river|monsoon|climate\b", re.I)),
    ("reasoning", re.compile(r"\breasoning|aptitude|syllogism\b", re.I)),
]


def _track_for_exam(exam_type: ExamType) -> ExamTrack:
    if exam_type in ("jee", "gate", "neet"):
        return "technical"
    if exam_type in ("upsc", "cat", "ssc"):
        return "conceptual"
    return "unknown"


@dataclass(frozen=True)
class ClassificationResult:
    exam_track: ExamTrack
    needs_grounding: bool
    rationale: str = ""
    query_type: QueryType = "conceptual_doubt"
    difficulty: Difficulty = "medium"
    subject: str = "general"
    exam_type: ExamType = "other"
    image_useful: bool = False

    def __post_init__(self) -> None:
        exam_track = self.exam_track
        exam_type = self.exam_type
        if exam_track == "unknown":
            exam_track = _track_for_exam(exam_type)
        if self.needs_grounding and exam_track == "unknown":
            exam_track = "conceptual"
        if exam_track == "technical" and self.needs_grounding:
            object.__setattr__(self, "needs_grounding", False)
        object.__setattr__(self, "exam_track", exam_track)

    @staticmethod
    def unknown() -> "ClassificationResult":
        return ClassificationResult(
            exam_track="unknown",
            needs_grounding=False,
            rationale="default - no signal",
            query_type="conceptual_doubt",
            difficulty="medium",
            subject="general",
            exam_type="other",
            image_useful=False,
        )

    @staticmethod
    def from_mapping(raw: dict, *, fallback_text: str = "") -> "ClassificationResult":
        """Normalise provider JSON into the strict classifier contract."""
        exam_type = str(raw.get("exam_type") or "other").lower()
        if exam_type not in {"jee", "gate", "neet", "upsc", "cat", "ssc", "other"}:
            exam_type = "other"

        exam_track = str(raw.get("exam_track") or "unknown").lower()
        if exam_track not in {"technical", "conceptual", "unknown"}:
            exam_track = _track_for_exam(exam_type)  # type: ignore[arg-type]

        query_type = str(raw.get("query_type") or "conceptual_doubt")
        if query_type not in {
            "conceptual_doubt",
            "solving_support_concept",
            "solving_support_formula",
            "solving_support_calc",
            "validation",
            "mistake_identification",
        }:
            query_type = "conceptual_doubt"

        difficulty = str(raw.get("difficulty") or raw.get("difficulty_level") or "medium")
        if difficulty not in {"easy", "medium", "hard"}:
            difficulty = "medium"

        subject = str(raw.get("subject") or "general").lower()
        if subject == "current affairs":
            subject = "current_affairs"

        fallback = classify_from_text(fallback_text) if fallback_text else ClassificationResult.unknown()
        needs_grounding = bool(raw.get("needs_grounding", fallback.needs_grounding))
        if subject == "current_affairs" and exam_track != "technical":
            needs_grounding = True

        return ClassificationResult(
            exam_track=exam_track,  # type: ignore[arg-type]
            needs_grounding=needs_grounding,
            rationale=str(raw.get("rationale") or "provider classifier"),
            query_type=query_type,  # type: ignore[arg-type]
            difficulty=difficulty,  # type: ignore[arg-type]
            subject=subject,
            exam_type=exam_type,  # type: ignore[arg-type]
            image_useful=bool(raw.get("image_useful", False)),
        )


def classify_from_text(text: str) -> ClassificationResult:
    """Run heuristics over a piece of context text (history, transcript hints).

    Phase 4: this is the only signal we have. Phase 5+ will swap to a Gemini
    Flash classifier call that also reads audio + image.
    """
    if not text:
        return ClassificationResult.unknown()

    exam_type: ExamType = "other"
    for candidate, pattern in _EXAM_HINTS:
        if pattern.search(text):
            exam_type = candidate
            break

    subject = "general"
    for candidate, pattern in _SUBJECT_HINTS:
        if pattern.search(text):
            subject = candidate
            break

    track: ExamTrack = "unknown"
    exam_track = _track_for_exam(exam_type)
    if exam_track != "unknown":
        track = exam_track
    if _TECHNICAL_HINTS.search(text):
        track = "technical"
    if _CONCEPTUAL_HINTS.search(text) and track != "technical":
        track = "conceptual"
    if subject == "current_affairs" and track == "unknown":
        track = "conceptual"

    query_type: QueryType = "conceptual_doubt"
    lowered = text.lower()
    if re.search(r"\b(correct|right|validate|check my answer)\b", lowered):
        query_type = "validation"
    elif re.search(r"\b(mistake|wrong|error)\b", lowered):
        query_type = "mistake_identification"
    elif re.search(r"\b(formula|identity)\b", lowered):
        query_type = "solving_support_formula"
    elif re.search(r"\b(calculate|algebra|simplify|solve)\b", lowered):
        query_type = "solving_support_calc"
    elif track == "technical":
        query_type = "solving_support_concept"

    difficulty: Difficulty = "medium"
    if re.search(r"\b(jee advanced|prove|derivation|hard|olympiad)\b", lowered):
        difficulty = "hard"
    elif re.search(r"\b(who is|what is|define|meaning)\b", lowered):
        difficulty = "easy"

    needs_grounding = bool(_CURRENT_AFFAIRS_HINTS.search(text)) and track != "technical"

    rationale_bits = []
    if track != "unknown":
        rationale_bits.append(f"track={track}")
    if exam_type != "other":
        rationale_bits.append(f"exam={exam_type}")
    if subject != "general":
        rationale_bits.append(f"subject={subject}")
    if needs_grounding:
        rationale_bits.append("current-affairs hint")
    rationale = ", ".join(rationale_bits) or "no strong signal"

    return ClassificationResult(
        exam_track=track,
        needs_grounding=needs_grounding,
        rationale=rationale,
        query_type=query_type,
        difficulty=difficulty,
        subject=subject,
        exam_type=exam_type,
        image_useful=False,
    )


CLASSIFIER_PROMPT = """You are a query classifier for an AI tutoring lamp.
Given the learner's audio query, optional desk image, and recent text context,
output ONLY valid JSON. No preamble. No markdown.

{
  "query_type": "conceptual_doubt|solving_support_concept|solving_support_formula|solving_support_calc|validation|mistake_identification",
  "difficulty": "easy|medium|hard",
  "subject": "math|physics|chemistry|biology|history|geography|polity|economy|cs|english|verbal|quant|reasoning|current_affairs|general",
  "exam_type": "jee|gate|neet|upsc|cat|ssc|other",
  "exam_track": "technical|conceptual|unknown",
  "needs_grounding": true,
  "image_useful": true
}

exam_track is technical for JEE/GATE/NEET, conceptual for UPSC/CAT/SSC.
needs_grounding is true only for current affairs, recent appointments, awards,
budgets, elections, or post-2024 UPSC/SSC facts.
"""


def _wrap_pcm_as_wav(pcm: bytes, sample_rate: int = 16000) -> bytes:
    buf = BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


async def classify_turn(
    *,
    image_bytes: bytes,
    audio_pcm: bytes,
    history_text: str = "",
) -> ClassificationResult:
    """Classify the current turn before the main LLM call.

    With a Gemini key, this reads the actual audio/image. In local dev and
    tests, it falls back to the deterministic text heuristic over history.
    """
    fallback = classify_from_text(history_text)
    if not settings.gemini_api_key:
        return fallback

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.gemini_api_key)
        parts: list[types.Part] = []
        if history_text:
            parts.append(types.Part.from_text(text=f"Recent context:\n{history_text}"))
        if image_bytes:
            parts.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))
        parts.append(types.Part.from_bytes(data=_wrap_pcm_as_wav(audio_pcm), mime_type="audio/wav"))

        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            config=types.GenerateContentConfig(
                system_instruction=CLASSIFIER_PROMPT,
                response_mime_type="application/json",
                max_output_tokens=160,
                temperature=0.0,
            ),
            contents=parts,
        )
        text = getattr(response, "text", "") or "{}"
        return ClassificationResult.from_mapping(json.loads(text), fallback_text=history_text)
    except Exception as exc:  # pragma: no cover - network/auth/SDK shape
        logger.warning("turn classifier failed; using heuristic fallback: %s", exc)
        return fallback
