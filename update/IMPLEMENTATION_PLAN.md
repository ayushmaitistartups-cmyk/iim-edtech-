# LUMOS — Implementation plan

The canonical phase-by-phase build order lives in
[`changes/01_MASTER_PLAN.md`](changes/01_MASTER_PLAN.md) and
[`changes/BACKEND_TODO.md`](changes/BACKEND_TODO.md). This file tracks the
*current state* against those plans and the next concrete chunk of work.

## Where we are (2026-05-26)

**Backend is code-complete through Phase 6.** The orchestrator, brain,
memory, validator, escalation, classifier, persistence, and sentence-level
streaming TTS all ship. Every external dependency has a working in-process
fallback so the gateway boots and round-trips without any keys.

| Phase | Status |
|---|---|
| 0 — Foundation (gateway, WS, auth, firmware) | ✅ Done |
| 1 — Brain (Gemini Flash + Cartesia + LaTeX + orchestrator) | ✅ Done |
| 2 — Short-term memory (Redis history) | ✅ Done |
| 3 — Validator + Gemini Pro escalation | ✅ Done |
| 4 — Classifier + Google Search grounding + vector memory | ✅ Done |
| 5 — Persistence (blobs + turns ledger) | ✅ Done |
| 6 — Sentence-level streaming TTS | ✅ Done |

## What "code complete" means

- **66 pytest cases pass** end-to-end against the mocks.
- `python -c "from main import app"` boots clean; all routes mount; LaTeX self-test passes.
- `mock_lamp.py` round-trips a full turn: JPEG + WAV → STATE/TFT/AUDIO_OUT → out.wav.
- Background tasks (persistence, vector memory, short-term memory) all run off the hot path.

## The "flip a switch" matrix

| Env var | What turns on | Cost / risk to enable |
|---|---|---|
| `GEMINI_API_KEY` | Real `gemini-2.5-flash` + `gemini-2.5-pro` + `text-embedding-004` | ~$0.0008/turn |
| `CARTESIA_API_KEY` (+ `pip install cartesia`) | Real Cartesia Sonic-2 streaming TTS | ~$0.0005/turn |
| `REDIS_URL=redis://...` | Real async Redis client; history persists across restarts | Trivial (local Docker or Upstash free) |
| `R2_BUCKET` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` (+ `pip install aioboto3`) | S3/R2 blob uploads instead of local filesystem | Pennies/month at MVP scale |
| `STREAMING_TTS=1` | Sentence-level TTS hand-off | Bigger TTFT win; ~700 ms vs ~2 s |
| `ENABLE_AUTH=1` | Real device-JWT verification on `/lamp/ws` | Required for prod; not before |
| `GEMINI_MODEL=` / `GEMINI_PRO_MODEL=` | Pin different model versions | Free; for evals |
| `CONFIDENCE_ESCALATE_BELOW=0.60` | Threshold for Pro escalation | Tune after observing prod reviews |

## What's deliberately NOT in scope

Per [`changes/BACKEND_TODO.md`](changes/BACKEND_TODO.md) Layer 10+11:

- **Layer 10 — Auth + pairing.** Already shipped in Phase 0; gated behind `ENABLE_AUTH`. Flip on when the firmware also flips its `ENABLE_AUTH=1`.
- **Layer 11 — Production hardening.** TLS termination at Caddy/Nginx, per-device rate limits, structlog → Loki, OpenTelemetry spans, Dockerfile + docker-compose, region pinning to Gemini endpoint. Done as part of the deploy story, not the build.

## Next actionable chunks (post-MVP)

These are *nice-to-haves* now that the backend is code-complete. Pick based on what the live data shows:

1. **Firmware image-on-wake** — move JPEG capture out of `AUDIO_END` latency. Saves ~150 ms. Lives in `firmware/tutor_lamp/`, not the backend.
2. **Postgres-backed `turns_repo`** — swap [`storage/turns_repo.py`](../lumos-backend/app/storage/turns_repo.py) for `sqlalchemy[asyncio] + asyncpg`. Same interface; one file change.
3. **Postgres + pgvector `vector_memory`** — same idea for [`storage/vector_memory.py`](../lumos-backend/app/storage/vector_memory.py). Real ANN beats file-walk cosine at >~1k memories per user.
4. **LLM-based classifier** — replace the keyword heuristic in [`services/classifier.py`](../lumos-backend/app/services/classifier.py) with a cheap Gemini Flash text-only call (~100 ms TTFT) that reads audio transcripts + image and emits a 6-type taxonomy + difficulty per `BACKEND_DESIGN §4`.
5. **Cost rollups + observability** — daily materialised views, Metabase / Grafana panels for p50/p95 TTFT, turns/day, $/lamp/month.
6. **Async transcription worker** — Groq Whisper on the persisted `audio.wav` blobs to fill `turns.transcript` for analytics search.
7. **Eval harness** — hand-crafted (audio, image, expected display.kind) pairs; CI gate on regression in JSON validity / LaTeX render rate / confidence distribution.

## Critical files reference

### Phase 0–1 — already shipped
- [`lumos-backend/main.py`](../lumos-backend/main.py) — FastAPI app composition + LaTeX boot self-test.
- [`app/protocol.py`](../lumos-backend/app/protocol.py) — 13-type binary frame codec.
- [`app/session.py`](../lumos-backend/app/session.py) — per-lamp `Session` + `Turn` state.
- [`app/providers/llm_gemini.py`](../lumos-backend/app/providers/llm_gemini.py) — multimodal Gemini call with grounding toggle.
- [`app/providers/tts_cartesia.py`](../lumos-backend/app/providers/tts_cartesia.py) — Cartesia + MockTTS, 4 KB / 85 ms chunking.
- [`app/providers/latex_renderer.py`](../lumos-backend/app/providers/latex_renderer.py) — matplotlib mathtext → RGB565 BE.
- [`app/services/orchestrator.py`](../lumos-backend/app/services/orchestrator.py) — `run_turn` pipeline.
- [`scripts/mock_lamp.py`](../lumos-backend/scripts/mock_lamp.py) — dev integration harness.

### Phase 2–6 — added this session
- [`app/storage/redis_client.py`](../lumos-backend/app/storage/redis_client.py) — async Redis + MemoryRedis fallback.
- [`app/services/memory.py`](../lumos-backend/app/services/memory.py) — short-term history.
- [`app/services/validator.py`](../lumos-backend/app/services/validator.py) — output guardrails + confidence gate.
- [`app/services/classifier.py`](../lumos-backend/app/services/classifier.py) — exam-track / grounding heuristic.
- [`app/storage/vector_memory.py`](../lumos-backend/app/storage/vector_memory.py) — long-term per-user memory with file-backed cosine ANN.
- [`app/storage/blobs.py`](../lumos-backend/app/storage/blobs.py) — Local + S3/R2 blob stores.
- [`app/storage/turns_repo.py`](../lumos-backend/app/storage/turns_repo.py) — JSONL ledger.
- [`app/services/persistence.py`](../lumos-backend/app/services/persistence.py) — off-hot-path commit task.
- [`app/services/streaming_parser.py`](../lumos-backend/app/services/streaming_parser.py) — incremental JSON parser for sentence-level TTS.
