# update/ — living documentation

This folder is the canonical doc set for the LUMOS project. The matching
plain-named files at the repo root (`/PRD.md`, `/RULES.md`, `/ARCHITECTURE.md`,
`/TASKS.md`, `/TECH_STACK.md`, `/CODE_REVIEW_SUMMARY.md`, `/KNOWN_ISSUES.md`)
are **legacy v0.1 ClarityAI docs** — read them only for historical context.
The files in this folder supersede them.

## Where the build is right now

Backend is **code-complete through LUMOS Phase 6** (memory, validator,
classifier, persistence, sentence-level streaming TTS). Every external
dependency ships with a working in-process / file-backed fallback so the
gateway boots and round-trips without API keys, Redis, Postgres, or R2.
Activate live providers by setting one env var per layer — see
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) §"Flip a switch" matrix.

## Read in this order

1. [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — what this repo is and where every doc lives.
2. [`PRD.md`](PRD.md) — the product, in one page.
3. [`ARCHITECTURE.md`](ARCHITECTURE.md) — components shipped today + what each phase adds.
4. [`FEATURES.md`](FEATURES.md) — feature list, shipped vs pending.
5. [`TASKS.md`](TASKS.md) — phase tracker. Phases 0–6 done; post-MVP items remain.
6. [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — current state, env vars that activate live providers, post-MVP backlog.
7. [`TECH_STACK.md`](TECH_STACK.md) — installed deps + environment variables, present and future.
8. [`RULES.md`](RULES.md) — non-negotiable invariants (cite by number in PRs).
9. [`workflow.md`](workflow.md) — concrete user/device/backend flows shipping today.
10. [`AUDIT_2026-05-25.md`](AUDIT_2026-05-25.md) — the audit that triggered the v4 pivot, plus two completion addenda (Phase 0; Phases 2–6).

## Sub-folder

- [`changes/`](changes/) — the **immutable** LUMOS v4 spec. The build target. Files inside (`00_CHANGELOG.md`, `01_MASTER_PLAN.md`, `02_WORKFLOW.md`, `03_SYSTEM_PROMPTS_AND_INSTRUCTIONS.md`, `04_BACKEND_IMPLEMENTATION.md`, `05_DECISIONS_AND_COST.md`, `BACKEND_DESIGN.md`, `BACKEND_TODO.md`, `HARDWARE_CONTEXT.md`, `IMPLEMENTATION_AUTH_PAIRING.md`, `IMPLEMENTATION_WEBSOCKET.md`) are owned by the user. Everything that needs updating goes in the files above, not in `changes/`.

## What is *not* in this folder

- Code lives in [`../lumos-backend/`](../lumos-backend/), [`../firmware/`](../firmware/), [`../app/`](../app/).
- Hardware spec lives in [`changes/HARDWARE_CONTEXT.md`](changes/HARDWARE_CONTEXT.md).
- Auth/pairing wire format lives in [`changes/IMPLEMENTATION_AUTH_PAIRING.md`](changes/IMPLEMENTATION_AUTH_PAIRING.md).
- Frame protocol wire format lives in [`changes/IMPLEMENTATION_WEBSOCKET.md`](changes/IMPLEMENTATION_WEBSOCKET.md).
- Backend architecture rationale + latency budget lives in [`changes/BACKEND_DESIGN.md`](changes/BACKEND_DESIGN.md).
- Layer-by-layer build checklist lives in [`changes/BACKEND_TODO.md`](changes/BACKEND_TODO.md).
