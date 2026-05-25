# LUMOS — Task list & roadmap

This document tracks delivery against the LUMOS v4 plan in
[`update/changes/01_MASTER_PLAN.md`](changes/01_MASTER_PLAN.md). The v0.1 web-app
phases (1–7) below are kept for history but are **superseded** by the lamp-only
v4 product.

---

## v4 Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | WebSocket gateway, device JWT, binary frames, ESP32-S3 firmware, web-app deprecation | ✅ Done (2026-05-26) |
| 1 | Turn 1 core: Gemini 2.5 Flash, MSM cache, Redis state, classifier | ⏳ Pending |
| 2 | Turn 2+: Groq Llama 3.3 70B, HINT/FULL routing, attempt counters | ⏳ Pending |
| 3 | Voice + display: Cartesia TTS streaming, TFT two-track formatter | ⏳ Pending |
| 4 | Accuracy: confidence gate, validator, Google Search grounding | ⏳ Pending |
| 5 | Storage + memory: Postgres `turns`/`question_attempts`/`memories`, R2 blobs, pgvector embeddings | ⏳ Pending |
| 6 | Latency tuning: image-on-wake, sentence-level TTS, <1.8 s Turn 1 target | ⏳ Pending |

### Phase 0 deliverables shipped (2026-05-26)

- New backend package [`lumos-backend/`](../lumos-backend/) with the LUMOS module layout (`gateway/`, `schemas/`, `storage/`).
- [`gateway/auth.py`](../lumos-backend/gateway/auth.py): device JWT issue/verify, scrypt secret hashing, `iss=lumos-auth`, `ver=1`.
- [`gateway/pairing.py`](../lumos-backend/gateway/pairing.py): 6 REST endpoints for device/user pairing (register, poll, info, complete, list, unlink, rename).
- [`gateway/websocket.py`](../lumos-backend/gateway/websocket.py): `/lamp/ws` with binary-frame dispatch, 4401/4402 split close codes, PING/PONG, Phase 0 stub turn response.
- [`gateway/session.py`](../lumos-backend/gateway/session.py): in-memory `SessionStore` keyed by device_id.
- [`schemas/frames.py`](../lumos-backend/schemas/frames.py): protocol frame codes (matches `update/changes/IMPLEMENTATION_WEBSOCKET.md`).
- [`storage/devices.py`](../lumos-backend/storage/devices.py): JSON-backed registry (Phase 5 replaces with Postgres).
- 15-test pytest suite covering JWT, registry, frames, and WebSocket round-trip (incl. 4401/4402/PING-PONG/AUDIO_END/CANCEL).
- ESP32-S3 firmware in [`firmware/tutor_lamp/`](../firmware/tutor_lamp/): NVS-stored device id/secret/JWT, pairing flow, persistent WSS connection, 10 s heartbeat, exponential backoff with jitter, basic STATE/TFT_TEXT/PONG handlers.
- v0.1 web app deprecated: ~25 routes, components, hooks, and prompts removed. Web app is now ~6 routes (landing, sign-in/up, devices, pair/[code], clerk webhook). `npm run typecheck`, `lint`, `build` all clean.
- Dependencies trimmed: `@google/generative-ai`, `framer-motion`, `react-markdown`, `rehype-katex`, `remark-math`, `remark-gfm`, `@tailwindcss/typography`, `@notionhq/client` removed.

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
- **Phase 8 roadmap** (WASM offline models, pgvector RAG, Twilio SMS) — folded into v4 Phases 5–6.
