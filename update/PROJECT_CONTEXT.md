# LUMOS — Project context

Last updated: **2026-05-26**

## One-paragraph snapshot

LUMOS is a hardware-first Socratic tutor for Indian competitive-exam
students. A desk lamp with an ESP32-S3, camera, mic, speaker, and small
TFT carries the entire student-facing interaction. A FastAPI gateway
([`lumos-backend/`](../lumos-backend/)) holds one persistent WebSocket per
lamp and orchestrates an LLM stack (Gemini 2.5 Flash → Groq Llama 3.3 70B
→ Gemini Pro escalation) that arrives in Phases 1–4. A minimal Next.js
web app handles only Clerk sign-in and lamp pairing. Phase 0 (transport
+ pairing + firmware skeleton) shipped on 2026-05-26.

## Why this repo looks the way it does

This codebase started as **ClarityAI v0.1** — a browser-first Socratic
tutor with webcam OCR, browser STT/TTS, and Gemini 2.0. Through 2026 Q1
the team decided that competing for screen attention against TikTok and
Instagram was a losing game and pivoted to a desk lamp ("LUMOS v4"). The
v0.1 code has now been removed from the repo; what remains is the v4
foundation. The historical phases are documented in
[`TASKS.md`](TASKS.md) §Archived for context.

## Canonical sources of truth

| Topic | Doc |
|---|---|
| Phase order + status | [`TASKS.md`](TASKS.md), [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) |
| LLM routing, prompts, cache layers | [`changes/01_MASTER_PLAN.md`](changes/01_MASTER_PLAN.md), [`changes/02_WORKFLOW.md`](changes/02_WORKFLOW.md), [`changes/03_SYSTEM_PROMPTS_AND_INSTRUCTIONS.md`](changes/03_SYSTEM_PROMPTS_AND_INSTRUCTIONS.md) |
| Backend module map | [`changes/04_BACKEND_IMPLEMENTATION.md`](changes/04_BACKEND_IMPLEMENTATION.md) |
| Costs + locked decisions | [`changes/05_DECISIONS_AND_COST.md`](changes/05_DECISIONS_AND_COST.md) |
| Hardware spec | [`changes/HARDWARE_CONTEXT.md`](changes/HARDWARE_CONTEXT.md) |
| Auth / pairing flow | [`changes/IMPLEMENTATION_AUTH_PAIRING.md`](changes/IMPLEMENTATION_AUTH_PAIRING.md) |
| Frame protocol | [`changes/IMPLEMENTATION_WEBSOCKET.md`](changes/IMPLEMENTATION_WEBSOCKET.md) |
| What's actually shipped today | [`FEATURES.md`](FEATURES.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Audit baseline | [`AUDIT_2026-05-25.md`](AUDIT_2026-05-25.md) |

## Folder map

```
.github/             GitHub Actions workflows (CI)
.husky/              Pre-commit / post-commit git hooks
app/                 Next.js 14 web app
  (auth)/sign-in/    Clerk sign-in page
  (auth)/sign-up/    Clerk sign-up page
  api/webhooks/clerk/ Clerk → Supabase user sync webhook
  devices/           List + rename + unlink lamps
  pair/[code]/       Claim a pairing code while signed in
  layout.tsx         Root layout with ClerkProvider + ErrorBoundary
  page.tsx           Landing page ("Sign in" / "Manage my lamps")
  globals.css        Tailwind base styles
components/          AppHeader.tsx, ErrorBoundary.tsx
lib/                 constants.ts, supabase.ts (server-only), useApi.ts (Clerk-bearer fetch wrapper)
firmware/
  tutor_lamp/        ESP32-S3 LUMOS firmware (Phase 0)
  legacy/            ESP32-CAM v0.1 firmware (kept for reference only)
lumos-backend/       FastAPI gateway (Phase 0)
  main.py            App composition + dependency wiring
  requirements.txt   Slim deps (FastAPI, uvicorn, websockets, pydantic, pytest)
  gateway/           websocket.py, auth.py, pairing.py, session.py
  schemas/           frames.py (binary frame codec)
  storage/           devices.py (file-backed registry)
  tests/             5 pytest files, 15 tests
supabase/
  migrations/        001 (legacy chat) + 002 (devices, topics, mastery, pgvector)
update/              Living docs (this folder) — see README.md for the read order
update/changes/      Immutable LUMOS v4 spec — do not edit
middleware.ts        Clerk auth middleware (gates /devices and /pair)
next.config.mjs      Next.js config
tailwind.config.ts   Tailwind config (typography plugin removed in Phase 0)
tsconfig.json        TypeScript strict-mode config
.env.example         Stale — still references v0.1 vars; see TECH_STACK.md for the current contract
package.json         Web app deps (trimmed in Phase 0)
backend/             Empty leftover folder — Windows handle lock prevented deletion; safe to remove on next clean checkout
```

The plain-named files at the repo root (`PRD.md`, `ARCHITECTURE.md`, `TASKS.md`,
`TECH_STACK.md`, `RULES.md`, `CODE_REVIEW_SUMMARY.md`, `KNOWN_ISSUES.md`,
`README.md`) are **stale v0.1 ClarityAI docs**. The matching files inside this
`update/` folder supersede them. They will be deleted in a future cleanup pass
once they're no longer linked from any CI or external bookmark.

## People & accounts (placeholder)

To be filled in as the team grows. Hardware lead, backend lead, ML lead, and
go-to-market owner expected; for now everything is driven through this repo.
