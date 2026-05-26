# LUMOS — Tech stack

Phase 0 + Phase 1 ship a thin runtime: FastAPI + Gemini + Cartesia + matplotlib.
Phases 2–6 add Redis, pgvector, R2, observability — see
[`changes/05_DECISIONS_AND_COST.md`](changes/05_DECISIONS_AND_COST.md) and
[`changes/BACKEND_TODO.md`](changes/BACKEND_TODO.md) for the target list.

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
- **Pydantic 2.6+** for the `LlmReply` schema and config.
- **google-genai 1.0+** — multimodal Gemini 2.5 Flash client.
- **cartesia 1.0+** — Sonic-2 streaming TTS (optional at install; `MockTTS` if missing or unkeyed).
- **matplotlib 3.7+** + numpy + Pillow — the `mathtext` LaTeX renderer.
- **python-dotenv** — local `.env` loading.
- Test deps: pytest, pytest-asyncio, httpx.

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
| 2 | Redis (Upstash or local Docker) for short-term history. `redis-py` async client. |
| 3 | Validator + Gemini 2.5 Pro escalation client. |
| 4 | `pgvector` embeddings + `text-embedding-3-small`. Google Search grounding via Gemini grounding API. |
| 5 | Postgres `turns`/`question_attempts` via `sqlalchemy[asyncio]` + `asyncpg`. Cloudflare R2 blobs via `aioboto3` (S3-compatible). |
| 6 | OpenTelemetry spans per layer; Prometheus/Grafana for TTFT, total_ms, cost_usd p50/p95. |

## Environment variables

| Var | Used by | Required at | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Web | runtime | Clerk dashboard. |
| `CLERK_SECRET_KEY` | Web | runtime | Clerk dashboard. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Web | runtime | Used by `/api/webhooks/clerk`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Web | runtime | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Web | server-only | Webhook user upsert. |
| `NEXT_PUBLIC_BACKEND_URL` | Web | runtime | Gateway base URL (e.g. `http://localhost:8000`). |
| `ENABLE_AUTH` | Gateway | runtime | `0` accepts any bearer (dev), `1` enforces device JWT. |
| `LLM_PROVIDER` | Gateway | runtime | `gemini` (default). Stub for future fallbacks. |
| `GEMINI_API_KEY` | Gateway | runtime | If absent → `MockLLM`. |
| `GEMINI_MODEL` | Gateway | optional | Defaults to `gemini-2.5-flash`. |
| `TTS_PROVIDER` | Gateway | runtime | `cartesia` (default) or `kokoro_local` (future). |
| `CARTESIA_API_KEY` | Gateway | runtime | If absent → `MockTTS`. |
| `CARTESIA_VOICE_ID` | Gateway | optional | Cartesia voice UUID; falls back to provider default. |
| `DEVICE_JWT_SECRET` | Gateway | runtime | HMAC secret for device JWT. Must override the dev fallback in prod. |
| `FRONTEND_BASE_URL` | Gateway | runtime | Used to build pairing URLs returned to the lamp. |
| `DEVICE_STORE_PATH` | Gateway | optional | Path to JSON registry file. Defaults to `lumos-backend/.device_store.json`. |
| `TRUST_UNSIGNED_CLERK_JWT` | Gateway | dev only | Set to `0` in prod once Clerk JWT verification is wired in. |
| `CORS_ALLOW_ORIGINS` | Gateway | optional | Comma-separated; defaults to `*`. |
| `LUMOS_WIFI_SSID` / `LUMOS_WIFI_PASSWORD` / `LUMOS_BACKEND_HOST` | Firmware | build time | Pass via `arduino-cli` `--build-property` flags or edit [`config.h`](../firmware/tutor_lamp/config.h). |

> **Note:** The repo's [`.env.example`](../.env.example) at the root is **stale** — it still lists v0.1 vars (`GEMINI_API_KEY` in the web app, `CLERK_WEBHOOK_SECRET` instead of `CLERK_WEBHOOK_SIGNING_SECRET`, `ADMIN_EMAILS` for a deleted admin route, and `DEVICE_STORE_PATH=backend/...`). Use the table above as the source of truth; the example file will be regenerated when Phase 2 lands Redis.

Phase 2+ adds: `REDIS_URL`. Phase 3+: `GEMINI_PRO_MODEL` toggle. Phase 4+: `EMBEDDING_MODEL`. Phase 5+: `DATABASE_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT_URL`.
