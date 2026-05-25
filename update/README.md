# update/ — living documentation

This folder is the canonical doc set for the LUMOS project. The matching
plain-named files at the repo root (`/PRD.md`, `/RULES.md`, `/ARCHITECTURE.md`,
`/TASKS.md`, `/TECH_STACK.md`, `/CODE_REVIEW_SUMMARY.md`, `/KNOWN_ISSUES.md`)
are **legacy v0.1 ClarityAI docs** — read them only for historical context.
The files in this folder supersede them.

## Read in this order

1. [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — what this repo is and where every doc lives.
2. [`PRD.md`](PRD.md) — the product, in one page.
3. [`ARCHITECTURE.md`](ARCHITECTURE.md) — components shipped today + what each phase adds.
4. [`FEATURES.md`](FEATURES.md) — feature list with status, phase-by-phase.
5. [`TASKS.md`](TASKS.md) — phase tracker (v0.1 archived; LUMOS Phase 0 done).
6. [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — the next chunk of work (currently: Phase 1).
7. [`TECH_STACK.md`](TECH_STACK.md) — installed deps + environment variables, present and future.
8. [`RULES.md`](RULES.md) — non-negotiable invariants (cite by number in PRs).
9. [`workflow.md`](workflow.md) — concrete user/device/backend flows shipping today.
10. [`AUDIT_2026-05-25.md`](AUDIT_2026-05-25.md) — the audit that triggered the v4 pivot, plus a Phase 0 completion addendum.

## Sub-folder

- [`changes/`](changes/) — the **immutable** LUMOS v4 spec from the design phase. Do not edit; it is the contract that Phases 1–6 implement. Anything that needs updating goes in the files above, not in `changes/`.

## What is *not* in this folder

- Code lives in [`../lumos-backend/`](../lumos-backend/), [`../firmware/`](../firmware/), [`../app/`](../app/).
- Hardware spec lives in [`changes/HARDWARE_CONTEXT.md`](changes/HARDWARE_CONTEXT.md).
- Auth/pairing wire format lives in [`changes/IMPLEMENTATION_AUTH_PAIRING.md`](changes/IMPLEMENTATION_AUTH_PAIRING.md).
- Frame protocol wire format lives in [`changes/IMPLEMENTATION_WEBSOCKET.md`](changes/IMPLEMENTATION_WEBSOCKET.md).
