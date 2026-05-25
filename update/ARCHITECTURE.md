# LUMOS — Architecture

## High-level

```
┌────────────────────┐    pair (REST)     ┌──────────────────────────────┐
│   Next.js web app  │ ──────────────────►│   lumos-backend (FastAPI)    │
│  (Clerk auth UI    │                    │                              │
│   + /pair/[code]   │                    │   gateway/pairing.py         │
│   + /devices)      │                    │   gateway/websocket.py       │
└─────────┬──────────┘                    │   gateway/auth.py            │
          │ Clerk session                 │   gateway/session.py         │
          │                               │   schemas/frames.py          │
          ▼                               │   storage/devices.py         │
┌──────────────────────┐                  └─────────────┬────────────────┘
│  Clerk + Supabase    │                                │
│  (users, devices,    │ ◄─────── upsert/delete user ───┤
│   pairing_codes…)    │                                │
└──────────────────────┘                                │
                                                        │  /lamp/ws (binary frames,
                                                        │   Bearer device_jwt)
                                                        ▼
                                            ┌──────────────────────┐
                                            │  ESP32-S3 tutor lamp │
                                            │  (firmware/tutor_lamp)│
                                            └──────────────────────┘
```

## Components (current — end of Phase 0)

### Web app — [`app/`](../app/)

- Next.js 14, Clerk auth, six routes: `/`, `/sign-in`, `/sign-up`, `/devices`, `/pair/[code]`, `/api/webhooks/clerk`.
- Only job: let a user sign in and link / unlink / rename their lamps.
- Uses `@/lib/useApi` to call the FastAPI gateway with a Clerk bearer.

### Gateway — [`lumos-backend/`](../lumos-backend/)

| Module | Responsibility |
|---|---|
| `gateway/auth.py` | Device JWT (HS256, `iss=lumos-auth`, `ver=1`), scrypt secret hashing, pairing code generator. |
| `gateway/pairing.py` | REST endpoints for register / poll / complete / list / unlink / rename. |
| `gateway/websocket.py` | `/lamp/ws` — binary-frame dispatch, 4401/4402 close codes, PING→PONG heartbeat, Phase 0 stub turn response on AUDIO_END / CANCEL. |
| `gateway/session.py` | In-memory `SessionStore` keyed by device_id; one lamp = one session. |
| `schemas/frames.py` | Frame codec (1-byte type, 3-byte BE length, payload). All 12 frame types from the LUMOS spec. |
| `storage/devices.py` | JSON-backed registry. Phase 5 swaps for Postgres without changing the surface. |

### Firmware — [`firmware/tutor_lamp/`](../firmware/tutor_lamp/)

- `tutor_lamp.ino` — boot, WiFi connect, pairing, ws_loop service.
- `provisioning.h/.cpp` — NVS storage of device_id / device_secret / device_jwt, `ensure_paired()` flow.
- `net_ws.h/.cpp` — WebSocket client with frame encode/decode, 10 s PING cadence, 2/4/8/16/30/30 s ± 25 % jitter backoff, fatal 4401/4402/4426 handling.
- `config.h` — WiFi creds, backend host/port, pin map.

### Database — [`supabase/migrations/`](../supabase/migrations/)

- `001_create_chat_sessions.sql` — legacy v0.1 chat sessions / messages. Kept for FK targets in `002_…`; no new writes.
- `002_create_lumos_analytics_and_devices.sql` — `users`, `devices`, `pairing_codes`, `topics` (with `exam_track`), `user_mastery`, `mistake_logs`, `user_time_tracking`; `pgvector` extension enabled.

## What's deferred to later phases

| Phase | Adds |
|---|---|
| 1 | Redis client, MSM cache, query classifier, Gemini 2.5 Flash, Layer 1+2+3 cache. |
| 2 | Groq client, nudge logic (HINT/FULL/DIRECT), attempt counters. |
| 3 | Cartesia streaming TTS, two-track formatter (`tft_formatter`, `latex_validator`, `voice_cleaner`), `track_router`. |
| 4 | Confidence-gate validator, Google Search grounding for conceptual exams. |
| 5 | Postgres `turns`/`question_attempts`/`memories`, Cloudflare R2 blob store, pgvector embeddings. |
| 6 | Latency tuning: parallel image upload on wake, sentence-level TTS, prompt cache warmup. |

See [`changes/04_BACKEND_IMPLEMENTATION.md`](changes/04_BACKEND_IMPLEMENTATION.md) for the target module map.

## Data flow at end of Phase 0

```
ESP32 boot → ensure_paired():
  POST /api/device/register   { device_id, device_secret }
    → { pairing_code, pairing_url, expires_at }
  …user opens pairing_url, clicks "Link this lamp"…
    POST /api/device/complete-pairing { pairing_code }   (Clerk-auth)
      → device_jwt minted in pairing_codes row
  POST /api/device/poll-pairing { device_id, device_secret, pairing_code }
    → { device_jwt }
  NVS save → reboot trust loop

ESP32 loop:
  WSS /lamp/ws  Authorization: Bearer <device_jwt>
    ← STATE(idle)
    every 10 s →  PING
                ← PONG
    on smoke   →  AUDIO_END
                ← STATE(thinking) → TFT_TEXT → AUDIO_OUT_END → STATE(idle)
```

LLM/TTS pipeline arrives in Phase 1+; Phase 0 ends here.
