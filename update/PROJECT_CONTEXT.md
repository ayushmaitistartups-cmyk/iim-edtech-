# LUMOS — Project context

Last updated: **2026-05-26**

## One-paragraph snapshot

LUMOS is a hardware-first Socratic tutor for Indian competitive-exam
students. A desk lamp with an ESP32-S3, OV5640 camera, INMP441 mic,
MAX98357A speaker, ILI9341 TFT, and WS2812B LED carries the entire
student-facing interaction. A FastAPI gateway ([`lumos-backend/`](../lumos-backend/))
terminates one persistent WebSocket per lamp and drives a single-call
multimodal pipeline: **Gemini 2.5 Flash** (audio + image → JSON `{speech,
display, is_confident}`) → validator + Gemini 2.5 Pro escalation when
confidence < 0.60 → **Cartesia Sonic-2 streaming TTS** + **matplotlib
mathtext LaTeX renderer** → TFT pixels. Short-term Redis history + long-term
vector memory feed back into every prompt. Each turn persists to a blob
store + ledger off the hot path. A minimal Next.js web app handles only
Clerk sign-in and lamp pairing. **Backend is code-complete through
Phase 6** (memory, validator, classifier, grounding, persistence,
streaming TTS) and runs against in-process / file-backed fallbacks until
real keys + infra land.

## Why this repo looks the way it does

This codebase started as **ClarityAI v0.1** — a browser-first Socratic
tutor with webcam OCR, browser STT/TTS, and Gemini 2.0. Through 2026 Q1
the team decided that competing for screen attention against TikTok and
Instagram was a losing game and pivoted to a desk lamp ("LUMOS v4"). The
v0.1 code has now been removed from the repo; what remains is the v4
foundation plus the full LLM brain. The historical phases are documented
in [`TASKS.md`](TASKS.md) §Archived for context.

## Canonical sources of truth

| Topic | Doc |
|---|---|
| Phase order + status | [`TASKS.md`](TASKS.md), [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) |
| LLM routing, prompts, cache layers | [`changes/01_MASTER_PLAN.md`](changes/01_MASTER_PLAN.md), [`changes/02_WORKFLOW.md`](changes/02_WORKFLOW.md), [`changes/03_SYSTEM_PROMPTS_AND_INSTRUCTIONS.md`](changes/03_SYSTEM_PROMPTS_AND_INSTRUCTIONS.md) |
| Backend architecture + latency design | [`changes/BACKEND_DESIGN.md`](changes/BACKEND_DESIGN.md) |
| Backend build checklist (Layers 0–11) | [`changes/BACKEND_TODO.md`](changes/BACKEND_TODO.md) |
| Costs + locked decisions | [`changes/05_DECISIONS_AND_COST.md`](changes/05_DECISIONS_AND_COST.md) |
| Hardware spec | [`changes/HARDWARE_CONTEXT.md`](changes/HARDWARE_CONTEXT.md) |
| Auth / pairing flow | [`changes/IMPLEMENTATION_AUTH_PAIRING.md`](changes/IMPLEMENTATION_AUTH_PAIRING.md) |
| Frame protocol | [`changes/IMPLEMENTATION_WEBSOCKET.md`](changes/IMPLEMENTATION_WEBSOCKET.md) |
| What's actually shipped today | [`FEATURES.md`](FEATURES.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`workflow.md`](workflow.md) |
| Audit baseline + completion addenda | [`AUDIT_2026-05-25.md`](AUDIT_2026-05-25.md) |

## Folder map

