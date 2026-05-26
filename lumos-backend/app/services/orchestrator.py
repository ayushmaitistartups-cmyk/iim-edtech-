"""The turn pipeline — one function, one async path, no queues in hot path.

Lifecycle::

    AUDIO_END inbound → Session.snapshot_and_reset_turn()
                       │
                       ▼
                  run_turn(session, image_bytes, audio_pcm)
                       │
                       ├── STATE(thinking) + TFT_TEXT("Thinking…")
                       ├── LLM stream → JSON buffer → LlmReply.parse
                       ├── STATE(speaking)
                       ├── asyncio.gather(speak_and_stream, push_display)
                       │     • TTS provider emits 4 KB / 85 ms paced AUDIO_OUT
                       │     • LaTeX renderer pre-rasterises, chunked TFT_FRAME
                       └── STATE(idle)

The two output legs run in PARALLEL because the lamp dispatches frames by
type — AUDIO_OUT goes to the I2S ring, TFT_PART/TFT_FRAME accumulate in
PSRAM. Sequential sends starve the speaker on multi-MB LaTeX payloads.
Reference: ``BACKEND_DESIGN.md §6 item #17`` + ``BACKEND_TODO.md §6.5``.
"""

from __future__ import annotations

import asyncio
import logging
import time

from ..config import settings
from ..protocol import DeviceState, FrameType, encode
from ..providers import latex_renderer
from ..providers.llm_gemini import LLMError, get_llm
from ..providers.tts_cartesia import TTSError, get_tts
from ..schemas import FALLBACK_REPLY, LlmReply
from ..services import memory, persistence
from ..services.classifier import classify_turn
from ..services.streaming_parser import SpeechSentenceStreamer
from ..services.validator import validate
from ..session import Session
from ..storage import turns_repo, vector_memory
from ..formatting.track_router import route_track
from ..formatting.voice_cleaner import clean_voice
from ..providers.llm_groq import get_groq_llm
from ..services import bao
from ..services import nudge_logic


logger = logging.getLogger(__name__)


_llm = get_llm()
_llm_pro = None  # lazily constructed on first escalation
_tts = get_tts()
_groq_llm = get_groq_llm()


def _get_pro_llm():
    """Return a Gemini 2.5 Pro client for confidence escalation.

    Reuses the configured key; only the model name differs.
    """
    global _llm_pro
    if _llm_pro is None:
        _llm_pro = get_llm(model=settings.gemini_pro_model)
    return _llm_pro


def reset_providers_for_testing() -> None:
    """Force a re-read of the env-driven providers (used by pytest fixtures)."""
    global _llm, _llm_pro, _tts, _groq_llm
    _llm = get_llm()
    _llm_pro = None
    _tts = get_tts()
    _groq_llm = get_groq_llm()


async def _speak_and_stream(session: Session, text: str) -> None:
    """Emit STATE(speaking) → AUDIO_OUT* → AUDIO_OUT_END → STATE(idle)."""
    try:
        async for chunk in _tts.stream(text):
            await session.send_audio_chunk(chunk)
    except asyncio.CancelledError:
        raise
    except TTSError as exc:
        logger.error("TTS stream failed: %s", exc)
    finally:
        try:
            await session.send_audio_end()
        except Exception:
            pass


async def _push_display(session: Session, reply: LlmReply) -> None:
    """Render the display leg. Sends a small ``TFT_TEXT`` immediately to
    flip the lamp's page off "Thinking…", then (if kind=="latex") streams
    the chunked TFT_FRAME pixels in the background."""

    if reply.display.kind == "none":
        await session.send_clear()
        return

    if reply.display.kind == "text":
        await session.send_text(reply.display.content)
        return

    # kind == "latex": send a short text hint first (kills the "spinner during
    # audio" UX gap), then push the rendered pixels.
    snippet = reply.display.content[:200]
    await session.send_text(snippet)

    loop = asyncio.get_event_loop()
    # matplotlib is sync and ~0.5 s; off-load to a thread so the audio leg
    # gets first crack at the WS.
    rendered = await loop.run_in_executor(None, latex_renderer.render, reply.display.content)
    if rendered is None:
        logger.info("LaTeX render returned None; staying on TFT_TEXT")
        return
    await session.send_tft_frame_chunked(rendered.to_wire_payload())


