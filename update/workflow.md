# LUMOS — Workflows

Day-to-day flows shipping at the end of Phase 6. The canonical LLM/TTS
pipeline rationale lives in [`changes/BACKEND_DESIGN.md`](changes/BACKEND_DESIGN.md);
the flows below reflect *what's actually wired up today* and which file
each step lives in.

## A. New user signs up

1. User visits `/`.
2. Clicks **Sign in** or **Create an account** → Clerk modal.
3. Clerk fires `user.created` to `/api/webhooks/clerk` → `upsertUserRecord` writes to Supabase `users`.
4. User lands on `/devices` (empty list).

## B. New lamp out of the box (pairing)

1. Lamp powers on. NVS is empty.
2. [`provisioning.cpp`](../firmware/tutor_lamp/provisioning.cpp) generates a `device_id` (e.g. `lamp-7c9eb4`) and a random secret; stores both in NVS.
3. Lamp connects to WiFi using the SSID compiled into [`config.h`](../firmware/tutor_lamp/config.h).
4. Lamp `POST`s `/api/device/register` `{ device_id, device_secret }` → gateway returns `pairing_code` + `pairing_url`.
5. Lamp serial logs the URL (and, on hardware-ready firmware, renders a QR + 6-char display code on the TFT).
6. User on a signed-in browser opens `/pair/<code>` → calls `/api/pairing-info/<code>` (Clerk-auth) → sees lamp info → clicks **Link this lamp** → `POST /api/device/complete-pairing` mints the device JWT into the `pairing_codes` row.
7. Lamp polls `/api/device/poll-pairing` every 3 s. The next poll returns `{ status: "paired", device_jwt }`; lamp writes the JWT to NVS.
8. Lamp opens `WSS /lamp/ws` with `Authorization: Bearer <device_jwt>`.
9. Gateway verifies signature (or accepts any bearer when `ENABLE_AUTH=0`) → emits `STATE(idle)`. Connection holds for the session.

## C. Lamp reboots later

1. NVS already has `device_id`, `device_secret`, `device_jwt`.
2. WiFi connect → `device_jwt()` non-empty → skip pairing → straight to `WSS /lamp/ws`.
3. If gateway closes with 4402 (device unlinked while offline), [`tutor_lamp.ino`](../firmware/tutor_lamp/tutor_lamp.ino) `on_state(NET_FATAL)` calls `clear_jwt()` + `ESP.restart()` → next boot re-enters pairing.

## D. User unlinks a lamp from `/devices`

1. User clicks **Unlink** in [`DevicesClient.tsx`](../app/devices/DevicesClient.tsx).
2. Web → `POST /api/device/<id>/unlink` (Clerk bearer).
3. Gateway sets `devices.revoked_at` and clears `user_id`.
4. Next inbound frame from that lamp → `get_active_device_for_jwt` returns `None` → gateway sends `STATE(AUTH_REVOKED)` and closes with 4402.
5. Lamp clears JWT and re-pairs on next boot.

## E. Heartbeat & reconnect

- Lamp sends `0xF0 PING` every 10 s.
- Gateway responds with `0xF1 PONG`.
- If TCP drops, lamp's [`net_ws.cpp`](../firmware/tutor_lamp/net_ws.cpp) schedules a reconnect after `2 / 4 / 8 / 16 / 30 / 30 s ± 25 % jitter`. Backoff resets on successful connect.

## F. A real turn end-to-end (Phase 6, current)

`t=0` is the wake word firing on the device.

1. **Lamp: capture + stream.**
   - Camera grabs JPEG (~50 KB at q=12).
   - Firmware streams `IMAGE_PART × N` + `IMAGE_JPEG` terminator the moment the JPEG is ready.
   - Mic starts filling `cmd_buf`; chunks of 320 samples (640 B) ship as `AUDIO_CHUNK` every 20 ms.
   - When VAD reports EOS, lamp sends `AUDIO_END`.
2. **Gateway: ingest.**
   - [`app/routes/ws_lamp.py`](../lumos-backend/app/routes/ws_lamp.py) dispatches each frame to [`app/session.py`](../lumos-backend/app/session.py).
   - `IMAGE_PART` payloads accumulate into `session.turn.image_accum`; `IMAGE_JPEG` terminator commits to `session.turn.image_bytes`.
   - `AUDIO_CHUNK` payloads append to `session.turn.audio_pcm`.
   - `AUDIO_END` triggers `session.snapshot_and_reset_turn()` → spawns `orchestrator.run_turn(session, image, audio)` as a background task.
3. **Orchestrator: pre-call setup.**
   - Emits `STATE(thinking)` + `TFT_TEXT("Thinking…")` to kill the "spinner during audio" gap.
   - Sanity gates: drops audio < 0.5 s or > 30 s with a friendly TFT_TEXT.
   - [`services/memory.get_recent_turns`](../lumos-backend/app/services/memory.py) — pulls last 3 turns from Redis (or `MemoryRedis` fallback).
   - [`storage/vector_memory.recall`](../lumos-backend/app/storage/vector_memory.py) — top-3 cosine-sim recall over the user's prior turns.
   - [`services/classifier.classify_from_text`](../lumos-backend/app/services/classifier.py) — derives `(exam_track, needs_grounding)` from rendered history.
