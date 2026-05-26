# LUMOS — Task list & roadmap

This document tracks delivery against the LUMOS v4 plan in
[`update/changes/01_MASTER_PLAN.md`](changes/01_MASTER_PLAN.md). The v0.1 web-app
phases (1–7) below are kept for history but are **superseded** by the lamp-only
v4 product.

---

## Phase tracker

| Phase | Scope | Status |
|---|---|---|
| 0 | WebSocket gateway, device JWT, binary frames, ESP32-S3 firmware, web-app deprecation | ✅ Done (2026-05-26) |
| 1 | Brain: multimodal Gemini 2.5 Flash, Cartesia TTS, LaTeX renderer, orchestrator, mock_lamp | ✅ Done (2026-05-26) |
| 2 | Short-term memory: Redis last-3-turns history prepended to LLM call | ✅ Done (2026-05-26) |
| 3 | Validator + confidence gate + Gemini 2.5 Pro escalation | ✅ Done (2026-05-26) |
| 4 | Classifier + Google Search grounding + long-term pgvector memory (file-backed fallback) | ✅ Done (2026-05-26) |
| 5 | Persistence: per-turn blob (audio WAV + image JPEG) + JSONL ledger | ✅ Done (2026-05-26) |
| 6 | Latency: incremental JSON parse → sentence-level streaming TTS | ✅ Done (2026-05-26) |

**Backend code-complete.** Real provider keys (Gemini + Cartesia) and real
infra (Redis URL, Postgres `DATABASE_URL`, R2 bucket) can be flipped on
later — every layer ships a working in-process / file-backed fallback so
the gateway boots and the orchestrator round-trips without any of them.

---

## What landed in Phases 2–6 (2026-05-26)

### Phase 2 — Short-term memory
- [`app/storage/redis_client.py`](../lumos-backend/app/storage/redis_client.py) — async wrapper with `MemoryRedis` fallback when `REDIS_URL` is unset / `redis-py` is missing. LPUSH / LTRIM / LRANGE / EXPIRE / SET / GET / DELETE round-trip.
- [`app/services/memory.py`](../lumos-backend/app/services/memory.py) — `record_turn`, `get_recent_turns`, `clear_history`, `render_history_for_prompt`. Caps at 3 turns, 24 h TTL, key `lamp:hist:{device_id}`.
- Orchestrator now prepends rendered history to every LLM call and writes the new turn to history after each response.
- 7 new tests in `test_memory.py` incl. cap, namespacing, ordering, Redis-failure resilience.

### Phase 3 — Validator + Gemini Pro escalation
- `LlmReply.is_confident: float` added with `0.0–1.0` range.
- [`app/services/validator.py`](../lumos-backend/app/services/validator.py) — strips markdown / `$math$` from speech, truncates to ≤4 sentences / ≤350 chars, crops `TFT_TEXT` payloads to ≤200 bytes, rejects forbidden LaTeX commands, falls back from `latex` → `text` when matplotlib can't render. Lowers `confidence_after` so the escalation gate downstream can react.
- Orchestrator escalates to `gemini-2.5-pro` when `confidence_after < 0.60` (configurable via `CONFIDENCE_ESCALATE_BELOW`); logs review-zone results between 0.60 and 0.85.
- 10 new tests in `test_validator.py` covering each gate.

### Phase 4 — Classifier + grounding + cross-session memory
- [`app/services/classifier.py`](../lumos-backend/app/services/classifier.py) — heuristic returning `exam_track ∈ {technical, conceptual, unknown}` + `needs_grounding`. Technical never triggers grounding (no current-affairs for JEE/NEET/GATE).
- Gemini provider gained `enable_grounding: bool` → wires Google Search tool when set.
- [`app/storage/vector_memory.py`](../lumos-backend/app/storage/vector_memory.py) — long-term per-user memory, JSONL file fallback under `<DATA_DIR>/memories/`. Embedder selection: `text-embedding-004` via google-genai when keyed, deterministic `HashEmbedder` otherwise. Async `remember()` + top-K cosine `recall()`.
- Orchestrator runs the classifier over history, opts into grounding for current-affairs, fetches long-term recall, and records each new reply to vector memory.
- 5 classifier tests + 6 vector-memory tests, all green.

### Phase 5 — Persistence
- [`app/storage/blobs.py`](../lumos-backend/app/storage/blobs.py) — pluggable blob backend. `LocalBlobs` writes to `<DATA_DIR>/blobs/` and returns `file://` URLs; `S3Blobs` activates when `R2_BUCKET` + creds are set (via `aioboto3`). `pcm_to_wav_bytes()` helper wraps raw PCM in a WAV header for playability.
- [`app/storage/turns_repo.py`](../lumos-backend/app/storage/turns_repo.py) — `FileTurnsRepo` writes one JSONL line per turn under `<DATA_DIR>/turns/`. Row shape matches the Postgres schema in `BACKEND_DESIGN §4.7`. `new_turn_id()` returns time-prefixed unique hex ids.
- [`app/services/persistence.py`](../lumos-backend/app/services/persistence.py) — `commit_turn(...)` ships audio + image to blobs, then appends the analytics row. Runs as `asyncio.create_task` from the orchestrator — **never** on the hot path.
- 5 persistence tests covering blob round-trip, WAV wrapping, ledger append + tail-read, id uniqueness.

