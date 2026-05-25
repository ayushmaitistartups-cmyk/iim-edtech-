# LUMOS — Tech stack

Phase 0 is intentionally a thin stack. Phases 1–6 add Redis, Groq, Cartesia,
pgvector, and Cloudflare R2 — see [`changes/05_DECISIONS_AND_COST.md`](changes/05_DECISIONS_AND_COST.md)
for the target list and rationale.

## Currently installed

### Web app ([`package.json`](../package.json))

- Next.js 14 (App Router) + React 18 + TypeScript (strict).
- Tailwind CSS 3.
- `@clerk/nextjs` for user auth.
- `@supabase/supabase-js` (server-only, for the Clerk → Supabase user sync webhook).
- `lucide-react` for icons.
- `svix` to verify Clerk webhook signatures.

### Gateway ([`lumos-backend/requirements.txt`](../lumos-backend/requirements.txt))

- Python 3.11+
- FastAPI 0.110 (works on 0.135 too — pin is conservative).
- Uvicorn (ASGI).
- `websockets`, `pydantic`, `python-dotenv`.
- `httpx`, `pytest`, `pytest-asyncio` for tests.

### Firmware ([`firmware/tutor_lamp/`](../firmware/tutor_lamp/))

- Arduino ESP32 core, target board `esp32:esp32:esp32s3`.
- `WebSockets` (Links2004 / arduinoWebSockets).
- `ArduinoJson` (^7.0).
- `Preferences` (bundled NVS wrapper).

### Database

- Supabase Postgres with `pgvector` extension enabled.
- Tables in use today: `users`, `devices`, `pairing_codes`. Tables ready for Phase 5: `topics`, `user_mastery`, `user_time_tracking`, `mistake_logs`.

## Coming in later phases

| Phase | Adds |
|---|---|
| 1 | Redis (Upstash or self-hosted) for MSM + attempt cache. Google `generativeai` SDK with context caching (Layer 1+2+3). |
| 2 | Groq Python SDK for Llama 3.3 70B. |
| 3 | Cartesia Sonic Python SDK for streaming TTS. |
| 4 | Google Search grounding via Gemini grounding API. |
| 5 | `pgvector` embeddings via `psycopg[binary]` / `sqlalchemy`. Cloudflare R2 via `boto3` (S3-compatible). |
| 6 | OpenTelemetry instrumentation for TTFT / total_ms / cost_usd per turn. |

## Environment variables

| Var | Used by | Required at | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Web | runtime | Clerk dashboard. |
| `CLERK_SECRET_KEY` | Web | runtime | Clerk dashboard. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Web | runtime | Used by `/api/webhooks/clerk`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Web | runtime | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Web | server-only | Webhook user upsert. |
| `NEXT_PUBLIC_BACKEND_URL` | Web | runtime | Gateway base URL (e.g. `http://localhost:8000`). |
| `DEVICE_JWT_SECRET` | Gateway | runtime | HMAC secret for device JWT. Must override the dev fallback in prod. |
| `FRONTEND_BASE_URL` | Gateway | runtime | Used to build pairing URLs returned to the lamp. |
| `DEVICE_STORE_PATH` | Gateway | optional | Path to JSON registry file. Defaults to `lumos-backend/.device_store.json`. |
| `TRUST_UNSIGNED_CLERK_JWT` | Gateway | dev only | Set to `0` in prod once Clerk JWT verification is wired in. |
| `LUMOS_WIFI_SSID` / `LUMOS_WIFI_PASSWORD` / `LUMOS_BACKEND_HOST` | Firmware | build time | Pass via `arduino-cli` `--build-property` flags or edit [`config.h`](../firmware/tutor_lamp/config.h). |

> **Note:** The repo's [`.env.example`](../.env.example) at the root is **stale** — it still lists v0.1 vars (`GEMINI_API_KEY` in the web app, `CLERK_WEBHOOK_SECRET` instead of `CLERK_WEBHOOK_SIGNING_SECRET`, `ADMIN_EMAILS` for a deleted admin route, and `DEVICE_STORE_PATH=backend/...`). Use the table above as the source of truth; the example file will be regenerated when Phase 1 lands.

Phase 1+ adds: `GEMINI_API_KEY`, `GROQ_API_KEY`, `CARTESIA_API_KEY`, `REDIS_URL`, `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`.
