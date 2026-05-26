# LUMOS — Tech stack

Phase 0–6 shipped. Runtime is FastAPI + Gemini + Cartesia + matplotlib +
optional Redis / aioboto3. Every layer has an in-process / file-backed
fallback that activates when its env var is absent or its SDK is missing,
so the gateway boots and round-trips in CI without any of them.

## Currently installed

### Web app ([`package.json`](../package.json))

- Next.js 14 (App Router) + React 18 + TypeScript (strict).
- Tailwind CSS 3.
- `@clerk/nextjs` for user auth.
- `@supabase/supabase-js` (server-only, for the Clerk → Supabase user sync webhook).
- `lucide-react` for icons.
- `svix` to verify Clerk webhook signatures.

### Gateway ([`lumos-backend/requirements.txt`](../lumos-backend/requirements.txt))

- Python 3.11+.
- **FastAPI 0.110+** + Uvicorn (ASGI) + `websockets`.
- **Pydantic 2.6+** — schemas + config.
- **google-genai 1.0+** — multimodal Gemini 2.5 Flash + 2.5 Pro escalation + `text-embedding-004`.
- **cartesia 1.0+** — Sonic-2 streaming TTS *(optional at install; `MockTTS` if missing or unkeyed)*.
- **matplotlib 3.7+** + numpy + Pillow — `mathtext` LaTeX renderer.
- **python-dotenv** — local `.env` loading.
- Test deps: pytest, pytest-asyncio, httpx.

### Firmware ([`firmware/tutor_lamp/`](../firmware/tutor_lamp/))

- Arduino ESP32 core, target board `esp32:esp32:esp32s3`.
- `WebSockets` (Links2004 / arduinoWebSockets).
- `ArduinoJson` (^7.0).
- `Preferences` (bundled NVS wrapper).

### Database

- Supabase Postgres with `pgvector` extension enabled.
- Tables in use today: `users`, `devices`, `pairing_codes`. Tables reserved for the Postgres swap of `turns_repo` + `vector_memory`: `topics`, `user_mastery`, `user_time_tracking`, `mistake_logs`. Migration `003_create_turns_and_attempts.sql` (post-MVP) lands `turns` + `question_attempts` to match the JSONL ledger that ships today.

## Optional deps — pip install when needed

| Package | Activates | When to install |
|---|---|---|
| `redis>=5.0` | `RedisClient` (replaces `MemoryRedis`) | When `REDIS_URL` is set. |
| `aioboto3>=12` | `S3Blobs` (replaces `LocalBlobs`) | When `R2_BUCKET` + creds are set. |
| `sqlalchemy[asyncio]>=2.0` + `asyncpg>=0.29` | Postgres-backed `turns_repo` + `vector_memory` (post-MVP swap) | When `DATABASE_URL` is set. |
| `opentelemetry-instrumentation-fastapi` | Per-layer spans | Production hardening (Phase 11 of BACKEND_TODO). |

## Environment variables — current contract

| Var | Used by | Required at | Notes |
|---|---|---|---|
| **Web app** | | | |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Web | runtime | Clerk dashboard. |
| `CLERK_SECRET_KEY` | Web | runtime | Clerk dashboard. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Web | runtime | Used by `/api/webhooks/clerk`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Web | runtime | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Web | server-only | Webhook user upsert. |
| `NEXT_PUBLIC_BACKEND_URL` | Web | runtime | Gateway base URL (e.g. `http://localhost:8000`). |
| **Gateway — runtime** | | | |
| `ENABLE_AUTH` | Gateway | runtime | `0` accepts any bearer (dev), `1` enforces device JWT. |
| `DEVICE_JWT_SECRET` | Gateway | runtime | HMAC secret for device JWT. Must override the dev fallback in prod. |
| `FRONTEND_BASE_URL` | Gateway | runtime | Used to build pairing URLs returned to the lamp. |
| `DEVICE_STORE_PATH` | Gateway | optional | JSON registry path. Default: `lumos-backend/.device_store.json`. |
| `TRUST_UNSIGNED_CLERK_JWT` | Gateway | dev only | Set to `0` in prod once Clerk JWT verification is wired in. |
| `CORS_ALLOW_ORIGINS` | Gateway | optional | Comma-separated; defaults to `*`. |
| **Gateway — LLM** | | | |
| `LLM_PROVIDER` | Gateway | optional | `gemini` (default). |
| `GEMINI_API_KEY` | Gateway | optional | If absent → `MockLLM`. |
| `GEMINI_MODEL` | Gateway | optional | Default: `gemini-2.5-flash`. |
| `GEMINI_PRO_MODEL` | Gateway | optional | Default: `gemini-2.5-pro`. Used by Phase 3 escalation. |
| `CONFIDENCE_ESCALATE_BELOW` | Gateway | optional | Default: `0.60`. Confidence threshold for Pro re-roll. |
| `CONFIDENCE_REVIEW_BELOW` | Gateway | optional | Default: `0.85`. Below → log as review-zone but ship anyway. |
| **Gateway — TTS** | | | |
| `TTS_PROVIDER` | Gateway | optional | `cartesia` (default). |
| `CARTESIA_API_KEY` | Gateway | optional | If absent → `MockTTS`. |
| `CARTESIA_VOICE_ID` | Gateway | optional | Cartesia voice UUID; falls back to provider default. |
| `STREAMING_TTS` | Gateway | optional | `1` enables sentence-level TTS hand-off. ~700 ms vs ~2 s TTFT. |
| **Gateway — storage** | | | |
| `REDIS_URL` | Gateway | optional | If absent → `MemoryRedis` (in-process). |
| `R2_BUCKET` | Gateway | optional | Combine with `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` to enable `S3Blobs`. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Gateway | optional | Required when `R2_BUCKET` is set. |
| `R2_ENDPOINT_URL` | Gateway | optional | Cloudflare R2 endpoint URL (S3-compatible); leave unset for AWS S3. |
| **Firmware (build time)** | | | |
| `LUMOS_WIFI_SSID` / `LUMOS_WIFI_PASSWORD` / `LUMOS_BACKEND_HOST` | Firmware | build time | Pass via `arduino-cli --build-property` flags or edit [`config.h`](../firmware/tutor_lamp/config.h). |

> **Note:** The repo's [`.env.example`](../.env.example) at the root is **stale** — it still lists v0.1 vars (`GEMINI_API_KEY` in the web app, `CLERK_WEBHOOK_SECRET` instead of `CLERK_WEBHOOK_SIGNING_SECRET`, `ADMIN_EMAILS` for a deleted admin route, and `DEVICE_STORE_PATH=backend/...`). Use the table above as the source of truth; the example file will be regenerated when CI deploy lands.

## Post-MVP additions

| Phase | Adds |
|---|---|
| Post-MVP | `sqlalchemy[asyncio]` + `asyncpg` (Postgres-backed `turns_repo` + `vector_memory`). |
| Post-MVP | OpenTelemetry spans + Prometheus exporter for TTFT / total_ms / cost_usd p50/p95. |
| Post-MVP | Groq Whisper async transcription worker for offline analytics search. |
| Post-MVP | LLM-based classifier (replaces the keyword heuristic) — same Gemini Flash, text-only, ~100 ms TTFT. |