```
.github/                GitHub Actions workflows (CI)
.husky/                 Pre-commit / post-commit git hooks
app/                    Next.js 14 web app (pairing + account; no tutoring UI)
  (auth)/sign-in/       Clerk sign-in page (redirects to /devices)
  (auth)/sign-up/       Clerk sign-up page (redirects to /devices)
  api/webhooks/clerk/   Clerk → Supabase user sync webhook
  devices/              List + rename + unlink lamps
  pair/[code]/          Claim a pairing code while signed in
  layout.tsx            Root layout with ClerkProvider + ErrorBoundary
  page.tsx              Landing page ("Sign in" / "Manage my lamps")
  globals.css           Tailwind base styles
components/             AppHeader.tsx, ErrorBoundary.tsx
lib/                    constants.ts, supabase.ts (server-only), useApi.ts (Clerk-bearer fetch)
firmware/
  tutor_lamp/           ESP32-S3 LUMOS firmware
  legacy/               ESP32-CAM v0.1 firmware (kept for reference only)
lumos-backend/          FastAPI gateway — code-complete through Phase 6
  main.py               App composition, dotenv, dependency wiring, LaTeX boot self-test
  requirements.txt      FastAPI, uvicorn, google-genai, cartesia, matplotlib, pydantic
  app/
    config.py           Frozen-dataclass settings (env-driven, all phases)
    logging.py          Structured logging setup
    protocol.py         13-type binary frame codec, incl. IMAGE_PART + TFT_PART chunking
    session.py          Session + Turn per-lamp state, in-flight task ownership
    schemas.py          Pydantic LlmReply {speech, display{kind, content}, is_confident}
    prompts.py          Gemini system prompt with LaTeX-subset warning
    providers/
      llm_gemini.py     GeminiLLM (Flash + Pro escalation factory) + MockLLM
      tts_cartesia.py   CartesiaTTS + MockTTS, 4 KB / 85 ms chunked streaming
      latex_renderer.py matplotlib mathtext → 320×240 RGB565 BE pixels + scroll
    services/
      orchestrator.py   run_turn pipeline, asyncio.gather(speak, display)
      memory.py         Short-term history (Phase 2): LPUSH/LTRIM + render
      validator.py      Output guardrails + confidence gate (Phase 3)
      classifier.py     Exam-track + grounding heuristic (Phase 4)
      persistence.py    Off-hot-path commit_turn (Phase 5)
      streaming_parser.py Incremental JSON parser for sentence-level TTS (Phase 6)
    routes/
      ws_lamp.py        /lamp/ws dispatcher (incl. IMAGE_PART / TFT_PART)
      pairing.py        7 REST endpoints (auth-gated)
      health.py         /healthz + /readyz (active provider names)
    auth/
      device_jwt.py     HS256 device JWT (iss=lumos-auth, ver=1)
      devices.py        File-backed device registry
    storage/
      redis_client.py   Async Redis client + MemoryRedis fallback (Phase 2)
      vector_memory.py  Per-user JSONL store + cosine ANN (Phase 4)
      blobs.py          LocalBlobs (default) + S3Blobs (Phase 5)
      turns_repo.py     JSONL turns ledger (Phase 5)
  scripts/
    mock_lamp.py        Dev tool: pretends to be an ESP32, dumps inbound frames
  tests/                66 pytest cases (all 6 phases)
  blobs/                Local-blob output (.gitignored)
  turns/                Local turns ledger output (.gitignored)
  memories/             Per-user vector memory store (.gitignored)
supabase/
  migrations/           001 (legacy chat) + 002 (devices, topics, mastery, pgvector)
update/                 Living docs (this folder) — see README.md for read order
update/changes/         Immutable LUMOS v4 spec — owned by the user
middleware.ts           Clerk auth middleware (gates /devices and /pair)
next.config.mjs         Next.js config
tailwind.config.ts      Tailwind config (typography plugin removed in Phase 0)
tsconfig.json           TypeScript strict-mode config
.env.example            Stale — still references v0.1 vars; see TECH_STACK.md for the current contract
package.json            Web app deps (trimmed in Phase 0)
backend/                Empty leftover folder — Windows handle lock prevented deletion; safe to remove on next clean checkout
```

The plain-named files at the repo root (`PRD.md`, `ARCHITECTURE.md`, `TASKS.md`,
`TECH_STACK.md`, `RULES.md`, `CODE_REVIEW_SUMMARY.md`, `KNOWN_ISSUES.md`,
`README.md`) are **stale v0.1 ClarityAI docs**. The matching files inside this
`update/` folder supersede them. They will be deleted in a future cleanup pass
once they're no longer linked from any CI or external bookmark.

## People & accounts (placeholder)

To be filled in as the team grows. Hardware lead, backend lead, ML lead, and
go-to-market owner expected; for now everything is driven through this repo.
