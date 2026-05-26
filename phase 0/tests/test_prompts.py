"""Phase 3+ system prompt sanity — it must instruct the LLM to emit
``is_confident`` and stay within the matplotlib mathtext subset, or the
validator's escalation gate is effectively dead.
"""

import json

from app.prompts import SYSTEM_PROMPT


def test_prompt_documents_the_full_json_schema():
    """All four top-level fields the orchestrator parses must appear in the prompt."""
    assert '"speech"' in SYSTEM_PROMPT
    assert '"display"' in SYSTEM_PROMPT
    assert '"kind"' in SYSTEM_PROMPT
    assert '"content"' in SYSTEM_PROMPT
    assert '"is_confident"' in SYSTEM_PROMPT, (
        "Prompt is missing is_confident; the Phase 3 escalation gate will never fire."
    )


def test_prompt_explains_when_to_lower_confidence():
    """The LLM needs criteria to lower confidence; without them it'll always emit 1.0."""
    lowered = SYSTEM_PROMPT.lower()
    assert "lower" in lowered and "is_confident" in lowered
    # At least one of the typical down-grade reasons must be named.
    assert any(hint in lowered for hint in ("blurry", "muffled", "outside", "guess", "ambiguous"))


def test_prompt_forbids_mathtext_breakers():
    """The matplotlib renderer can't parse these; the prompt must call them out."""
    for forbidden in ("\\tfrac", "\\substack", "\\boxed", "\\xrightarrow", "\\overset", "\\underset", "aligned"):
        assert forbidden in SYSTEM_PROMPT, f"Prompt no longer warns against {forbidden!r}"


def test_prompt_specifies_kind_literal_set():
    for kind in ('"latex"', '"text"', '"none"'):
        assert kind in SYSTEM_PROMPT


def test_prompt_is_strict_no_markdown_fence():
    # "no markdown fence" appears in the prompt instructing the LLM not
    # to wrap its JSON in ```.
    assert "no markdown fence" in SYSTEM_PROMPT.lower()


def test_prompt_caps_display_text_length():
    assert "200" in SYSTEM_PROMPT


def test_prompt_keeps_lamp_persona():
    assert "Lumos" in SYSTEM_PROMPT
    assert "tutor" in SYSTEM_PROMPT.lower()
    assert "lamp" in SYSTEM_PROMPT.lower()
