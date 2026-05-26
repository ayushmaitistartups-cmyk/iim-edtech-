"""Phase 4 classifier heuristics."""

from app.services.classifier import classify_from_text


def test_empty_text_is_unknown():
    r = classify_from_text("")
    assert r.exam_track == "unknown"
    assert r.needs_grounding is False


def test_math_keywords_route_to_technical_track():
    r = classify_from_text("Help me with this integral and the derivative of x squared.")
    assert r.exam_track == "technical"
    # Technical never triggers grounding.
    assert r.needs_grounding is False


def test_current_affairs_keywords_trigger_grounding():
    r = classify_from_text("Who is the prime minister and what's the latest news on the budget?")
    assert r.needs_grounding is True
    # Conceptual or unknown — but never technical for current affairs.
    assert r.exam_track != "technical"


def test_history_keyword_routes_to_conceptual():
    r = classify_from_text("Tell me about ancient Indian history and the constitution.")
    assert r.exam_track == "conceptual"


def test_technical_keyword_beats_conceptual_when_both_present():
    r = classify_from_text("The history of trigonometry and equations.")
    assert r.exam_track == "technical"
