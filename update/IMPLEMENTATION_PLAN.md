# LUMOS — Implementation plan

The canonical phase-by-phase build order lives in
[`changes/01_MASTER_PLAN.md`](changes/01_MASTER_PLAN.md). This file tracks the
*current state* against that plan and the next concrete chunk of work.

## Where we are (2026-05-26)

- **Phase 0 — Foundation: Done.** Gateway, device JWT, binary frames, ESP32-S3 firmware, web-app deprecation, schema baseline.
- **Phase 1 — Turn 1 core: not started.**

## Phase 1 — next up

Targets the multimodal Turn 1 path so a paired lamp can answer one question.

### Build order

1. **Redis client** — `lumos-backend/storage/redis_client.py` (Upstash REST or async `redis-py`); add `REDIS_URL` to env contract.
2. **Cache manager** — `lumos-backend/providers/cache_manager.py` implementing Gemini context caching Layers 1 (global, 3600 s), 2 (student profile, 1800 s), 3 (MSM, 1800 s) per [`changes/02_WORKFLOW.md`](changes/02_WORKFLOW.md) §Turn 1.
3. **Gemini client** — `lumos-backend/providers/llm_gemini.py` wrapping Gemini 2.5 Flash + escalation to Gemini 2.5 Pro on `is_confident < 0.60`.
4. **Query classifier** — `lumos-backend/classifiers/query_classifier.py` (Gemini Flash, text-only, ~100 ms) emitting `{ type, difficulty, subject, exam_type, exam_track, needs_grounding }`.
5. **MSM generator** — orchestrator step in `lumos-backend/orchestrator/turn_handler.py` that produces the Model Solution Memory and persists it to Redis (`model_answer:{session_id}:{q_hash}`).
6. **Turn 1 nudge prompt** — `lumos-backend/prompts/turn1_system.py` with technical / conceptual modules toggled by `exam_track`.
7. **Validator stub** — strip markdown + LaTeX-syntax check + voice/TFT length caps (full implementation in Phase 4).
8. **Wire AUDIO_END → Turn 1** — replace the Phase 0 stub in [`lumos-backend/gateway/websocket.py`](../lumos-backend/gateway/websocket.py) `_complete_phase0_turn` with a call into `orchestrator.turn_handler`.
9. **Postgres `turns` + `question_attempts` tables** — new migration `003_create_turns_and_attempts.sql`; writes are best-effort, off the hot path.
10. **Tests** — classifier golden set, MSM cache hit/miss, escalation trigger, end-to-end Turn 1 latency budget assertion in CI.

### Critical files to touch in Phase 1

- New: `lumos-backend/providers/{cache_manager.py, llm_gemini.py}`, `lumos-backend/classifiers/query_classifier.py`, `lumos-backend/orchestrator/turn_handler.py`, `lumos-backend/orchestrator/validator.py`, `lumos-backend/prompts/{turn1_system.py, classifier.py, technical_module.py, conceptual_module.py}`, `lumos-backend/storage/redis_client.py`.
- Edit: [`lumos-backend/gateway/websocket.py`](../lumos-backend/gateway/websocket.py) — swap stub for real orchestrator call.
- Migration: `supabase/migrations/003_create_turns_and_attempts.sql`.

### External services to provision before Phase 1

| Service | Action |
|---|---|
| Redis | Spin up Upstash dev instance (or local Docker), put URL in `REDIS_URL`. |
| Gemini | Obtain API key, set `GEMINI_API_KEY`. |

Groq, Cartesia, and Cloudflare R2 are **not** needed until Phases 2, 3, and 5 respectively.

## Acceptance — Phase 1 done

- A paired lamp emits `AUDIO_END` after a stub audio capture and receives a Gemini-generated Socratic nudge based on its captured image, within <1.8 s wall-clock.
- MSM cache hit on a repeated question lowers Turn 1 latency by ≥30 %.
- Escalation to Gemini Pro fires when `is_confident < 0.60` and the test suite proves it.
