# LUMOS — Architecture

## High-level

```
┌────────────────────┐    pair (REST)     ┌──────────────────────────────┐
│   Next.js web app  │ ──────────────────►│   lumos-backend (FastAPI)    │
│  (Clerk auth UI    │                    │                              │
│   + /pair/[code]   │                    │   app/routes/pairing.py      │
│   + /devices)      │                    │   app/routes/ws_lamp.py      │
└─────────┬──────────┘                    │   app/routes/health.py       │
          │ Clerk session                 │   app/auth/device_jwt.py     │
          │                               │   app/session.py             │
          ▼                               │   app/protocol.py            │
┌──────────────────────┐                  │   app/auth/devices.py        │
│  Clerk + Supabase    │                  └────────┬────────┬────────────┘
│  (users, devices,    │ ◄── upsert/delete user ───┘        │
│   pairing_codes…)    │                                    │
└──────────────────────┘                                    │
                                                            │ /lamp/ws (binary frames,
                                                            │   Bearer device_jwt)
                                                            ▼
                                                ┌──────────────────────┐
                                                │  ESP32-S3 tutor lamp │
                                                │  (firmware/tutor_lamp)│
                                                └──────────────────────┘
                                                            ▲
                                                            │ AUDIO_END trigger
                                                            │
   ┌────────────────────────────────────────────────────────┴──────────────────┐
   │  app/services/orchestrator.py — run_turn(session, image, audio_pcm)       │
   │                                                                            │
   │  STATE(thinking) + TFT_TEXT("Thinking…")                                   │
   │                                                                            │
   │  ┌────────────────────┐                                                    │
   │  │ services/memory    │  short-term LPUSH/LTRIM (Phase 2)                  │
   │  │ storage/vector_mem │  long-term cosine recall (Phase 4)                 │
   │  │ services/classifier│  exam_track + needs_grounding (Phase 4)            │
   │  └────────────────────┘                                                    │
   │             │ history_text + grounding flag                                │
   │             ▼                                                              │
   │  ┌──────────────────────────────────────┐                                  │
   │  │ providers/llm_gemini                 │ audio + image + history          │
   │  │   GeminiLLM (gemini-2.5-flash)       │ → JSON {speech, display,         │
   │  │   tools=[google_search] if grounding │   is_confident}                  │
   │  │   MockLLM fallback                   │                                  │
   │  └────────────┬─────────────────────────┘                                  │
   │               │ JSON buffer                                                │
   │               ▼                                                            │
   │  ┌──────────────────────────────────────┐                                  │
   │  │ services/validator                   │ strip md/$math$, cap voice/TFT,  │
   │  │                                      │ reject forbidden LaTeX, render-test│
   │  └────────────┬─────────────────────────┘                                  │
   │               │ validated reply + confidence_after                         │
   │               ▼                                                            │
   │     ┌────── confidence < 0.60? ──── yes ─→ Gemini 2.5 Pro re-roll (Phase 3)│
   │     │                                                                      │
   │     no                                                                     │
   │     ▼                                                                      │
   │  STATE(speaking)                                                           │
   │       │       (asyncio.gather — PARALLEL)                                  │
   │  ┌────┴────────────────┐                                                   │
   │  ▼                     ▼                                                   │
   │ providers/tts_cartesia    providers/latex_renderer                         │
   │   Cartesia Sonic-2        matplotlib mathtext → 320×240 RGB565             │
   │   4 KB / 85 ms chunks     TFT_TEXT (snippet) + chunked TFT_PART × N        │
   │                                                                            │
   │ AUDIO_OUT* → AUDIO_OUT_END    TFT_PART* → TFT_FRAME (terminator)           │
   │             │                            │                                  │
   │             └────────────┬───────────────┘                                  │
   │                          ▼                                                  │
   │                  STATE(idle)                                                │
   │                                                                             │
   │  ┌─── asyncio.create_task — off the hot path ──────────────────────────┐   │
   │  │  services/memory.record_turn        Redis LPUSH + TTL                │   │
   │  │  storage/vector_memory.remember     embed + JSONL append             │   │
   │  │  services/persistence.commit_turn   blobs/{wav,jpg} + turns ledger   │   │
   │  └──────────────────────────────────────────────────────────────────────┘   │
   └────────────────────────────────────────────────────────────────────────────┘
```

## Components (current — end of Phase 6)

### Web app — [`app/`](../app/)

- Next.js 14, Clerk auth, six routes: `/`, `/sign-in`, `/sign-up`, `/devices`, `/pair/[code]`, `/api/webhooks/clerk`.
- Only job: let a user sign in and link / unlink / rename their lamps.
- Uses `@/lib/useApi` to call the FastAPI gateway with a Clerk bearer.

