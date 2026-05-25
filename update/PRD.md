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
- **Conceptual** (UPSC, CAT, SSC) — plain text on the TFT, cause-effect bullets, current-affairs grounding.

## Pillars

1. **Hardware** — ESP32-S3 lamp with OV5640 camera, INMP441 mic, MAX98357A speaker, ILI9341 TFT, WS2812B status LED. See [`changes/HARDWARE_CONTEXT.md`](changes/HARDWARE_CONTEXT.md).
2. **Gateway** — `lumos-backend/` (FastAPI + WebSocket) holds the one persistent `/lamp/ws` per lamp and routes turns through the orchestrator.
3. **Tutor** — Two-LLM pipeline: Gemini 2.5 Flash generates a Model Solution Memory (MSM) on Turn 1; Groq Llama 3.3 70B handles cheap nudges on Turn 2+. Gemini 2.5 Pro escalation on low confidence. *See [`changes/01_MASTER_PLAN.md`](changes/01_MASTER_PLAN.md) for the phase-by-phase build order.*
4. **Memory** — Per-student MSM cache in Redis (in-session) and pgvector memories in Postgres (cross-session). Phase 5.

## Latency budget

- Turn 1 (wake → first speaker audio): <1.5 s target, 2.5 s max.
- Turn 2+: <500 ms speech-end → first audio.
- Heartbeat (PING/PONG): every 10 s.

## Cost guardrails

Per-turn target ~$0.0004 (Turn 1) / ~$0.000002 (Turn 2+). A 4-attempt session
averages ~$0.0004, leaving comfortable margin against a ₹299–₹499/month plan.
See [`changes/05_DECISIONS_AND_COST.md`](changes/05_DECISIONS_AND_COST.md).

## What we are NOT building

- Browser-first tutoring (was v0.1; deleted 2026-05-26).
- Self-hosted LLMs.
- A general chatbot. LUMOS only tutors competitive-exam content; off-topic queries get a polite redirect.

## Source of truth

For LLM routing, prompts, cache layers, and frame protocol details, defer to
[`update/changes/`](changes/) — that folder is the living spec. This PRD is
the elevator-pitch summary.