async def _consume_llm_stream(
    session: Session,
    image_bytes: bytes,
    audio_pcm: bytes,
    history_text: str = "",
    enable_grounding: bool = False,
    llm=None,
    sentence_queue: "asyncio.Queue[str | None] | None" = None,
) -> str:
    """Concatenate the LLM stream into a single JSON buffer.

    When ``sentence_queue`` is provided, also feed each newly-complete
    sentence of the ``speech`` field into the queue as it streams — that's
    how Phase 6 starts TTS while the LLM is still generating.
    """
    client = llm or _llm
    buf_parts: list[str] = []
    started = time.monotonic()
    first_token_at: float | None = None
    parser = SpeechSentenceStreamer() if sentence_queue is not None else None

    try:
        async for delta in client.stream(
            image_bytes=image_bytes,
            audio_pcm=audio_pcm,
            history_text=history_text,
            enable_grounding=enable_grounding,
        ):
            if first_token_at is None:
                first_token_at = time.monotonic()
                logger.info(
                    "device=%s ttft_ms=%d model=%s history_chars=%d grounding=%s",
                    session.device_id,
                    int((first_token_at - started) * 1000),
                    client.name,
                    len(history_text),
                    enable_grounding,
                )
            buf_parts.append(delta)
            if parser is not None and sentence_queue is not None:
                for sentence in parser.feed(delta):
                    await sentence_queue.put(sentence)
    finally:
        if sentence_queue is not None:
            await sentence_queue.put(None)  # sentinel: no more sentences coming

    total_ms = int((time.monotonic() - started) * 1000)
    logger.info("device=%s llm_total_ms=%d model=%s", session.device_id, total_ms, client.name)
    return "".join(buf_parts)


async def _speak_streaming(session: Session, sentence_queue: "asyncio.Queue[str | None]") -> None:
    """Drain the sentence queue, calling TTS on each one and forwarding the
    audio chunks immediately. Stops on the ``None`` sentinel."""
    try:
        first = True
        while True:
            sentence = await sentence_queue.get()
            if sentence is None:
                break
            if first:
                await session.send_state(DeviceState.SPEAKING)
                first = False
            try:
                async for chunk in _tts.stream(sentence):
                    await session.send_audio_chunk(chunk)
            except TTSError as exc:
                logger.error("streaming TTS failed for sentence: %s", exc)
    except asyncio.CancelledError:
        raise
    finally:
        try:
            await session.send_audio_end()
        except Exception:
            pass