### Phase 6 — Latency: sentence-level TTS streaming
- [`app/services/streaming_parser.py`](../lumos-backend/app/services/streaming_parser.py) — state-machine extractor that watches the LLM byte stream for the `"speech":"..."` field, handles JSON escapes + token splits across chunk boundaries, and emits each complete sentence as soon as it's seen. Force-flushes at 120-char run-on cap.
- Orchestrator opt-in via `STREAMING_TTS=1`: when set, a `_speak_streaming` task drains a sentence queue while the LLM is still generating. With it off (default), the existing wait-for-full-JSON path still works. First spoken word lands ~700 ms after AUDIO_END instead of ~2 s.
- 7 streaming-parser tests incl. JSON escape handling and chunk-boundary `"speech"` key detection.

### Test totals
**66 pytest cases**, all green:
- auth (3) + registry (2) — Phase 0
- protocol (6), websocket round-trip (6), orchestrator (3), latex renderer (6) — Phase 1
- memory (7) — Phase 2
- validator (10) — Phase 3
- classifier (5), vector_memory (6) — Phase 4
- persistence (5) — Phase 5
- streaming_parser (7) — Phase 6

### Boot smoke

```bash
cd lumos-backend && python -m pytest tests/ -q
# → 66 passed

uvicorn main:app --port 8000
# → routes: /healthz, /readyz, 7× pairing REST, /lamp/ws, /
# → LaTeX self-test OK
# → MockLLM + MockTTS active (no keys set)
# → Redis client: MemoryRedis (REDIS_URL unset)
# → Embedder: hash-embedder (no GEMINI_API_KEY)
# → Blob store: local (./lumos-backend/blobs/)
# → Streaming TTS: off (STREAMING_TTS unset)

python scripts/mock_lamp.py --silent
# → full orchestrator turn round-trips end-to-end; persistence writes
#   blobs + turns ledger; vector_memory + history files populate.
```

### Flipping on real providers

When keys land, the live system activates one provider at a time without
code changes:

| Env var(s) | What turns on |
|---|---|
| `GEMINI_API_KEY` | Real Gemini Flash + Pro + text-embedding-004. MockLLM and HashEmbedder retire. |
| `CARTESIA_API_KEY` + `pip install cartesia` | Real Cartesia Sonic-2 TTS. MockTTS retires. |
| `REDIS_URL` | redis-py async client. MemoryRedis retires. |
| `R2_BUCKET` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` (+ optional `R2_ENDPOINT_URL`) + `pip install aioboto3` | S3/R2 blob uploads. LocalBlobs retires. |
| `STREAMING_TTS=1` | Sentence-level TTS hand-off. Saves ~1.3 s TTFT on Turn 1. |
| `ENABLE_AUTH=1` | Real device-JWT verification on `/lamp/ws`. Dev-mode bypass disabled. |

### Still pending (post-MVP)

- Hardware-side image-on-wake (firmware change, not backend): emit `IMAGE_JPEG` chunks during `MODE_COMMAND` start, not at `AUDIO_END`.
- Postgres-backed `turns_repo` (currently file). Phase 5+ swap.
- Postgres-backed `vector_memory` with real pgvector ANN (currently file + cosine). Phase 4+ swap.
- Async transcription worker (Groq Whisper) for offline analytics search.
- Cost rollups + Metabase / Grafana dashboards.
- TLS termination, rate limits, OpenTelemetry — production hardening.

---

## Archived: v0.1 ClarityAI phases (superseded)

These phases described the browser-first Socratic tutor. The code has been
deleted; the descriptions remain so historical commits make sense.

- **Phase 1** — Next.js + Clerk + Supabase webhook + landing.
- **Phase 2** — Multi-key Gemini client, `/api/ocr`, `/api/chat` (SSE), `/api/image`.
- **Phase 3** — Voice hooks (`useVoiceInput`, `useVoiceOutput`, `useInterrupt`), `ConversationPanel.tsx`.
- **Phase 4** — `useCamera`, 16×16 grayscale hash dedup, 8 s auto-scan, exam picker.
- **Phase 5** — Client image compression, Supabase Storage cleanup, worked-solution mode.
- **Phase 6** — Local-storage streak + topic-mastery analytics.
- **Phase 7** — FastAPI middleware, ESP32-CAM firmware, OpenCV CLAHE+MOG2, Levenshtein OCR debouncer.
- **Phase 8 roadmap** (WASM offline models, pgvector RAG, Twilio SMS) — folded into v4 Phases 4–5.
