"""Phase 6: incremental JSON parser for the ``speech`` field."""

import json

import pytest

from app.services.streaming_parser import (
    SENTENCE_MIN_CHARS,
    SpeechSentenceStreamer,
)


def _drain(streamer: SpeechSentenceStreamer, chunks: list[str]) -> list[str]:
    out: list[str] = []
    for c in chunks:
        out.extend(streamer.feed(c))
    return out


def test_emits_sentences_at_punctuation_boundaries():
    reply = json.dumps(
        {
            "speech": "First sentence here. Second sentence too. And a third one.",
            "display": {"kind": "none", "content": ""},
        }
    )
    streamer = SpeechSentenceStreamer()
    # Feed one byte at a time to exercise the state machine.
    emitted: list[str] = []
    for ch in reply:
        emitted.extend(streamer.feed(ch))
    # Plus any tail flush — speech_complete fires when the closing quote arrives.
    assert "First sentence here." in emitted
    assert "Second sentence too." in emitted
    assert "And a third one." in emitted


def test_does_not_emit_overly_short_fragments():
    reply = json.dumps(
        {
            "speech": "Hi. " + "x" * 50 + ".",  # "Hi." is 3 chars, below threshold.
            "display": {"kind": "none", "content": ""},
        }
    )
    streamer = SpeechSentenceStreamer()
    emitted = _drain(streamer, [reply])
    # Either the short fragment gets merged with the next, or it's dropped —
    # but never emitted on its own.
    for s in emitted:
        assert len(s) >= SENTENCE_MIN_CHARS or s == emitted[-1]
    # We should have at least one emission containing the long fragment.
    assert any("x" * 50 in s for s in emitted)


def test_handles_escaped_quotes_inside_speech():
    reply = json.dumps(
        {
            "speech": 'He said "hello" and walked away. Then I left too.',
            "display": {"kind": "none", "content": ""},
        }
    )
    streamer = SpeechSentenceStreamer()
    emitted = _drain(streamer, [reply])
    assert any("hello" in s for s in emitted)


def test_full_buffer_is_round_trip_parseable():
    reply = json.dumps(
        {
            "speech": "Hello there friend. Sample text for testing.",
            "display": {"kind": "text", "content": "Hint"},
            "is_confident": 0.92,
        }
    )
    streamer = SpeechSentenceStreamer()
    for ch in reply:
        streamer.feed(ch)
    parsed = json.loads(streamer.full_buffer())
    assert parsed["speech"].startswith("Hello there friend.")
    assert parsed["display"]["kind"] == "text"
    assert parsed["is_confident"] == 0.92


def test_run_on_speech_force_flushes_at_cap():
    long_no_punctuation = "this is a really long sentence with no punctuation that should force a flush" * 3
    reply = json.dumps(
        {
            "speech": long_no_punctuation,
            "display": {"kind": "none", "content": ""},
        }
    )
    streamer = SpeechSentenceStreamer()
    emitted = _drain(streamer, [reply])
    # The force-flush gate should produce at least one mid-stream emission.
    assert emitted


def test_emits_nothing_until_speech_key_appears():
    # If we only feed the opening brace and pre-speech keys, no emissions yet.
    streamer = SpeechSentenceStreamer()
    emitted = streamer.feed('{"display": {"kind": "none", "content": ""}, ')
    assert emitted == []
    # A full-length sentence after the key opens — must be ≥ SENTENCE_MIN_CHARS.
    emitted = streamer.feed('"speech": "Look at the integral on the page. ')
    assert any("integral" in s for s in emitted)


def test_split_across_chunk_boundaries_still_finds_speech_key():
    """If the LLM SDK splits the token stream right inside `"speech"`, the
    parser must still pick it up on the next delta."""
    streamer = SpeechSentenceStreamer()
    streamer.feed('{"spe')
    streamer.feed('ech": "Hello. ')
    emitted = streamer.feed('Second sentence here."')
    # Both sentences should reach us by the time the closing quote lands.
    flat = " ".join(emitted)
    assert "Hello." in flat
    assert "Second sentence here." in flat