### Gateway — [`lumos-backend/`](../lumos-backend/)

| Module | Phase | Responsibility |
|---|---|---|
| `main.py` | 0 | FastAPI composition, dotenv, dependency wiring, boot-time LaTeX self-test. |
| `app/config.py` | 0–6 | Env-driven settings: provider keys, auth flag, WS chunk caps, TTS pacing, confidence thresholds, streaming TTS flag. |
| `app/protocol.py` | 0+1 | Binary frame codec. 13 frame types incl. chunked `IMAGE_PART (0x05)` + `TFT_PART (0x23)`. |
| `app/session.py` | 0+1 | Per-lamp `Session` + `Turn`. Buffers image/audio across frames; owns `asyncio` tasks for cancellation. |
| `app/schemas.py` | 1+3 | Pydantic `LlmReply { speech, display{kind, content}, is_confident }` + `FALLBACK_REPLY`. |
| `app/prompts.py` | 1 | System prompt with embedded LaTeX-subset warning. |
| `app/providers/llm_gemini.py` | 1+3+4 | Multimodal Gemini Flash + Pro factory, JSON mode, grounding tool toggle, `MockLLM` fallback. |
| `app/providers/tts_cartesia.py` | 1 | Cartesia Sonic-2 stream → re-chunked **4 KB / 85 ms**. `MockTTS` fallback. |
| `app/providers/latex_renderer.py` | 1 | matplotlib mathtext → 320×240 RGB565 BE pixels with multi-frame scroll. |
| `app/services/orchestrator.py` | 1–6 | `run_turn` pipeline. Wires memory → classifier → grounding → LLM → validator → escalation → parallel speak/display → background persistence. |
| `app/services/memory.py` | 2 | Short-term history (last 3 turns, 24 h TTL). |
| `app/services/validator.py` | 3 | Output guardrails: strips markdown/`$math$`, caps voice/TFT length, rejects forbidden LaTeX commands, render-tests LaTeX, lowers `confidence_after` on issues. |
| `app/services/classifier.py` | 4 | Heuristic `(exam_track, needs_grounding)` from history. LLM-based version is post-MVP. |
| `app/services/persistence.py` | 5 | `commit_turn(...)` ships blobs + appends ledger row. Background task only. |
| `app/services/streaming_parser.py` | 6 | Incremental JSON parser — emits `speech` sentences as they stream. |
| `app/routes/ws_lamp.py` | 0+1 | `/lamp/ws` dispatcher: PING / IMAGE_PART / IMAGE_JPEG / AUDIO_CHUNK / AUDIO_END / CANCEL. |
| `app/routes/pairing.py` | 0 | 7 REST endpoints; auth gated by `ENABLE_AUTH`. |
| `app/routes/health.py` | 1 | `/healthz` + `/readyz` (active provider names). |
| `app/auth/device_jwt.py` | 0 | HS256 device JWT (iss=lumos-auth, ver=1) + scrypt secret hashing. |
| `app/auth/devices.py` | 0 | File-backed device registry. Swappable for Postgres later. |
| `app/storage/redis_client.py` | 2 | Async Redis singleton + `MemoryRedis` fallback. |
| `app/storage/vector_memory.py` | 4 | Per-user JSONL store + cosine ANN. Embedder: Gemini `text-embedding-004` when keyed, `HashEmbedder` otherwise. |
| `app/storage/blobs.py` | 5 | `LocalBlobs` (filesystem default) + `S3Blobs` (R2/S3 via `aioboto3`). |
| `app/storage/turns_repo.py` | 5 | JSONL turns ledger per device. Postgres swap is post-MVP. |
| `scripts/mock_lamp.py` | 1 | Dev tool: connects, sends JPEG + WAV, dumps inbound frames, saves `AUDIO_OUT` to `out.wav`. |
| `tests/` | 0–6 | **66 pytest cases** across all 6 phases. |

### Firmware — [`firmware/tutor_lamp/`](../firmware/tutor_lamp/)

- `tutor_lamp.ino` — boot, WiFi connect, pairing, ws_loop service.
- `provisioning.h/.cpp` — NVS storage of device_id / device_secret / device_jwt, `ensure_paired()` flow.
- `net_ws.h/.cpp` — WebSocket client with frame encode/decode, 10 s PING cadence, 2/4/8/16/30/30 s ± 25 % jitter backoff, fatal 4401/4402/4426 handling.
- `config.h` — WiFi creds, backend host/port, pin map.

### Database — [`supabase/migrations/`](../supabase/migrations/)

- `001_create_chat_sessions.sql` — legacy v0.1 chat sessions / messages. Kept for FK targets in `002_…`; no new writes.
- `002_create_lumos_analytics_and_devices.sql` — `users`, `devices`, `pairing_codes`, `topics` (with `exam_track`), `user_mastery`, `mistake_logs`, `user_time_tracking`; `pgvector` extension enabled. Migration 003 (Postgres-backed `turns` + `question_attempts`) is post-MVP — today's ledger lives in `lumos-backend/turns/*.jsonl`.

