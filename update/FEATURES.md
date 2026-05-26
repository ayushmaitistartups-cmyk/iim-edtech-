# LUMOS — Features

Status as of 2026-05-26 (end of Phase 6). Backend is **code-complete**;
every feature ships and runs against mocks today. Real LLM/TTS/Redis/R2
flip on when keys are added — no code change required.

## Shipped

### Pairing & device management (Phase 0)

- Sign in / sign up via Clerk.
- Lamp shows a 6-character code on first boot. Visit `/pair/<code>` while signed in, click "Link this lamp", and the lamp polls itself into a paired state.
- `/devices` lists every lamp on the account; supports rename and unlink. Unlinking revokes the device JWT immediately — the next inbound frame from that lamp is closed with code 4402.
- Pairing codes expire after 5 minutes; expired codes are GC'd on the next poll.

### Persistent lamp connection (Phase 0)

- ESP32-S3 firmware keeps one persistent WSS to `/lamp/ws` for the lifetime of a session.
- Binary frame protocol (4-byte header + payload) with 13 frame types incl. `IMAGE_PART (0x05)` and `TFT_PART (0x23)` chunking.
- 10 s heartbeat (`PING` → `PONG`).
- Exponential backoff reconnect (2 / 4 / 8 / 16 / 30 / 30 s ± 25 % jitter); fatal stop on 4401 / 4402 / 4426.

### The brain (Phase 1)

- **Multimodal Gemini 2.5 Flash** — audio (PCM wrapped as WAV) + image bytes + system prompt in a single API call. No STT step. JSON mode guarantees parseable output.
- **Structured reply** — every turn emits `{"speech", "display": {"kind": "latex|text|none", "content"}, "is_confident"}`. Parsed via Pydantic; falls back to a friendly "Sorry, try again" message on parse failure.
- **Cartesia Sonic-2 streaming TTS** — PCM re-chunked to **exactly 4 KB** (= 85.3 ms playback), paced at **85 ms**.
- **LaTeX → TFT rendering** — matplotlib `mathtext` rasterises to 320×240 RGB565 BE. Wide equations get a multi-frame scroll. Chunked `TFT_PART × N` + `TFT_FRAME` terminator.
- **Parallel speak + display** — TTS audio and `TFT_FRAME` chunks fan out via `asyncio.gather` so audio reaches the speaker while LaTeX paints in background.
- **Provider fallbacks** — `MockLLM` and `MockTTS` activate when API keys are absent.
- **Sanity gates** — audio < 0.5 s or > 30 s dropped with a friendly TFT_TEXT; images > 200 KB rejected.
- **CANCEL handling** — in-flight turn cancelled; lamp gets `TFT_CLEAR` + `AUDIO_OUT_END` + `STATE(idle)`.

### Short-term memory (Phase 2)

- Last 3 turns of `(speech, display_kind)` per device cached in Redis (or in-process `MemoryRedis` fallback).
- Rendered chronologically and prepended to every Gemini call.
- 24 h TTL; cleared on `unlink`. Resilient to Redis outages — failures are logged but never break the live response path.

### Validator + Gemini Pro escalation (Phase 3)

- Strips markdown fences and stray `$math$` from `speech`.
- Caps voice to ≤4 sentences / ≤350 chars; crops `TFT_TEXT` to ≤200 bytes.
- Rejects forbidden mathtext commands (`\boxed`, `\tfrac`, `aligned/cases/array` envs, etc.) and falls back to a text snippet.
- Pre-renders LaTeX at validation time; falls back to `text` when matplotlib chokes.
- Confidence gate: replies under `CONFIDENCE_ESCALATE_BELOW` (default 0.60) trigger a `gemini-2.5-pro` re-roll. The Pro reply is re-validated and shipped.

### Classifier + Google Search grounding (Phase 4)

- Heuristic classifier reads recent history → `(exam_track, needs_grounding, rationale)`.
- Technical exams (JEE/NEET/GATE) never trigger grounding (no current-affairs).
- Conceptual exams (UPSC/CAT/SSC) with current-affairs hints enable Gemini's `google_search` tool on the call.

### Cross-session memory (Phase 4)

- Per-user JSONL store under `<DATA_DIR>/memories/{user_id}.jsonl`.
- Embedder: Gemini `text-embedding-004` when keyed, deterministic `HashEmbedder` otherwise.
- Top-K cosine recall (k=3) over the user's prior turns; prepended to the LLM call alongside short-term history.

### Persistence (Phase 5)

- Per-turn artefacts saved off the hot path: audio WAV + image JPEG go to the blob store; analytics row goes to the turns ledger.
- Blob store: `LocalBlobs` (filesystem, default) or `S3Blobs` (R2/S3 via `aioboto3`).
- Turns ledger: `FileTurnsRepo` (JSONL per device, default). Row shape matches the Postgres schema in `BACKEND_DESIGN §4.7`.
- Background `asyncio.create_task` — never blocks the response path.

### Sentence-level streaming TTS (Phase 6)

- Incremental JSON parser watches the LLM token stream for the `"speech":"..."` field and emits each complete sentence as it arrives.
- When `STREAMING_TTS=1`, TTS starts on the first complete sentence instead of waiting for the full JSON close. Saves ~1.3 s on Turn 1.
- Handles JSON escape sequences, `"speech"` key splits across chunk boundaries, and run-on speech (force-flushes at 120 chars).

## Pending (post-MVP)

| Item | Lives in |
|---|---|
| Wake-word listening + image-on-wake capture | Firmware (`tutor_lamp.ino`) |
| Postgres-backed `turns_repo` + `vector_memory` | Backend swap when `DATABASE_URL` lands |
| LLM-based classifier (6-type taxonomy + difficulty) replacing the keyword heuristic | `app/services/classifier.py` |
| Async transcription worker (Groq Whisper) for analytics search | New worker module |
| Cost rollups + Metabase / Grafana dashboards | Ops |
| TLS termination, rate limits, OpenTelemetry | Deploy story |

See [`changes/01_MASTER_PLAN.md`](changes/01_MASTER_PLAN.md) and
[`changes/BACKEND_TODO.md`](changes/BACKEND_TODO.md) for context, and
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) for the live "flip a
switch" matrix.
