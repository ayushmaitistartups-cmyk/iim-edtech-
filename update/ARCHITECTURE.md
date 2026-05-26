# LUMOS — Architecture

## High-level

```
┌────────────────────┐    pair (REST)     ┌──────────────────────────────┐
│   Next.js web app  │ ──────────────────►│   lumos-backend (FastAPI)    │
│  (Clerk auth UI    │                    │                              │
│   + /pair/[code]   │                    │   app/routes/pairing.py      │
│   + /devices)      │                    │   app/routes/ws_lamp.py      │
└─────────┬──────────┘                    │   app/auth/device_jwt.py     │
          │ Clerk session                 │   app/session.py             │
          │                               │   app/protocol.py            │
          ▼                               │   app/auth/devices.py        │
┌──────────────────────┐                  └────────┬────────┬────────────┘
│  Clerk + Supabase    │                           │        │
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
   │     STATE(thinking) + TFT_TEXT("Thinking…")                                │
   │             │                                                              │
   │             ▼                                                              │
   │     ┌──────────────────────────────────────┐                               │
   │     │ app/providers/llm_gemini.py          │  audio + image + history     │
   │     │   GeminiLLM (gemini-2.5-flash)       │  → JSON {speech, display}    │
   │     │   MockLLM fallback if no API key     │                               │
   │     └────────────┬─────────────────────────┘                               │
   │                  │ LlmReply                                                │
   │                  ▼                                                          │
   │             STATE(speaking)                                                │
   │                  │                                                          │
   │      ┌───────────┴────────────────┐         (asyncio.gather — PARALLEL)    │
   │      ▼                            ▼                                         │
   │  ┌────────────────────────┐  ┌─────────────────────────────────────────┐  │
   │  │ providers/tts_cartesia │  │ providers/latex_renderer                │  │
   │  │   Cartesia Sonic-2     │  │   matplotlib mathtext → 320×240 RGB565  │  │
   │  │   re-chunk 4 KB        │  │   send as TFT_TEXT (snippet) + TFT_PART │  │
   │  │   pace 85 ms           │  │   chunks ≤2 KB + TFT_FRAME terminator   │  │
   │  └────────────────────────┘  └─────────────────────────────────────────┘  │
   │             │                            │                                  │
   │             ▼                            ▼                                  │
   │     AUDIO_OUT* + AUDIO_OUT_END     TFT_PART* + TFT_FRAME                  │
   │             │                            │                                  │
   │             └────────────┬───────────────┘                                  │
   │                          ▼                                                  │
   │                  STATE(idle)                                                │
   └────────────────────────────────────────────────────────────────────────────┘
```

## Components (current — end of Phase 1)

### Web app — [`app/`](../app/)

- Next.js 14, Clerk auth, six routes: `/`, `/sign-in`, `/sign-up`, `/devices`, `/pair/[code]`, `/api/webhooks/clerk`.
- Only job: let a user sign in and link / unlink / rename their lamps.
- Uses `@/lib/useApi` to call the FastAPI gateway with a Clerk bearer.

### Gateway — [`lumos-backend/`](../lumos-backend/)

| Module | Responsibility |
|---|---|
| `main.py` | FastAPI app composition, dotenv, dependency wiring, boot-time LaTeX self-test. |
| `app/config.py` | Env-driven settings (frozen dataclass): provider keys, auth flag, WS chunk caps, TTS pacing. |
| `app/protocol.py` | Binary frame codec. 12 frame types incl. Phase 1 chunked `IMAGE_PART (0x05)` + `TFT_PART (0x23)`. |
| `app/session.py` | Per-lamp `Session` + `Turn`. Buffers image/audio across frames; owns `asyncio` tasks for cancellation. |
| `app/schemas.py` | Pydantic `LlmReply { speech, display{kind, content} }` + `FALLBACK_REPLY`. |
| `app/prompts.py` | System prompt with embedded LaTeX-subset warning. |
| `app/providers/llm_gemini.py` | Multimodal `gemini-2.5-flash` w/ JSON mode + audio + image. `MockLLM` fallback. |
| `app/providers/tts_cartesia.py` | Cartesia Sonic-2 stream → re-chunked to **4 KB / 85 ms** for the lamp's I2S ring. `MockTTS` fallback. |
| `app/providers/latex_renderer.py` | matplotlib mathtext → 320×240 RGB565 BE pixels with multi-frame scroll for wide equations. |
| `app/services/orchestrator.py` | `run_turn` pipeline. Parallel speak + display legs via `asyncio.gather`. |
| `app/routes/ws_lamp.py` | `/lamp/ws` dispatcher: PING/IMAGE_PART/IMAGE_JPEG/AUDIO_CHUNK/AUDIO_END/CANCEL. |
| `app/routes/pairing.py` | 7 REST endpoints; auth gated by `ENABLE_AUTH`. |
| `app/routes/health.py` | `/healthz` + `/readyz` (active provider names). |
| `app/auth/device_jwt.py` | HS256 device JWT (iss=lumos-auth, ver=1) + scrypt secret hashing. |
| `app/auth/devices.py` | File-backed device registry. Phase 5 swaps to Postgres. |
| `scripts/mock_lamp.py` | Dev tool: connects, sends JPEG + WAV, dumps inbound frames, saves `AUDIO_OUT` to `out.wav`. |
| `tests/` | 26 pytest cases (auth, registry, protocol, WS round-trip, orchestrator, LaTeX). |

