"""Incremental JSON parser for the LLM stream.

The LLM emits a JSON object shaped::

    {"speech": "...", "display": {"kind": "...", "content": "..."}, "is_confident": 0.92}

Phase 6's TTFT win comes from streaming sentences of ``speech`` to the TTS
provider *while the LLM is still generating*. That requires extracting the
``speech`` field's value before the JSON closes.

This module ships a focused state-machine — it knows our exact schema and
is far easier to reason about than a general-purpose incremental JSON parser.

Usage::

    streamer = SpeechSentenceStreamer()
    async for delta in llm.stream(...):
        for sentence in streamer.feed(delta):
            await tts_queue.put(sentence)
    final_json = streamer.full_buffer()         # JSON-mode guarantees parseable
    reply = LlmReply.model_validate_json(final_json)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Iterable


_SENTENCE_END_RE = re.compile(r"[.!?](?:\s|$)")
SENTENCE_MIN_CHARS = 12        # avoid emitting "Hi." as its own TTS call
SENTENCE_FORCE_FLUSH_CHARS = 120  # cap on a run-on; flush even without punctuation


class _State(Enum):
    SCAN_KEY = auto()       # waiting for "speech":
    OPEN_QUOTE = auto()     # waiting for the opening " of the value
    IN_SPEECH = auto()      # accumulating chars; "/" escapes; closing " exits
    AFTER_SPEECH = auto()   # speech captured; just buffering the rest


_SPEECH_KEY_TOKEN = '"speech"'


@dataclass
class SpeechSentenceStreamer:
    """Stateful streaming JSON parser scoped to the ``speech`` field.

    Call ``feed(delta)`` repeatedly. It returns a list of *new* complete
    sentences to forward to TTS. Call ``full_buffer()`` after the stream
    ends to get the concatenated JSON for final parsing.
    """

    state: _State = _State.SCAN_KEY
    buffer: str = ""
    speech_buffer: str = ""
    sentence_cursor: int = 0
    speech_complete: bool = False
    _escape_next: bool = False
    _key_search_start: int = 0

    def feed(self, delta: str) -> list[str]:
        """Append ``delta`` to the buffer and return any newly-complete sentences."""
        self.buffer += delta

        # Advance the state machine until we run out of input to process.
        emitted: list[str] = []

        while True:
            consumed_progress = False

            if self.state == _State.SCAN_KEY:
                idx = self.buffer.find(_SPEECH_KEY_TOKEN, self._key_search_start)
                if idx == -1:
                    # Keep enough tail context so a token split mid-"speech" still matches.
                    self._key_search_start = max(0, len(self.buffer) - len(_SPEECH_KEY_TOKEN))
                    break
                self._key_search_start = idx + len(_SPEECH_KEY_TOKEN)
                self.state = _State.OPEN_QUOTE
                consumed_progress = True

            if self.state == _State.OPEN_QUOTE:
                # The next " after the key opens the value. Tolerate whitespace + colon.
                cursor = self._key_search_start
                # Find the next " in self.buffer after cursor.
                quote_idx = self.buffer.find('"', cursor)
                if quote_idx == -1:
                    break
                self._key_search_start = quote_idx + 1
                self.state = _State.IN_SPEECH
                consumed_progress = True

            if self.state == _State.IN_SPEECH:
                # Walk the buffer from _key_search_start, accumulating into
                # speech_buffer, honouring backslash escapes.
                i = self._key_search_start
                while i < len(self.buffer):
                    ch = self.buffer[i]
                    if self._escape_next:
                        self.speech_buffer += _unescape(ch)
                        self._escape_next = False
                        i += 1
                        continue
                    if ch == "\\":
                        self._escape_next = True
                        i += 1
                        continue
                    if ch == '"':
                        # Closing quote of the value.
                        self.speech_complete = True
                        self.state = _State.AFTER_SPEECH
                        self._key_search_start = i + 1
                        break
                    self.speech_buffer += ch
                    i += 1
                else:
                    # Loop fell through naturally (ran out of buffer mid-string).
                    self._key_search_start = i

                # Emit any newly-complete sentences.
                emitted.extend(self._emit_sentences(final=self.speech_complete))
                if not self.speech_complete:
                    break
                consumed_progress = True

            if self.state == _State.AFTER_SPEECH:
                # We're done; everything else lives in self.buffer for the
                # final parse. No more streaming work.
                break

            if not consumed_progress:
                break

        return emitted

    def _emit_sentences(self, *, final: bool) -> list[str]:
        """Slice ``self.speech_buffer[self.sentence_cursor:]`` at sentence
        boundaries and return any completed chunks. Updates ``sentence_cursor``.
        """
        tail = self.speech_buffer[self.sentence_cursor:]
        emitted: list[str] = []

        while tail:
            match = _SENTENCE_END_RE.search(tail)
            if match:
                end = match.end()
                chunk = tail[:end].strip()
                if chunk and len(chunk) >= SENTENCE_MIN_CHARS:
                    emitted.append(chunk)
                    self.sentence_cursor += end
                    tail = self.speech_buffer[self.sentence_cursor:]
                    continue
                # Skip too-short fragments (don't reset cursor; keep accumulating).
                break

            if len(tail) >= SENTENCE_FORCE_FLUSH_CHARS:
                # Run-on: force a flush at the last space within the cap.
                cutoff = tail.rfind(" ", 0, SENTENCE_FORCE_FLUSH_CHARS)
                if cutoff <= 0:
                    cutoff = SENTENCE_FORCE_FLUSH_CHARS
                emitted.append(tail[:cutoff].strip())
                self.sentence_cursor += cutoff
                tail = self.speech_buffer[self.sentence_cursor:]
                continue

            break

        if final:
            remaining = self.speech_buffer[self.sentence_cursor:].strip()
            if remaining:
                emitted.append(remaining)
                self.sentence_cursor = len(self.speech_buffer)

        return emitted

    def full_buffer(self) -> str:
        return self.buffer


def _unescape(ch: str) -> str:
    return {
        "n": "\n",
        "t": "\t",
        "r": "\r",
        '"': '"',
        "\\": "\\",
        "/": "/",
    }.get(ch, ch)