4. **Orchestrator: LLM call.**
   - [`providers/llm_gemini.GeminiLLM.stream`](../lumos-backend/app/providers/llm_gemini.py) — single Gemini 2.5 Flash multimodal call with `audio/wav` + `image/jpeg` + history text. `enable_grounding=True` toggles the Google Search tool when the classifier opts in. `response_mime_type="application/json"`, `max_output_tokens=200`.
   - If `STREAMING_TTS=1`: [`services/streaming_parser.SpeechSentenceStreamer`](../lumos-backend/app/services/streaming_parser.py) extracts each complete sentence from the streaming JSON and feeds a queue. A background `_speak_streaming` task drains the queue and calls Cartesia per sentence — first audio arrives ~700 ms after AUDIO_END instead of ~2 s.
   - Otherwise: concatenates all deltas into a single JSON buffer; logs TTFT and total ms.
5. **Orchestrator: validate + maybe escalate.**
   - Parses via Pydantic `LlmReply`. On parse failure → `FALLBACK_REPLY`.
   - [`services/validator.validate`](../lumos-backend/app/services/validator.py) — strips markdown / `$math$` from speech, caps voice (≤4 sentences / ≤350 chars) and TFT_TEXT (≤200 B), rejects forbidden mathtext commands, render-tests LaTeX (falls back to `text` on failure). Returns a massaged reply plus `confidence_after`.
   - If `confidence_after < CONFIDENCE_ESCALATE_BELOW` (default 0.60): re-rolls the same call against `gemini-2.5-pro` and re-validates.
   - If `confidence_after < CONFIDENCE_REVIEW_BELOW` (default 0.85): logs as review-zone but ships anyway.
6. **Orchestrator: emit.**
   - `STATE(speaking)`.
   - `asyncio.gather`:
     - **Speak leg** — [`providers/tts_cartesia.CartesiaTTS.stream`](../lumos-backend/app/providers/tts_cartesia.py) (or already-running streaming task) yields 24 kHz PCM → re-chunked to **4 KB / 85 ms** → `AUDIO_OUT` frames → `AUDIO_OUT_END`.
     - **Display leg** — depending on `reply.display.kind`:
       - `"text"` → `TFT_TEXT(content[:200])`.
       - `"latex"` → `TFT_TEXT(content[:200])` instantly, then [`providers/latex_renderer.render`](../lumos-backend/app/providers/latex_renderer.py) rasterises via matplotlib mathtext → 320×240 RGB565 BE pixels → `TFT_PART × N` + `TFT_FRAME` terminator (≤2 KB per WS message).
       - `"none"` → `TFT_CLEAR`.
7. **Wrap-up + persistence (off hot path).** `STATE(idle)`. Three background tasks fire and forget:
   - `memory.record_turn(device_id, speech, display_kind)` — appends to Redis history.
   - `vector_memory.remember(user_id, speech)` — embeds + writes to the user's JSONL.
   - [`services/persistence.commit_turn`](../lumos-backend/app/services/persistence.py) — uploads `audio.wav` + `image.jpg` blobs and appends a row to the turns ledger.

The two output legs run in parallel because the lamp dispatches by frame type — `AUDIO_OUT` goes to the I2S ring, `TFT_PART`/`TFT_FRAME` accumulate in PSRAM. Sequential sends would starve the speaker for seconds on multi-MB LaTeX payloads.

## G. CANCEL (barge-in)

1. Lamp sends `0x04 CANCEL`.
2. Gateway calls `session.cancel_inflight()` → every in-flight `asyncio.Task` for that session is cancelled (LLM stream, TTS stream, streaming-speak task, latex render).
3. Gateway emits `TFT_CLEAR` + `AUDIO_OUT_END` + `STATE(idle)`.
4. Provider streams raise `CancelledError`; no further `AUDIO_OUT` reaches the lamp.

## H. Local dev integration test

```bash
cd lumos-backend
uvicorn main:app --reload --port 8000

# In another shell:
python scripts/mock_lamp.py --silent
# → connects with Bearer dev-mode-no-auth
# → sends a 1×1 placeholder JPEG
# → streams 2 s of silence as AUDIO_CHUNKs
# → sends AUDIO_END
# → receives STATE(thinking) → TFT_TEXT("Thinking…") → STATE(speaking)
#   → AUDIO_OUT × N → AUDIO_OUT_END → STATE(idle)
# → saves out.wav (silence from MockTTS)
# → ledger row appended to lumos-backend/turns/dev-lamp.jsonl
# → blob written to lumos-backend/blobs/dev-lamp/<turn_id>.wav
```

With the real provider keys set, the same flow runs against live Gemini + Cartesia + Redis + R2 — no code change needed. See the env-var matrix in [`TECH_STACK.md`](TECH_STACK.md).

## What's NOT yet wired

- **Hardware-side image-on-wake.** Firmware capture still triggers on `MODE_COMMAND` start, and the order of `IMAGE_PART` / `AUDIO_CHUNK` ship is sequential. Overlapping image upload with audio capture saves ~150 ms; landed in firmware-side work.
- **Postgres-backed `turns_repo` + `vector_memory`.** Today both use file fallbacks. The interface is the same; swap is one factory change per module.
- **LLM-based classifier.** Today it's a keyword heuristic. The full 6-type taxonomy classifier in [`changes/03_SYSTEM_PROMPTS_AND_INSTRUCTIONS.md`](changes/03_SYSTEM_PROMPTS_AND_INSTRUCTIONS.md) needs a separate cheap Gemini Flash text-only call.
- **Async transcription worker.** `turns.transcript` is `NULL`. A worker reading `audio.wav` blobs and writing back the Whisper transcript is the analytics-search unlock.
- **Production hardening.** TLS, rate limits, OpenTelemetry, Dockerfile, region pinning — see [`changes/BACKEND_TODO.md`](changes/BACKEND_TODO.md) Layer 11.