### Firmware — [`firmware/tutor_lamp/`](../firmware/tutor_lamp/)

- `tutor_lamp.ino` — boot, WiFi connect, pairing, ws_loop service.
- `provisioning.h/.cpp` — NVS storage of device_id / device_secret / device_jwt, `ensure_paired()` flow.
- `net_ws.h/.cpp` — WebSocket client with frame encode/decode, 10 s PING cadence, 2/4/8/16/30/30 s ± 25 % jitter backoff, fatal 4401/4402/4426 handling.
- `config.h` — WiFi creds, backend host/port, pin map.

### Database — [`supabase/migrations/`](../supabase/migrations/)

- `001_create_chat_sessions.sql` — legacy v0.1 chat sessions / messages. Kept for FK targets in `002_…`; no new writes.
- `002_create_lumos_analytics_and_devices.sql` — `users`, `devices`, `pairing_codes`, `topics` (with `exam_track`), `user_mastery`, `mistake_logs`, `user_time_tracking`; `pgvector` extension enabled. Phase 5 adds `turns` + `question_attempts` (migration 003).

## Provider fallback matrix

| Env | LLM | TTS |
|---|---|---|
| `GEMINI_API_KEY` set | `GeminiLLM` (gemini-2.5-flash) | — |
| `GEMINI_API_KEY` unset | `MockLLM` (canned JSON reply) | — |
| `CARTESIA_API_KEY` set + `cartesia` installed | — | `CartesiaTTS` (Sonic-2) |
| `CARTESIA_API_KEY` unset | — | `MockTTS` (silence at correct chunk shape) |
| `CARTESIA_API_KEY` set, SDK missing | — | `MockTTS` + warning |

The gateway boots and serves requests under any combination of these — useful for local dev where you only have one API key, or for CI where you have none.

## What's deferred to later phases

| Phase | Adds |
|---|---|
| 2 | Redis short-term history (last 3 turns per device) prepended to LLM calls. |
| 3 | Validator (confidence gate + voice/TFT/LaTeX subset checks); Gemini Pro escalation on low confidence. |
| 4 | pgvector cross-session memory; Google Search grounding for current-affairs questions. |
| 5 | Postgres `turns`/`question_attempts` writes, Cloudflare R2 blob storage. |
| 6 | Latency tuning: image upload starts on wake-word, streaming JSON parse, sentence-level TTS, prompt cache warmup. |

See [`changes/01_MASTER_PLAN.md`](changes/01_MASTER_PLAN.md) and
[`changes/BACKEND_TODO.md`](changes/BACKEND_TODO.md) for the full target.

## Data flow at end of Phase 1

```
ESP32 wake-word → MODE_COMMAND
  capture JPEG (q=12, ~50 KB) and stream IMAGE_PART × N → IMAGE_JPEG
  stream AUDIO_CHUNK every 20 ms
  on EOS → send AUDIO_END
                       │
                       ▼
  Gateway   STATE(thinking)
            TFT_TEXT("Thinking…")
            Gemini 2.5 Flash multimodal call
              system: SYSTEM_PROMPT
              audio:  WAV (16 kHz mono int16)
              image:  image/jpeg bytes
              mime:   application/json
              max_output_tokens: 200
            ← stream of JSON token deltas
            ← parse LlmReply
            STATE(speaking)
            ┌── asyncio.gather ──┐
            │                    │
       Cartesia Sonic-2     matplotlib mathtext
            │                    │
       AUDIO_OUT (4 KB)     TFT_PART × N
            │                    │
            └────── lamp ────────┘
            AUDIO_OUT_END  TFT_FRAME (terminator)
            STATE(idle)
```

LLM/TTS providers are pluggable behind `app/providers/`; swap to OpenAI / ElevenLabs / Kokoro by adding a new module with the same `stream()` async iterator shape.
