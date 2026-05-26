"""Phase 4 classifier + grounding routing."""

from app.services.classifier import ClassificationResult, classify_from_text


def test_empty_text_is_unknown():
    r = classify_from_text("")
    assert r.exam_track == "unknown"
    assert r.exam_type == "other"
    assert r.subject == "general"
    assert r.needs_grounding is False


def test_math_keywords_route_to_technical_track():
    r = classify_from_text("Help me with this integral and the derivative of x squared.")
    assert r.exam_track == "technical"
    # Technical never triggers grounding.
    assert r.needs_grounding is False


def test_current_affairs_keywords_trigger_grounding():
    r = classify_from_text("For UPSC, who is the prime minister and what's the latest news on the budget?")
    assert r.needs_grounding is True
    assert r.exam_track == "conceptual"
    assert r.exam_type == "upsc"
    assert r.subject == "current_affairs"


def test_history_keyword_routes_to_conceptual():
    r = classify_from_text("Tell me about ancient Indian history and the constitution.")
    assert r.exam_track == "conceptual"


def test_technical_keyword_beats_conceptual_when_both_present():
    r = classify_from_text("The history of trigonometry and equations.")
    assert r.exam_track == "technical"


def test_classifier_result_normalises_grounding_to_conceptual_track():
    r = ClassificationResult(
        query_type="conceptual_doubt",
        difficulty="medium",
        subject="current_affairs",
        exam_type="other",
        exam_track="unknown",
        needs_grounding=True,
        image_useful=False,
        rationale="test",
    )
    assert r.exam_track == "conceptual"
    assert r.needs_grounding is True
