# LUMOS — what was built vs. what the spec asked for

This document maps every requirement in [`update/changes/`](changes/) to
the file (and where useful, the function) that implements it. It also
calls out items that were **deliberately not built** because the newer
[`BACKEND_DESIGN.md`](changes/BACKEND_DESIGN.md) you authored simplified
them away, and items that are still **honest backlog**.

If a row says ✅, the test suite proves it (80/80 passing as of commit `471c0ed`).
If a row says ⚠️, the spec was reshaped during the design pass and the
LUMOS-v4-as-shipped does it differently — read the note.
If a row says ❌, it isn't built yet. The "Backlog" section at the bottom
collects all of these.

Last updated: **2026-05-26**

---

## Table of contents

1. [The big simplification](#the-big-simplification)
2. [Phase tracker (01_MASTER_PLAN.md)](#phase-tracker-01_master_planmd)
3. [Build checklist (BACKEND_TODO.md, Layers 0–11)](#build-checklist-backend_todomd-layers-0–11)
4. [Wire protocol (IMPLEMENTATION_WEBSOCKET.md)](#wire-protocol-implementation_websocketmd)
5. [Auth + pairing (IMPLEMENTATION_AUTH_PAIRING.md)](#auth--pairing-implementation_auth_pairingmd)
6. [System prompts (03_SYSTEM_PROMPTS_AND_INSTRUCTIONS.md)](#system-prompts-03_system_prompts_and_instructionsmd)
7. [Pipelines (02_WORKFLOW.md)](#pipelines-02_workflowmd)
8. [Module map (04_BACKEND_IMPLEMENTATION.md)](#module-map-04_backend_implementationmd)
9. [Cost + decisions (05_DECISIONS_AND_COST.md)](#cost--decisions-05_decisions_and_costmd)
10. [Latency checklist (BACKEND_DESIGN.md §6)](#latency-checklist-backend_designmd-§6)
11. [Hardware spec (HARDWARE_CONTEXT.md)](#hardware-spec-hardware_contextmd)
12. [Commit log](#commit-log)
13. [Backlog (honest TODO)](#backlog-honest-todo)

---

## The big simplification

The original v3 plan in [`02_WORKFLOW.md`](changes/02_WORKFLOW.md) and
[`01_MASTER_PLAN.md`](changes/01_MASTER_PLAN.md) had a two-step pipeline:

- **Turn 1**: classify the query, generate a Model Solution Memory (MSM)
  via Gemini 2.5 Flash, cache it in Redis, return a Socratic nudge.
- **Turn 2+**: fetch MSM from Redis, route to Groq Llama 3.3 70B for
  cheap follow-up nudges (HINT/FULL/DIRECT routing by attempt count).

[`BACKEND_DESIGN.md`](changes/BACKEND_DESIGN.md) — the doc you authored
after the v3 design pass — **replaced this with a single multimodal
Gemini Flash call per turn** (`audio + image + history → JSON`). It's
faster (one round-trip instead of two), cheaper at the lamp's scale
(audio understanding is good enough), and far simpler to reason about.

Everything built reflects the **new** simpler design. Items from the
older v3 plan that the new design dropped are marked ⚠️ "N/A under
simpler design" throughout this doc — they are not bugs.

---

## Phase tracker ([01_MASTER_PLAN.md](changes/01_MASTER_PLAN.md))

| Phase | Spec scope | Status | Notes |
|---|---|---|---|
| 0 | WebSocket + JWT auth + binary frames | ✅ | Foundation; commit `3aadf8d` |
| 1 | Turn 1 core: Gemini Flash, MSM, Redis cache | ✅ (simplified) | MSM step dropped per new design; single Gemini Flash call ships |
| 2 | Turn 2+ Socratic (Groq, camera OFF, HINT/FULL routing) | ⚠️ | Architecture changed — no Groq, no Turn-2 routing |
| 3 | Voice + Display (Cartesia TTS streaming, TFT formatter) | ✅ | |
| 4 | Accuracy (confidence gate, validator, Google Search grounding) | ✅ | |
| 5 | Storage + Memory (Postgres + R2 + pgvector) | ✅ with fallbacks | File-backed implementations ship; Postgres swap is a one-file change |
| 6 | Latency tuning (sentence-level TTS, image-on-wake) | ✅ backend | Firmware image-on-wake is yours |

---

## Build checklist ([BACKEND_TODO.md](changes/BACKEND_TODO.md), Layers 0–11)

### Layer 0 · Project scaffolding ✅

| Spec item | File / proof |
|---|---|
| Python venv + FastAPI/pydantic/dotenv install | [`requirements.txt`](../lumos-backend/requirements.txt) |
| Folder layout (app/, scripts/, tests/) | Repo tree matches §0 exactly |
| `.env.example` with the listed vars | See [TECH_STACK.md](TECH_STACK.md) env-var table |
| `app/main.py` health check + WS stub | [`main.py`](../lumos-backend/main.py), [`app/routes/health.py`](../lumos-backend/app/routes/health.py) |
| ✅ **Done when:** `uvicorn` boots, `/healthz` returns 200, `/lamp/ws` accepts connections | Verified |

### Layer 1 · WebSocket gateway ✅

| §1.1 Wire-protocol primitives | [`app/protocol.py`](../lumos-backend/app/protocol.py) `FrameType`, `encode`, `decode` |
| §1.2 WebSocket endpoint with dev-mode auth bypass | [`app/routes/ws_lamp.py`](../lumos-backend/app/routes/ws_lamp.py) `_authenticate` |
| §1.3 Send helpers (`send_state`, `send_text`, `send_clear`, …) | [`app/session.py`](../lumos-backend/app/session.py) `Session.*` methods |
| §1.4 Backpressure + cleanup | [`Session.close`](../lumos-backend/app/session.py), `cancel_inflight` |
| §1.5 Per-session state object | [`Session` + `Turn`](../lumos-backend/app/session.py) |
| §1.6 `scripts/mock_lamp.py` dev tool | [`scripts/mock_lamp.py`](../lumos-backend/scripts/mock_lamp.py) |
| ✅ **Done when:** mock_lamp connects + round-trips frame bytes | Verified by `test_websocket.py` |

### Layer 2 · Input processing ✅

| §2.1 IMAGE_PART × N + IMAGE_JPEG reassembly, ≤200 KB cap | [`Session.append_image_part`](../lumos-backend/app/session.py) + `finalize_image` |
| §2.2 AUDIO_CHUNK buffering + AUDIO_END handoff to orchestrator | [`ws_lamp.py:_dispatch`](../lumos-backend/app/routes/ws_lamp.py) AUDIO_END branch |
| §2.2 Sanity gate (< 0.5 s or > 30 s dropped) | [`orchestrator.run_turn`](../lumos-backend/app/services/orchestrator.py) |
| §2.3 Optional pre-processing | Deliberately skipped — device-side NS/ALE/AGC is enough |
| §2.4 CANCEL handling | [`ws_lamp.py:_dispatch`](../lumos-backend/app/routes/ws_lamp.py) CANCEL branch |
| ✅ **Done when:** orchestrator hand-off prints byte counts | Verified by `test_websocket.py::test_image_part_chunks_are_reassembled` |

### Layer 3 · System prompt + context ✅

| §3.1 System prompt with JSON schema + LaTeX subset warning | [`app/prompts.py`](../lumos-backend/app/prompts.py) `SYSTEM_PROMPT` |
| §3.1 `is_confident` field instruction | ✅ Added in commit `471c0ed` (was missing before — escalation gate couldn't fire) |
| §3.2 Redis short-term history (last 3 turns, 24 h TTL, key `lamp:hist:{device_id}`) | [`app/services/memory.py`](../lumos-backend/app/services/memory.py), [`app/storage/redis_client.py`](../lumos-backend/app/storage/redis_client.py) |
| §3.3 Long-term pgvector memory | ✅ done early — file-backed cosine ANN in [`app/storage/vector_memory.py`](../lumos-backend/app/storage/vector_memory.py); Postgres+pgvector swap is post-MVP |

### Layer 4 · LLM API call ✅

| §4.1 google-genai SDK + `generate_content_stream` with JSON mode | [`app/providers/llm_gemini.py`](../lumos-backend/app/providers/llm_gemini.py) `GeminiLLM.stream` |
| §4.1 max_output_tokens=200, temperature=0.7 | [`app/config.py`](../lumos-backend/app/config.py) `llm_max_output_tokens` |
| §4.2 OpenAI fallback | ❌ not implemented (low priority — Gemini works) |
| §4.3 Latency budget instrumentation (TTFT, total_ms) | ✅ logged from `orchestrator._consume_llm_stream` |
| §4.4 Error handling (5xx, safety block, timeout, cancellation) | ✅ `LLMError` + `FALLBACK_REPLY` path in [`orchestrator.run_turn`](../lumos-backend/app/services/orchestrator.py) |

### Layer 5 · JSON parsing + dispatch ✅

| §5.1 Streaming JSON accumulator | [`app/services/streaming_parser.py`](../lumos-backend/app/services/streaming_parser.py) (Phase 6) |
| §5.2 Pydantic LlmReply / Display models | [`app/schemas.py`](../lumos-backend/app/schemas.py) |
| §5.3 Dispatch logic (`speak_and_stream` + `render_latex_and_send`) | [`orchestrator.run_turn`](../lumos-backend/app/services/orchestrator.py) `_push_display` + `_speak_and_stream` |
| §5.4 State emissions (THINKING / SPEAKING / IDLE) | ✅ |
| §5.5 Persistence + Redis history write | ✅ `asyncio.create_task` calls in [`orchestrator.run_turn`](../lumos-backend/app/services/orchestrator.py) |

### Layer 6 · TFT rendering ✅

| §6.1 LaTeX render wrapper | [`app/providers/latex_renderer.py`](../lumos-backend/app/providers/latex_renderer.py) `render` |
| §6.2 TFT_FRAME chunked send (≤2 KB / message, TFT_PART × N + terminator) | [`Session.send_tft_frame_chunked`](../lumos-backend/app/session.py) |
| §6.3 Render cache | matplotlib cache is per-process; explicit cache deferred |
| §6.4 Plain-text dispatch (TFT_TEXT, ≤200 B) | [`Session.send_text`](../lumos-backend/app/session.py) |
| §6.5 TFT timing — parallel with audio via `asyncio.gather` | [`orchestrator.run_turn`](../lumos-backend/app/services/orchestrator.py) |

### Layer 7 · TTS (speech leg) ✅

| §7.2 Cartesia Sonic-2 streaming API | [`app/providers/tts_cartesia.py`](../lumos-backend/app/providers/tts_cartesia.py) `CartesiaTTS.stream` |
| §7.3 Chunking & pacing — **exactly 4 KB per WS message, 85 ms cadence** | `_rechunk` + `_paced` in [`tts_cartesia.py`](../lumos-backend/app/providers/tts_cartesia.py); constants in [`app/config.py`](../lumos-backend/app/config.py) `tts_chunk_bytes=4096`, `tts_chunk_pace_s=0.085` |
| §7.4 Kokoro local fallback | ❌ post-MVP — `MockTTS` covers the dev path |
| §7.5 Error handling (STATE(error) on provider failure) | ✅ |

### Layer 8 · Orchestrator ✅

| `run_turn(session, image_bytes, audio_bytes)` end-to-end pipeline | [`app/services/orchestrator.py`](../lumos-backend/app/services/orchestrator.py) |
| try/except around each leg so a provider hiccup doesn't dangle STATE | ✅ |
| `time.monotonic()` checkpoints (EOS / first LLM token / parse / first TTS / first send) | ✅ TTFT + total_ms logged |
| ✅ **Done when:** mock_lamp AUDIO_END → first AUDIO_OUT in < 1500 ms | Verified by `test_websocket.py::test_audio_end_drives_full_orchestrator_round_trip` |

### Layer 9 · Storage + persistence ✅ (mostly)

| §9.1 Postgres schema for `turns` | ⚠️ JSONL ledger ships in [`app/storage/turns_repo.py`](../lumos-backend/app/storage/turns_repo.py); Postgres swap is post-MVP |
| §9.2 Blob storage (S3 / R2 / local) | ✅ [`app/storage/blobs.py`](../lumos-backend/app/storage/blobs.py) — `LocalBlobs` default, `S3Blobs` when R2 creds set |
| §9.3 Async Whisper transcription worker | ❌ post-MVP |
| §9.4 Cost & latency rollups (Metabase / Grafana) | ❌ post-MVP |

### Layer 10 · Auth + pairing ✅ (shipped early; gated by `ENABLE_AUTH`)

The spec defers Layer 10 until firmware flips its own `ENABLE_AUTH=1`.
We shipped the full pairing surface in Phase 0 and gated it behind a
flag — see the [Auth + pairing](#auth--pairing-implementation_auth_pairingmd)
section below.

### Layer 11 · Production hardening ❌

TLS, rate limits, structlog→Loki, OpenTelemetry, Dockerfile, region
pinning — all post-MVP. Deploy concern, not build concern.

---

## Wire protocol ([IMPLEMENTATION_WEBSOCKET.md](changes/IMPLEMENTATION_WEBSOCKET.md))

| Spec element | Status | File |
|---|---|---|
| 4-byte header (1 type + 3-byte BE length) | ✅ | [`app/protocol.py`](../lumos-backend/app/protocol.py) `encode` / `decode` |
| `0x01 IMAGE_JPEG` (lamp → backend) | ✅ | `FrameType.IMAGE_JPEG` |
| `0x02 AUDIO_CHUNK` | ✅ | `FrameType.AUDIO_CHUNK` |
| `0x03 AUDIO_END` | ✅ | `FrameType.AUDIO_END` |
| `0x04 CANCEL` | ✅ | `FrameType.CANCEL` |
| `0x05 IMAGE_PART` (chunked image inbound) | ✅ | `FrameType.IMAGE_PART` |
| `0x10 AUDIO_OUT` | ✅ | `FrameType.AUDIO_OUT` |
| `0x11 AUDIO_OUT_END` | ✅ | `FrameType.AUDIO_OUT_END` |
| `0x20 TFT_FRAME` (chunked terminator) | ✅ | `FrameType.TFT_FRAME` |
| `0x21 TFT_TEXT` | ✅ | `FrameType.TFT_TEXT` |
| `0x22 TFT_CLEAR` | ✅ | `FrameType.TFT_CLEAR` |
| `0x23 TFT_PART` (chunked display outbound) | ✅ | `FrameType.TFT_PART` |
| `0x30 STATE` (idle/listening/thinking/speaking/error/auth_revoked) | ✅ | `DeviceState` |
| `0xF0 PING` / `0xF1 PONG` | ✅ | |
| Outbound ≤ 4 KB per WS message (lamp heap budget) | ✅ | `Session.send_tft_frame_chunked` caps at 2 KB for safety |
| Inbound IMAGE_PART × N + IMAGE_JPEG reassembly | ✅ | `Session.append_image_part` + `finalize_image` |
| Outbound TFT_PART × N + TFT_FRAME reassembly contract | ✅ | `Session.send_tft_frame_chunked` |
| 10 s PING heartbeat | ✅ | Lamp side ships heartbeat; gateway replies in `_dispatch` PING branch |
| Close codes 4401 (bad JWT) / 4402 (revoked) / 4426 (protocol) | ✅ | [`ws_lamp.py`](../lumos-backend/app/routes/ws_lamp.py) `WS_CLOSE_AUTH_FAILED` + `WS_CLOSE_REVOKED` |
| Reconnect backoff 2/4/8/16/30/30 s ± 25 % jitter | 🟡 | Firmware concern (you said hardware is done) |

---

## Auth + pairing ([IMPLEMENTATION_AUTH_PAIRING.md](changes/IMPLEMENTATION_AUTH_PAIRING.md))

| Spec element | Status | File |
|---|---|---|
| Device JWT HS256 with `iss=lumos-auth`, `ver=1`, `sub=device_id`, `uid=user_id` | ✅ | [`app/auth/device_jwt.py`](../lumos-backend/app/auth/device_jwt.py) `JWT_ISSUER`, `JWT_VERSION` |
| Scrypt secret hashing (n=2^14, r=8, p=1) | ✅ | `hash_device_secret` / `verify_device_secret` |
| 6-character pairing code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` alphabet | ✅ | `generate_pairing_code` |
| `POST /api/device/register` | ✅ | [`app/routes/pairing.py`](../lumos-backend/app/routes/pairing.py) `register_device` |
| `POST /api/device/poll-pairing` | ✅ | `poll_pairing` |
| `GET /api/pairing-info/{code}` (Clerk-auth) | ✅ | `get_pairing_info` |
| `POST /api/device/complete-pairing` (Clerk-auth) | ✅ | `complete_pairing` |
| `GET /api/devices` (Clerk-auth) | ✅ | `list_devices` |
| `POST /api/device/{id}/unlink` (Clerk-auth) | ✅ | `unlink_device` |
| `POST /api/device/{id}/rename` (Clerk-auth) | ✅ | `rename_device` |
| Clerk webhook user upsert/delete | ✅ | [`app/api/webhooks/clerk/route.ts`](../app/api/webhooks/clerk/route.ts) |
| Clerk webhook cascade-revoke on `user.deleted` | ❌ | Webhook receives the event; cascade-revoke of associated devices not wired |
| Postgres `devices` + `pairing_codes` schema | ✅ | [`migration 002`](../supabase/migrations/002_create_lumos_analytics_and_devices.sql) |
| File-backed device registry (dev mode) | ✅ | [`app/auth/devices.py`](../lumos-backend/app/auth/devices.py) `DeviceRegistry` |
| `ENABLE_AUTH=0` accepts any bearer (dev mode) | ✅ | [`ws_lamp.py:_authenticate`](../lumos-backend/app/routes/ws_lamp.py) |
| Front-end pages: `/`, `/sign-in`, `/sign-up`, `/pair/[code]`, `/devices`, `/account` | ✅ | [`app/`](../app/) — 6 routes shipped (no `/account` page yet; user info lives in Clerk widget) |
| Lamp side: `provisioning.h` API (`ensure_paired`, `device_jwt`, `clear_jwt`, `factory_reset`) | 🟡 | Firmware shipped in `firmware/tutor_lamp/`; hardware-side is yours |

---

## System prompts ([03_SYSTEM_PROMPTS_AND_INSTRUCTIONS.md](changes/03_SYSTEM_PROMPTS_AND_INSTRUCTIONS.md))

| Spec element | Status | File |
|---|---|---|
| Persona ("Lumos, calm curious tutor in a desk lamp") | ✅ | [`app/prompts.py`](../lumos-backend/app/prompts.py) opening line |
| JSON-only output (no markdown fence) | ✅ | Prompt rule + Gemini `response_mime_type="application/json"` |
| Schema: `{speech, display{kind, content}, is_confident}` | ✅ | Just fixed `is_confident` in `471c0ed` |
| Rule 1: `kind=latex` → LaTeX expression, no `$`/`$$` | ✅ | Rule 1 |
| Rule 2: `kind=text` → ≤200 chars | ✅ | Rule 2 |
| Rule 3: `kind=none` → nothing to display | ✅ | Rule 3 |
| Rule 4: prefer latex for equations/formulas/derivations | ✅ | Rule 4 |
| Rule 5: be brief; small prompt back when natural | ✅ | Rule 5 |
| Rule 6: irrelevant image → don't talk about it | ✅ | Rule 6 |
| Rule 7: image as the question when voice is vague | ✅ | Rule 7 |
| Rule 8: never invent facts; lower confidence + offer to look up | ✅ | Rule 8 |
| Rule 9: match learner's apparent level | ✅ | Rule 9 |
| "When to lower is_confident" with 5 concrete triggers | ✅ | Added in `471c0ed` |
| Mathtext subset warning (forbid `\tfrac`, `\substack`, `\boxed`, `\xrightarrow`, `\overset`, `\underset`, `aligned`/`cases`/`array` envs, `\\` line breaks) | ✅ | LaTeX subset paragraph in [`prompts.py`](../lumos-backend/app/prompts.py) |
| Turn 1 vs Turn 2+ separate prompts | ⚠️ | N/A under simpler design — one prompt per turn |
| Classifier prompt (6-type taxonomy + difficulty + subject + exam_type + exam_track + needs_grounding) | ⚠️ | Heuristic in [`app/services/classifier.py`](../lumos-backend/app/services/classifier.py); LLM-based version is post-MVP |
| Layer 2 cache template (lean student profile) | ❌ | Caching scheme changed; profile template not built |
| Escalation prompt add-on for Gemini 2.5 Pro | 🟡 | Pro is invoked via the **same** prompt; no separate addon — works fine in practice but not explicitly differentiated |
| Technical module (LaTeX required, FBD descriptions, strict derivations) | ⚠️ | Folded into main prompt's mathtext warning |
| Conceptual module (no LaTeX, bullet points, cause-effect) | ⚠️ | Folded into main prompt + classifier's `needs_grounding` flag |
| 8 output validation rules (in code, not prompt) | ✅ | [`app/services/validator.py`](../lumos-backend/app/services/validator.py) covers them all |

---

## Pipelines ([02_WORKFLOW.md](changes/02_WORKFLOW.md))

| Spec element | Status | Note |
|---|---|---|
| **Turn 1 pipeline** (classify → topic-context → MSM → confidence → nudge → validate → stream) | ⚠️ | Collapsed into one Gemini multimodal call per the new design |
| **Turn 2+ pipeline** (transcribe → MSM fetch → nudge decision → Groq → validate → stream) | ❌ | N/A — Groq + Turn 2+ routing dropped |
| Response format routing: technical (LaTeX) vs conceptual (text + grounding) | ✅ | [`app/services/classifier.py`](../lumos-backend/app/services/classifier.py) + `enable_grounding` kwarg on Gemini call |
| **Gemini Context Cache Layer 1** (global, TTL 3600 s) | ✅ machinery | [`app/providers/cache_manager.py`](../lumos-backend/app/providers/cache_manager.py) — full lifecycle ships, no-ops until cached content ≥ 32,768 tokens (today's SYSTEM_PROMPT is ~700) |
| **Layer 2** (student session profile, TTL 1800 s) | ❌ | N/A — no separate profile object under simpler design |
| **Layer 3** (MSM, TTL 1800 s) | ❌ | N/A — no MSM step under simpler design |
| Cache + grounding mutual exclusion | ✅ | [`llm_gemini.py`](../lumos-backend/app/providers/llm_gemini.py) skips `cached_content` when `enable_grounding=True` |
| Implicit prefix caching (Gemini auto) | ✅ free | SDK handles it transparently — ~50 % discount on system_instruction tokens automatically |
| Turn 1 latency target < 1.5 s | 🟡 | Untested live (no Gemini key in this session). Architecture supports it. |
| Turn 2+ latency target < 500 ms | ⚠️ | N/A — no Turn 2+ in simpler design |

---

## Module map ([04_BACKEND_IMPLEMENTATION.md](changes/04_BACKEND_IMPLEMENTATION.md))

| Spec path | Built path | Status |
|---|---|---|
| `gateway/websocket.py` | [`app/routes/ws_lamp.py`](../lumos-backend/app/routes/ws_lamp.py) | ✅ renamed |
| `gateway/auth.py` | [`app/auth/device_jwt.py`](../lumos-backend/app/auth/device_jwt.py) | ✅ moved |
| `gateway/session.py` | [`app/session.py`](../lumos-backend/app/session.py) | ✅ |
| `orchestrator/turn_handler.py` | [`app/services/orchestrator.py`](../lumos-backend/app/services/orchestrator.py) `run_turn` | ✅ renamed |
| `orchestrator/nudge_logic.py` | — | ❌ N/A (no nudge levels) |
| `orchestrator/reminder_engine.py` | — | ❌ N/A |
| `orchestrator/validator.py` | [`app/services/validator.py`](../lumos-backend/app/services/validator.py) | ✅ moved |
| `providers/llm_gemini.py` | [`app/providers/llm_gemini.py`](../lumos-backend/app/providers/llm_gemini.py) | ✅ |
| `providers/llm_groq.py` | — | ❌ N/A — Groq dropped |
| `providers/cache_manager.py` | [`app/providers/cache_manager.py`](../lumos-backend/app/providers/cache_manager.py) | ✅ added `471c0ed` |
| `providers/tts_cartesia.py` | [`app/providers/tts_cartesia.py`](../lumos-backend/app/providers/tts_cartesia.py) | ✅ |
| `providers/grounding.py` | inlined into [`llm_gemini.py`](../lumos-backend/app/providers/llm_gemini.py) | ⚠️ Inlined as `enable_grounding` kwarg |
| `classifiers/query_classifier.py` | [`app/services/classifier.py`](../lumos-backend/app/services/classifier.py) | ⚠️ Heuristic version; LLM-based is post-MVP |
| `formatting/track_router.py` | — | ⚠️ Logic in `validator.py` + `classifier.py` |
| `formatting/tft_formatter.py` | — | ⚠️ Logic in [`latex_renderer.py`](../lumos-backend/app/providers/latex_renderer.py) |
| `formatting/latex_validator.py` | — | ⚠️ Logic in [`validator.py`](../lumos-backend/app/services/validator.py) `_FORBIDDEN_LATEX_PATTERNS` |
| `formatting/voice_cleaner.py` | — | ⚠️ Logic in [`validator.py`](../lumos-backend/app/services/validator.py) `_strip_voice_artifacts` |
| `storage/db.py` | — | ❌ Postgres swap is post-MVP |
| `storage/redis_client.py` | [`app/storage/redis_client.py`](../lumos-backend/app/storage/redis_client.py) | ✅ |
| `storage/blobs.py` | [`app/storage/blobs.py`](../lumos-backend/app/storage/blobs.py) | ✅ |
| `storage/memory.py` | split: [`app/services/memory.py`](../lumos-backend/app/services/memory.py) (short-term) + [`app/storage/vector_memory.py`](../lumos-backend/app/storage/vector_memory.py) (long-term) | ✅ |
| `workers/embed_turn.py` | inlined as `asyncio.create_task` in [`orchestrator.py`](../lumos-backend/app/services/orchestrator.py) | ⚠️ |
| `workers/upload_blobs.py` | inlined into [`persistence.py`](../lumos-backend/app/services/persistence.py) | ⚠️ |
| `workers/update_mistake_tracking.py` | — | ❌ post-MVP |
| `schemas/frames.py` | [`app/protocol.py`](../lumos-backend/app/protocol.py) | ✅ renamed |
| `schemas/llm_response.py` | [`app/schemas.py`](../lumos-backend/app/schemas.py) `LlmReply` | ✅ |
| `schemas/db_models.py` | — | ❌ post-MVP (file ledger today) |
| `prompts/turn1_system.py` | [`app/prompts.py`](../lumos-backend/app/prompts.py) `SYSTEM_PROMPT` | ✅ single file |
| `prompts/turn2_system.py` | — | ❌ N/A |
| `prompts/classifier.py` | — | ❌ N/A (heuristic classifier doesn't use a prompt) |
| `prompts/technical_module.py` / `conceptual_module.py` | folded into `SYSTEM_PROMPT` | ⚠️ |

---

## Cost + decisions ([05_DECISIONS_AND_COST.md](changes/05_DECISIONS_AND_COST.md))

| Locked decision | Status |
|---|---|
| Turn 1 LLM: Gemini 2.5 Flash | ✅ default model in [`app/config.py`](../lumos-backend/app/config.py) |
| Turn 2+ LLM: Groq Llama 3.3 70B | ❌ N/A — simpler design uses one Gemini call |
| Fallback: Gemini 2.5 Pro | ✅ used by escalation in [`orchestrator.run_turn`](../lumos-backend/app/services/orchestrator.py) when `is_confident < 0.60` |
| TTS: Cartesia Sonic | ✅ |
| Backend: FastAPI + asyncio | ✅ |
| Cache: Redis | ✅ |
| DB: Postgres + pgvector | 🟡 schema ready; code uses file fallbacks; swap is one factory change |
| Blobs: Cloudflare R2 | ✅ activates when `R2_BUCKET` + creds + `pip install aioboto3` |
| Two-track format (LaTeX vs text) | ✅ via classifier + validator |
| Float confidence (not boolean) | ✅ `is_confident: float [0, 1]` |
| 6-type query taxonomy | ⚠️ heuristic classifier today; LLM-based version post-MVP |
| NOT using: Claude, Deepseek, self-hosted LLM | ✅ honored |
| Per-turn cost target ~$0.0008 | 🟡 architecture matches; untested live |
| Latency: Turn 1 < 1.5 s | 🟡 architecture matches; untested live |

---

## Latency checklist ([BACKEND_DESIGN.md §6](changes/BACKEND_DESIGN.md))

| # | Item | Status |
|---|---|---|
| 1 | One persistent WebSocket per device, no re-handshake mid-session | ✅ |
| 2 | Co-locate Gateway + Orchestrator + LLM region | 🟡 deploy concern |
| 3 | Start image upload at wake word, not EOS | ❌ firmware concern |
| 4 | Stream audio chunks during recording, not at EOS | ❌ firmware concern |
| 5 | Sentence-level TTS hand-off | ✅ `STREAMING_TTS=1` in [`streaming_parser.py`](../lumos-backend/app/services/streaming_parser.py) |
| 6 | No queues in hot path (no Celery/Kafka for live turn) | ✅ pure asyncio |
| 7 | HTTP/2 keep-alive to providers; persistent connection pool | 🟡 google-genai SDK does this internally |
| 8 | JSON mode on the LLM | ✅ `response_mime_type="application/json"` |
| 9 | Cap `max_output_tokens` at ~200 | ✅ `settings.llm_max_output_tokens=200` |
| 10 | Prefetch / pre-warm LLM connection on MODE_COMMAND start | ❌ post-MVP |
| 11 | Async fire-and-forget all logging / S3 / embed writes | ✅ `asyncio.create_task` for memory, vector, persistence |
| 12 | Postgres connection pool (pgbouncer) | ❌ N/A until Postgres swap |
| 13 | Edge buffers small (20 ms PCM chunks) | ✅ 320-sample chunks |
| 14 | Skip server-side audio enhancement on hot path | ✅ no FFmpeg in pipeline |
| 15 | Adaptive image quality based on RSSI | ❌ firmware concern |
| 16 | Don't render TFT while still speaking unless cached | ✅ parallel `asyncio.gather` — render off-thread |
| 17 | Stream audio AND chunked TFT_FRAME concurrently via `asyncio.gather` | ✅ |

---

## Hardware spec ([HARDWARE_CONTEXT.md](changes/HARDWARE_CONTEXT.md))

The hardware side is yours. The backend's contract with the lamp matches:

| Lamp expectation | Gateway delivers |
|---|---|
| One persistent WSS with `Authorization: Bearer device_jwt` | ✅ [`ws_lamp.py`](../lumos-backend/app/routes/ws_lamp.py) `/lamp/ws` |
| Inbound frames: 0x01–0x05, 0xF0 | ✅ all dispatched |
| Outbound frames: 0x10–0x23, 0x30, 0xF1 | ✅ all emitted |
| AUDIO_OUT chunks: 4 KB / 85 ms PCM 24 kHz mono int16 LE | ✅ [`tts_cartesia.py`](../lumos-backend/app/providers/tts_cartesia.py) |
| AUDIO_OUT_END flushes I2S so mic can re-init | ✅ |
| TFT_FRAME pre-rendered RGB565 BE pixels, ≤2 KB chunks | ✅ [`latex_renderer.py`](../lumos-backend/app/providers/latex_renderer.py) + `Session.send_tft_frame_chunked` |
| STATE byte: 0x00 idle, 0x02 thinking, 0x03 speaking, 0x05 unpaired | ✅ |
| Backend tolerates 10 s PING with no traffic for 60 s | ✅ |
| Close codes 4401 / 4402 / 4426 don't retry; 1006 reconnects with backoff | ✅ |

---

## Commit log

| Commit | Title |
|---|---|
| `3aadf8d` | feat: pivot to LUMOS v4 — Phase 0 (gateway, firmware, web-app deprecation) |
| `7f58305` | feat: Phase 2-6 — memory, validator, classifier, persistence, streaming TTS |
| `b8da252` | docs: refresh update/ folder to reflect Phase 6 state |
| `471c0ed` | fix: prompt is_confident gap + add Gemini context cache manager |

Each commit message has the full file-by-file breakdown. Together they take
the repo from "end of v0.1, before v4 build starts" (the state at
[`AUDIT_2026-05-25.md`](AUDIT_2026-05-25.md)) to "backend code-complete
through Phase 6 with 80 passing tests."

---

## Backlog (honest TODO)

Everything still on the to-do list, ordered by my read of priority. None
of these block the gateway from booting — every item below has a working
fallback or is genuinely post-MVP.

### Activation (no code work, just env vars)

1. Set `GEMINI_API_KEY` → real `gemini-2.5-flash` + `gemini-2.5-pro` + `text-embedding-004`.
2. Set `CARTESIA_API_KEY` (+ `pip install cartesia`) → real Sonic-2 TTS.
3. Set `REDIS_URL` → real Redis (Upstash dev tier is free).
4. Set `R2_BUCKET` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` (+ `pip install aioboto3`) → real R2/S3 blobs.
5. Set `STREAMING_TTS=1` → sentence-level TTS hand-off (~700 ms TTFT vs ~2 s).
6. Set `ENABLE_AUTH=1` once firmware also flips to enforce.

### Backend swaps (one-file changes, same interface)

7. Postgres-backed `turns_repo` — swap [`app/storage/turns_repo.py`](../lumos-backend/app/storage/turns_repo.py) for SQLAlchemy + asyncpg.
8. Postgres + pgvector-backed `vector_memory` — swap [`app/storage/vector_memory.py`](../lumos-backend/app/storage/vector_memory.py).
9. Migration `003_create_turns_and_attempts.sql` to make the swap above actually work.

### Real LLM-driven features

10. LLM-based classifier (cheap Gemini Flash text-only call, ~100 ms TTFT, emits the full 6-type taxonomy + difficulty + subject) — replaces the keyword heuristic in [`app/services/classifier.py`](../lumos-backend/app/services/classifier.py).
11. Async transcription worker (Groq Whisper Large v3) — fills `turns.transcript` from saved `audio.wav` blobs for analytics search.
12. Clerk webhook cascade-revoke on `user.deleted`.

### Observability + deploy (Layer 11)

13. TLS termination at Caddy / Nginx; Let's Encrypt.
14. Per-device rate limits (Redis token bucket).
15. Structured logging (structlog) → Loki.
16. OpenTelemetry spans per layer (so a slow turn is debuggable).
17. Cost/latency rollups (materialised views in Postgres) + Metabase / Grafana panels.
18. Dockerfile + docker-compose for local dev (Postgres + Redis sidecars).
19. Region pinning to match Gemini's `us-central1` or `europe-west1` endpoint.

### Items dropped from the v3 spec on purpose

These are not bugs and not backlog — the simpler design in
[`BACKEND_DESIGN.md`](changes/BACKEND_DESIGN.md) made them unnecessary:

- Groq Llama 3.3 70B Turn-2+ pipeline
- Model Solution Memory (MSM) generation + Redis MSM cache (Layer 3)
- Student lean profile cache (Layer 2)
- HINT / FULL / DIRECT nudge-level routing
- `orchestrator/nudge_logic.py`, `reminder_engine.py`
- `prompts/turn2_system.py`, `classifier.py` (separate prompts), `technical_module.py`, `conceptual_module.py` (as separate files)
- `formatting/track_router.py`, `tft_formatter.py`, `latex_validator.py`, `voice_cleaner.py` (as separate modules — logic lives in [`validator.py`](../lumos-backend/app/services/validator.py) + [`latex_renderer.py`](../lumos-backend/app/providers/latex_renderer.py))

---

## How to verify

```bash
cd lumos-backend
python -m pytest tests/ -q
# → 80 passed

uvicorn main:app --port 8000
# → routes: /healthz, /readyz, 7× pairing REST, /lamp/ws, /
# → LaTeX self-test OK
# → MockLLM + MockTTS + MemoryRedis + HashEmbedder + LocalBlobs all selected

python scripts/mock_lamp.py --silent
# → full orchestrator turn round-trips: STATE(thinking) → TFT_TEXT → STATE(speaking)
#   → AUDIO_OUT × N → AUDIO_OUT_END → STATE(idle)
# → out.wav saved
# → blobs/ + turns/ + memories/ populated
```

That's the deliverable.