## Provider fallback matrix

The gateway boots and serves any combination of these:

| Env var(s) | What's live | What's mocked |
|---|---|---|
| `GEMINI_API_KEY` set | `GeminiLLM`, Pro escalation, `text-embedding-004` | — |
| `GEMINI_API_KEY` unset | — | `MockLLM` (canned JSON), `HashEmbedder` (deterministic) |
| `CARTESIA_API_KEY` + `pip install cartesia` | `CartesiaTTS` (Sonic-2) | — |
| `CARTESIA_API_KEY` unset / SDK missing | — | `MockTTS` (silence at correct chunk shape) |
| `REDIS_URL` set + `redis` installed | `redis.asyncio` client | — |
| `REDIS_URL` unset | — | `MemoryRedis` (in-process) |
| `R2_BUCKET` + creds + `pip install aioboto3` | `S3Blobs` | — |
| R2 unset | — | `LocalBlobs` (under `lumos-backend/blobs/`) |
| `STREAMING_TTS=1` | Sentence-level streaming TTS | — |
| `STREAMING_TTS` unset | — | Wait-for-full-JSON path |
| `ENABLE_AUTH=1` | Device-JWT verified on `/lamp/ws` | — |
| `ENABLE_AUTH=0` | — | Any bearer accepted; device_id=`dev-lamp` |

## Status snapshot

| Phase | Scope | Status |
|---|---|---|
| 0 | WS gateway + JWT + binary frames + firmware skeleton + web deprecation | ✅ |
| 1 | Multimodal Gemini + Cartesia + LaTeX + orchestrator + mock_lamp | ✅ |
| 2 | Short-term Redis history | ✅ |
| 3 | Validator + Pro escalation | ✅ |
| 4 | Classifier + Google Search grounding + long-term vector memory | ✅ |
| 5 | Persistence (blobs + ledger) | ✅ |
| 6 | Sentence-level streaming TTS | ✅ |
| Post-MVP | Firmware image-on-wake / wake-word; Postgres backing; LLM classifier; cost rollups; deploy hardening | ⏳ |

See [`changes/01_MASTER_PLAN.md`](changes/01_MASTER_PLAN.md) and
[`changes/BACKEND_TODO.md`](changes/BACKEND_TODO.md) for the spec source.

## Data flow at end of Phase 6

```
ESP32 wake-word → MODE_COMMAND
  capture JPEG (q=12, ~50 KB) → IMAGE_PART × N → IMAGE_JPEG terminator
  AUDIO_CHUNK every 20 ms
  on EOS → AUDIO_END
                       │
                       ▼
  Gateway   STATE(thinking) + TFT_TEXT("Thinking…")
            memory.get_recent_turns        (Phase 2)
            vector_memory.recall            (Phase 4)
            classify_from_text              (Phase 4) → enable_grounding flag
                       │
                       ▼
            Gemini 2.5 Flash multimodal call
              system: SYSTEM_PROMPT
              audio:  WAV (16 kHz mono int16)
              image:  image/jpeg bytes
              history+memory: prepended text part
              tools: [google_search] if grounding
              mime: application/json
              max_output_tokens: 200
            ← stream of JSON token deltas
              │
              ├─ STREAMING_TTS=1?
              │     yes → SpeechSentenceStreamer.feed → sentence queue → TTS
              │     no  → buffer to end of JSON
              │
            ← parse LlmReply
            validate() → confidence_after
              │
              ├─ confidence_after < 0.60?
              │     yes → re-roll with gemini-2.5-pro (Phase 3)
              │
            STATE(speaking)
            ┌── asyncio.gather ──┐
            │                    │
       Cartesia Sonic-2     matplotlib mathtext
       4 KB / 85 ms           320×240 RGB565
            │                    │
       AUDIO_OUT × N         TFT_PART × N + TFT_FRAME
            │                    │
            └────── lamp ────────┘
            AUDIO_OUT_END         (terminator commits to display)
            STATE(idle)
                       │
                       ▼
  Background tasks (asyncio.create_task — off hot path):
    memory.record_turn(device_id, speech, display_kind)
    vector_memory.remember(user_id, speech)
    persistence.commit_turn(turn_id, ..., audio_pcm, image, reply, total_ms)
      → blobs.put(audio.wav, image.jpg)
      → turns_repo.write(TurnRow)
```

LLM/TTS providers are pluggable behind `app/providers/`; swap to OpenAI / ElevenLabs / Kokoro by adding a new module with the same `stream()` async iterator shape.