async def run_turn(session: Session, image_bytes: bytes, audio_pcm: bytes) -> None:
    """Drive one turn end-to-end. Cancelable; CANCEL frame on inbound side
    cancels the whole tree via ``session.cancel_inflight()``."""

    started = time.monotonic()
    asked_at_wall = time.time()
    turn_id = turns_repo.new_turn_id()
    duration_s = len(audio_pcm) / 2 / 16000
    logger.info(
        "device=%s turn=%s start: image=%d B audio=%.2fs",
        session.device_id,
        turn_id,
        len(image_bytes),
        duration_s,
    )

    if duration_s < settings.audio_min_seconds:
        logger.warning("device=%s audio too short (%.2fs); dropping turn", session.device_id, duration_s)
        await session.send_text("That was a bit too short — try again?")
        return
    if duration_s > settings.audio_max_seconds:
        logger.warning("device=%s audio too long (%.2fs); dropping turn", session.device_id, duration_s)
        await session.send_text("Whoa, that's a lot — could you summarise the question?")
        return

    await session.send_state(DeviceState.THINKING)
    await session.send_text("Thinking…")

    # ---- Short-term memory (Phase 2) ---------------------------------
    history = await memory.get_recent_turns(session.device_id)
    history_text = memory.render_history_for_prompt(history)

    # ---- Phase 4: current-turn classifier + grounding gate -----------
    history_corpus = " ".join(t.speech for t in history)
    classification = await classify_turn(
        image_bytes=image_bytes,
        audio_pcm=audio_pcm,
        history_text=history_text,
    )
    enable_grounding = classification.needs_grounding
    route_lines = [
        "Current-turn routing:",
        (
            f"- exam_track={classification.exam_track}; exam_type={classification.exam_type}; "
            f"subject={classification.subject}; query_type={classification.query_type}; "
            f"difficulty={classification.difficulty}; needs_grounding={classification.needs_grounding}"
        ),
    ]
    if classification.exam_track == "conceptual":
        route_lines.append("- Display rule: use display.kind='text' only; no LaTeX.")
    elif classification.exam_track == "technical":
        route_lines.append("- Display rule: prefer display.kind='latex' for equations and formulas.")
    route_hint = "\n".join(route_lines)
    history_text = history_text + ("\n" if history_text else "") + route_hint

    recall_query = history_corpus or f"{classification.subject} {classification.query_type}"
    long_term = await vector_memory.recall(session.user_id, query=recall_query or "current question")
    if long_term:
        history_text = (
            history_text
            + ("\n" if history_text else "")
            + vector_memory.render_recall_for_prompt(long_term)
        )
    logger.info(
        "device=%s classifier=%s grounding=%s long_term=%d",
        session.device_id,
        classification.rationale,
        enable_grounding,
        len(long_term),
    )

    # ---- BAO Framework: Turn 1 vs Turn 2+ -----------------------------
    # 1. Transcribe the audio first (we need this to compare hash AND for Groq)
    transcript = await _groq_llm.transcribe(audio_pcm)
    logger.info("device=%s transcript: %s", session.device_id, transcript)
    
    # 2. Detect Question Hash & MSM
    question_hash = await bao.detect_question_hash(session.device_id, transcript)
    attempt_count = await bao.get_or_increment_attempt(session.device_id, question_hash)
    msm_text = await bao.get_msm(session.device_id, question_hash)
    
    is_turn_1 = (msm_text is None)

    streaming_speak_task: asyncio.Task | None = None
    sentence_queue: "asyncio.Queue[str | None] | None" = None
    if settings.streaming_tts:
        sentence_queue = asyncio.Queue()
        streaming_speak_task = asyncio.create_task(
            _speak_streaming(session, sentence_queue),
            name=f"speak-streaming-{session.device_id}",
        )

    reply = FALLBACK_REPLY
    if is_turn_1:
        logger.info("device=%s BAO: Turn 1 (Gemini)", session.device_id)
        try:
            json_buf = await asyncio.wait_for(
                _consume_llm_stream(
                    session,
                    image_bytes,
                    audio_pcm,
                    history_text,
                    enable_grounding=enable_grounding,
                    sentence_queue=sentence_queue,
                ),
                timeout=settings.llm_total_timeout_s + 1.0,
            )
            reply = LlmReply.model_validate_json(json_buf)
            if reply.master_solution:
                await bao.save_msm(session.device_id, question_hash, reply.master_solution)
        except asyncio.TimeoutError:
            logger.error("device=%s LLM timeout", session.device_id)
        except LLMError as exc:
            logger.error("device=%s LLM error: %s", session.device_id, exc)
        except asyncio.CancelledError:
            await session.send_state(DeviceState.IDLE)
            raise
        except Exception as exc:
            logger.error("device=%s LLM JSON parse failed (%s)", session.device_id, exc)
    else:
        logger.info("device=%s BAO: Turn 2+ (Groq) attempt=%d", session.device_id, attempt_count)
        nudge_level = nudge_logic.determine_nudge_level(
            attempt_count=attempt_count,
            query_type=classification.query_type,
            difficulty=classification.difficulty,
            time_spent_s=0, # Need cross-turn time tracking for this
            student_level="intermediate"
        )
        nudge_instruction = nudge_logic.get_nudge_instruction(nudge_level)
        
        try:
            # We don't currently support streaming parse into the sentence_queue for Groq
            # because we don't have a `_consume_groq_stream` yet, but let's just 
            # consume it into a buffer and parse it for now.
            buf_parts = []
            started = time.monotonic()
            parser = SpeechSentenceStreamer() if sentence_queue is not None else None
            
            async for delta in _groq_llm.stream(
                history_text=history_text,
                msm_text=msm_text,
                nudge_instruction=nudge_instruction
            ):
                buf_parts.append(delta)
                if parser is not None and sentence_queue is not None:
                    for sentence in parser.feed(delta):
                        await sentence_queue.put(sentence)
            
            if sentence_queue is not None:
                await sentence_queue.put(None)
                
            json_buf = "".join(buf_parts)
            reply = LlmReply.model_validate_json(json_buf)
        except asyncio.TimeoutError:
            logger.error("device=%s Groq timeout", session.device_id)
            if sentence_queue: await sentence_queue.put(None)
        except LLMError as exc:
            logger.error("device=%s Groq error: %s", session.device_id, exc)
            if sentence_queue: await sentence_queue.put(None)
        except asyncio.CancelledError:
            await session.send_state(DeviceState.IDLE)
            raise
        except Exception as exc:
            logger.error("device=%s Groq parse failed (%s)", session.device_id, exc)
            if sentence_queue: await sentence_queue.put(None)

    # ---- Phase 3: validator + escalation ------------------------------
    is_fallback_reply = reply == FALLBACK_REPLY
    validated = validate(reply, exam_track=classification.exam_track)
    reply = validated.reply

    # Apply track routing rules
    reply, route_issues = route_track(reply, classification.exam_track)
    validated.issues.extend(route_issues)
    
    # Ensure speech is clean for non-streaming paths
    reply.speech = clean_voice(reply.speech)

    if validated.confidence_after < settings.confidence_escalate_below and not is_fallback_reply:
        logger.info(
            "device=%s escalating to %s (confidence=%.2f issues=%s)",
            session.device_id,
            settings.gemini_pro_model,
            validated.confidence_after,
            validated.issues,
        )
        try:
            pro_buf = await asyncio.wait_for(
                _consume_llm_stream(
                    session,
                    image_bytes,
                    audio_pcm,
                    history_text,
                    llm=_get_pro_llm(),
                    enable_grounding=enable_grounding,
                ),
                timeout=settings.llm_total_timeout_s + 1.0,
            )
            pro_reply = LlmReply.model_validate_json(pro_buf)
            reply = validate(pro_reply, exam_track=classification.exam_track).reply
        except asyncio.CancelledError:
            await session.send_state(DeviceState.IDLE)
            raise
        except Exception as exc:
            logger.warning("device=%s escalation failed (%s); keeping Flash reply", session.device_id, exc)
    elif validated.confidence_after < settings.confidence_review_below:
        logger.info(
            "device=%s review-zone confidence=%.2f issues=%s — shipping anyway",
            session.device_id,
            validated.confidence_after,
            validated.issues,
        )

    # ---- Speak + display ----------------------------------------------
    try:
        if streaming_speak_task is not None:
            # The speak leg has already been running since the first LLM token.
            # Wait for it to finish draining the queue, then push display.
            await asyncio.gather(
                streaming_speak_task,
                _push_display(session, reply),
            )
        else:
            await session.send_state(DeviceState.SPEAKING)
            await asyncio.gather(
                _speak_and_stream(session, reply.speech),
                _push_display(session, reply),
            )
    except asyncio.CancelledError:
        if streaming_speak_task is not None and not streaming_speak_task.done():
            streaming_speak_task.cancel()
        raise
    finally:
        await session.send_state(DeviceState.IDLE)

    # ---- Persist to short-term memory (Phase 2) ------------------------
    asyncio.create_task(
        memory.record_turn(session.device_id, reply.speech, reply.display.kind),
        name=f"memory-{session.device_id}",
    )
    # ---- Phase 4: persist to long-term vector memory -------------------
    asyncio.create_task(
        vector_memory.remember(session.user_id, reply.speech, kind="qa"),
        name=f"vector-{session.user_id}",
    )

    total_ms = int((time.monotonic() - started) * 1000)
    logger.info("device=%s turn=%s done in %d ms", session.device_id, turn_id, total_ms)

    # ---- Phase 5: persist artefacts + ledger row (off the hot path) ----
    asyncio.create_task(
        persistence.commit_turn(
            turn_id=turn_id,
            device_id=session.device_id,
            user_id=session.user_id,
            asked_at=asked_at_wall,
            image_bytes=image_bytes,
            audio_pcm=audio_pcm,
            reply=reply,
            llm_model=_llm.name,
            total_ms=total_ms,
            issues=list(validated.issues),
        ),
        name=f"persist-{turn_id}",
    )


__all__ = ["run_turn", "reset_providers_for_testing"]


# Silence ``F401`` — encode/FrameType are re-exported for tests that
# build raw frames against the orchestrator.
_ = (encode, FrameType)
