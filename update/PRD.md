# LUMOS — Product Requirements

## What it is

LUMOS is a Socratic tutor that lives on a student's desk as a lamp, not in a
browser. The lamp listens for a wake word, captures the page the student is
working on, and asks guiding questions — never the answer. The web app exists
only to pair lamps and manage the account behind them.

## Why a lamp, not an app

A browser tutor competes with TikTok, Instagram, and YouTube on the same
screen. A desk lamp doesn't. By moving the interaction surface off the phone,
the student stays in study mode, and the parent sees a single physical object
that justifies the subscription.

## Who it's for

Indian competitive-exam aspirants (JEE, NEET, GATE, UPSC, CAT, SSC). Two
exam tracks shape the response format:

- **Technical** (JEE, GATE, NEET) — LaTeX on the TFT, FBD descriptions, strict derivations.
- **Conceptual** (UPSC, CAT, SSC) — plain text on the TFT, cause-effect bullets, Google Search grounding for current affairs.

## Pillars

1. **Hardware** — ESP32-S3 lamp with OV5640 camera, INMP441 mic, MAX98357A speaker, ILI9341 TFT, WS2812B status LED. See [`changes/HARDWARE_CONTEXT.md`](changes/HARDWARE_CONTEXT.md).
2. **Gateway** — `lumos-backend/` (FastAPI + WebSocket) holds the one persistent `/lamp/ws` per lamp and routes every turn through the orchestrator.
3. **Tutor** — **One multimodal Gemini 2.5 Flash call** per turn carrying audio (WAV) + image (JPEG) + history → JSON `{speech, display, is_confident}`. No STT step. Low-confidence replies escalate to Gemini 2.5 Pro. Output is validated against the LaTeX subset and length caps before it ships to the lamp.
4. **Memory** — Short-term: last 3 turns per lamp in Redis (or in-process fallback). Long-term: per-user pgvector recall (or file-backed cosine fallback) prepended to every call. Each completed turn is persisted to the blob store (audio WAV + image JPEG) and a turns ledger.

(The earlier "Turn 1 / Turn 2+ split with Groq" plan from v3 was simplified to a single multimodal call in [`changes/BACKEND_DESIGN.md`](changes/BACKEND_DESIGN.md). One round-trip is faster, cheaper, and easier to reason about.)

## Latency budget

- Wake-word → AUDIO_END buffered at backend: ~150 ms (persistent WSS, chunked audio).
- AUDIO_END → first LLM token: 400–700 ms (Gemini 2.5 Flash multimodal).
- First sentence ready → first TTS chunk (with `STREAMING_TTS=1`): +150 ms.
- First TTS chunk → speaker: +100 ms.
- **End-to-end target: <1.5 s; ceiling 2.5 s.**

## Cost guardrails

Per-turn target ~$0.0008 (Gemini Flash audio + image + 80 output tokens; +
Cartesia for ~25 s of speech). 50 turns/day per lamp ≈ ₹100/month in API cost.
₹299–₹499/month subscription leaves a 60–75 % gross margin.
See [`changes/05_DECISIONS_AND_COST.md`](changes/05_DECISIONS_AND_COST.md).

## What we are NOT building

- Browser-first tutoring (was v0.1; deleted 2026-05-26).
- Self-hosted LLMs (latency advantage doesn't pay back for single-user lamps).
- A general chatbot. LUMOS only tutors competitive-exam content; off-topic queries get a polite redirect.
- Separate STT step (Gemini accepts raw audio natively).

## Source of truth

For LLM routing, prompts, cache layers, and frame protocol details, defer to
[`update/changes/`](changes/) — that folder is the immutable spec. This PRD is
the elevator-pitch summary. The currently-running implementation maps to it
file-for-file; see [`ARCHITECTURE.md`](ARCHITECTURE.md).
