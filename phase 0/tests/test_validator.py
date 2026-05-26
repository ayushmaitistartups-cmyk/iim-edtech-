"""Phase 3 validator + confidence-gate behaviour."""

from app.schemas import Display, LlmReply
from app.services import validator
from app.services.validator import (
    MAX_TFT_TEXT_BYTES,
    MAX_VOICE_CHARS,
    MAX_VOICE_SENTENCES,
)


def _reply(speech="Hello there.", kind="none", content="", confidence=1.0):
    return LlmReply(
        speech=speech,
        display=Display(kind=kind, content=content),
        is_confident=confidence,
    )


def test_clean_reply_passes_through_unchanged():
    r = _reply("The integral evaluates to one half.", "text", "Hint: split the limits.")
    res = validator.validate(r)
    assert res.issues == []
    assert res.reply.speech == "The integral evaluates to one half."
    assert res.confidence_after == 1.0


def test_markdown_fence_in_speech_is_stripped():
    r = _reply("```python\nprint(1)\n``` Try splitting it.", "none")
    res = validator.validate(r)
    assert "voice_artifacts_stripped" in res.issues
    assert "```" not in res.reply.speech


def test_dollar_math_in_speech_is_unwrapped():
    r = _reply("So $x^2 + 1$ is positive.", "none")
    res = validator.validate(r)
    assert "voice_artifacts_stripped" in res.issues
    assert "$" not in res.reply.speech
    assert "x^2 + 1" in res.reply.speech


def test_excessive_voice_is_truncated_and_confidence_drops():
    long = ". ".join([f"Sentence number {i}" for i in range(20)]) + "."
    r = _reply(long, "none")
    res = validator.validate(r)
    assert "voice_truncated" in res.issues
    # Either sentence count OR char count gates trip.
    assert len(res.reply.speech.split(". ")) <= MAX_VOICE_SENTENCES + 1
    assert len(res.reply.speech) <= MAX_VOICE_CHARS + 1
    assert res.confidence_after <= 0.85


def test_tft_text_over_200_bytes_is_cropped():
    r = _reply("ok", "text", "X" * 300)
    res = validator.validate(r)
    assert "tft_text_too_long(300B)" in res.issues
    assert len(res.reply.display.content.encode("utf-8")) <= MAX_TFT_TEXT_BYTES


def test_forbidden_latex_falls_back_to_text():
    r = _reply("It uses an aligned environment.", "latex", r"\begin{aligned} a = b \end{aligned}")
    res = validator.validate(r)
    assert "forbidden_latex_command" in res.issues
    assert res.reply.display.kind == "text"
    assert res.confidence_after <= 0.70


def test_empty_latex_collapses_to_kind_none():
    r = _reply("nothing to show", "latex", "  ")
    res = validator.validate(r)
    assert "empty_latex" in res.issues
    assert res.reply.display.kind == "none"


def test_renderable_latex_passes_through():
    r = _reply("Try this.", "latex", r"\frac{1}{2} + x^2")
    res = validator.validate(r)
    # No forbidden command or render failure should bubble up.
    assert "forbidden_latex_command" not in res.issues
    assert res.reply.display.kind == "latex"


def test_unrenderable_latex_falls_back_to_text():
    # mathtext can't parse a bare nested \boxed.
    r = _reply("Look at this.", "latex", r"\boxed{x^2}")
    res = validator.validate(r)
    assert "forbidden_latex_command" in res.issues or "latex_render_failed" in res.issues
    assert res.reply.display.kind == "text"


def test_confidence_below_threshold_is_preserved():
    r = _reply("Maybe", "none", confidence=0.4)
    res = validator.validate(r)
    # Validator shouldn't *raise* confidence — only lower it.
    assert res.confidence_after <= 0.4


def test_conceptual_track_never_ships_latex_display():
    r = _reply("Use energy equals mass times c squared.", "latex", r"E = mc^2")
    res = validator.validate(r, exam_track="conceptual")
    assert "conceptual_latex_stripped" in res.issues
    assert res.reply.display.kind == "text"
    assert "\\" not in res.reply.display.content
    assert "$" not in res.reply.display.content


def test_tft_text_is_limited_to_four_lines_and_200_bytes():
    text = "\n".join(
        [
            "Line one is useful",
            "Line two is useful",
            "Line three is useful",
            "Line four is useful",
            "Line five must not fit on the lamp",
        ]
    )
    res = validator.validate(_reply("ok", "text", text))
    assert "tft_text_too_many_lines" in res.issues
    assert len(res.reply.display.content.splitlines()) <= 4
    assert len(res.reply.display.content.encode("utf-8")) <= MAX_TFT_TEXT_BYTES


def test_voice_output_removes_markdown_and_latex_symbols():
    r = _reply(r"Use **\frac{a}{b}** #now_and then.", "none")
    res = validator.validate(r)
    assert "voice_artifacts_stripped" in res.issues
    assert "\\" not in res.reply.speech
    assert "*" not in res.reply.speech
    assert "#" not in res.reply.speech
    assert "_" not in res.reply.speech
