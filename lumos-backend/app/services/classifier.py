"""Phase 4 query classifier — decides exam_track + needs_grounding.

The full LLM-based classifier from ``BACKEND_DESIGN.md §4`` arrives in a
later iteration. For now we use a cheap heuristic that runs purely on the
device's identifier or the LLM history. The classifier output drives:

1. ``enable_grounding`` on the Gemini Flash call (Google Search tool).
2. ``exam_track`` hinting (technical/conceptual) for later prompt routing.

Returning ``ClassificationResult.unknown()`` is safe — the orchestrator
treats it as "default routing: no grounding, no track hint".
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Literal


logger = logging.getLogger(__name__)


ExamTrack = Literal["technical", "conceptual", "unknown"]


# Cheap keyword set; the full classifier per `03_SYSTEM_PROMPTS_AND_INSTRUCTIONS.md`
# is a Gemini Flash call. This heuristic is good enough until we wire that in
# (it's cheap and never wrong-in-a-dangerous-way: worst case we skip grounding).
_CURRENT_AFFAIRS_HINTS = re.compile(
    r"\b(today|yesterday|latest|recent|2024|2025|2026|prime\s+minister|president|minister|"
    r"current\s+affairs|news|election|world\s+cup|treaty|sanction|budget)\b",
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
    r"social|geography|literature|grammar|vocab|aptitude|reasoning|culture)\w*\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ClassificationResult:
    exam_track: ExamTrack
    needs_grounding: bool
    rationale: str = ""

    @staticmethod
    def unknown() -> "ClassificationResult":
        return ClassificationResult(
            exam_track="unknown",
            needs_grounding=False,
            rationale="default — no signal",
        )


def classify_from_text(text: str) -> ClassificationResult:
    """Run heuristics over a piece of context text (history, transcript hints).

    Phase 4: this is the only signal we have. Phase 5+ will swap to a Gemini
    Flash classifier call that also reads audio + image.
    """
    if not text:
        return ClassificationResult.unknown()

    track: ExamTrack = "unknown"
    if _TECHNICAL_HINTS.search(text):
        track = "technical"
    if _CONCEPTUAL_HINTS.search(text) and track != "technical":
        track = "conceptual"

    needs_grounding = bool(_CURRENT_AFFAIRS_HINTS.search(text)) and track != "technical"

    rationale_bits = []
    if track != "unknown":
        rationale_bits.append(f"track={track}")
    if needs_grounding:
        rationale_bits.append("current-affairs hint")
    rationale = ", ".join(rationale_bits) or "no strong signal"

    return ClassificationResult(
        exam_track=track,
        needs_grounding=needs_grounding,
        rationale=rationale,
    )
