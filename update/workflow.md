# LUMOS — Workflows

Day-to-day flows shipping at the end of Phase 1. The canonical LLM/TTS
pipeline lives in [`changes/02_WORKFLOW.md`](changes/02_WORKFLOW.md); the
flows below reflect *what's actually wired up today*.

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
5. Lamp serial logs the URL. (Phase 0.5 will render a QR + 6-char display code on the TFT.)
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

## F. A real turn end-to-end (Phase 1)

`t=0` is the wake word firing on the device.

1. **Lamp: capture + stream.**
   - Camera grabs JPEG (~50 KB at q=12).
   - The firmware streams `IMAGE_PART × N` + `IMAGE_JPEG` terminator the moment the JPEG is ready (image-on-wake; the lamp side of this lands in Phase 2 — today it sends at `AUDIO_END` time).
   - Mic starts filling `cmd_buf`; chunks of 320 samples (640 B) ship as `AUDIO_CHUNK` every 20 ms.
   - When VAD reports EOS, lamp sends `AUDIO_END`.
2. **Gateway: ingest.**
   - [`app/routes/ws_lamp.py`](../lumos-backend/app/routes/ws_lamp.py) dispatches each frame to [`app/session.py`](../lumos-backend/app/session.py).
   - `IMAGE_PART` payloads accumulate into `session.turn.image_accum`.
   - `IMAGE_JPEG` terminator commits the buffer to `session.turn.image_bytes`.
   - `AUDIO_CHUNK` payloads append to `session.turn.audio_pcm`.
   - `AUDIO_END` triggers `session.snapshot_and_reset_turn()` → spawns `orchestrator.run_turn(session, image, audio)` as a background task.
3. **Orchestrator: the brain.**
   - Emits `STATE(thinking)` + `TFT_TEXT("Thinking…")` (kills the "spinner during audio" gap).
   - Sanity gate: drops the turn if audio is < 0.5 s or > 30 s (friendly TFT_TEXT instead).
   - Calls [`app/providers/llm_gemini.py`](../lumos-backend/app/providers/llm_gemini.py) `GeminiLLM.stream` — single Gemini 2.5 Flash multimodal call with `audio/wav` + `image/jpeg` parts, `response_mime_type="application/json"`, `max_output_tokens=200`.
   - Concatenates the streamed deltas into a single JSON buffer (logs TTFT on first delta).
   - Parses via Pydantic `LlmReply`. On parse failure / 5xx / timeout → `FALLBACK_REPLY`.
4. **Orchestrator: emit.**
   - `STATE(speaking)`.
   - `asyncio.gather`:
     - **Speak leg** — [`app/providers/tts_cartesia.py`](../lumos-backend/app/providers/tts_cartesia.py) `CartesiaTTS.stream(reply.speech)` yields 24 kHz PCM → re-chunked to **4 KB / 85 ms** → `AUDIO_OUT` frames → `AUDIO_OUT_END`.
     - **Display leg** — depending on `reply.display.kind`:
       - `"text"` → `TFT_TEXT(content[:200])`.
       - `"latex"` → `TFT_TEXT(content[:200])` instantly, then [`app/providers/latex_renderer.py`](../lumos-backend/app/providers/latex_renderer.py) rasterises via matplotlib mathtext → 320×240 RGB565 BE pixels → `TFT_PART × N` + `TFT_FRAME` terminator (≤2 KB per WS message).
       - `"none"` → `TFT_CLEAR`.
5. **Wrap-up.** `STATE(idle)`. The orchestrator logs `turn done in N ms`.

The two output legs run in parallel because the lamp dispatches by frame type — `AUDIO_OUT` goes to the I2S ring, `TFT_PART`/`TFT_FRAME` accumulate in PSRAM. Sequential sends would starve the speaker for seconds on multi-MB LaTeX payloads.

## G. CANCEL (barge-in)

1. Lamp sends `0x04 CANCEL`.
2. Gateway calls `session.cancel_inflight()` → every in-flight `asyncio.Task` for that session is cancelled.
3. Gateway emits `TFT_CLEAR` + `AUDIO_OUT_END` + `STATE(idle)`.
4. The provider streams (Gemini, Cartesia) raise `CancelledError`; no further `AUDIO_OUT` reaches the lamp.

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
```

With `GEMINI_API_KEY` and `CARTESIA_API_KEY` set, the same flow runs against the real providers — no code change needed.

## What changes in later phases

| Phase | Workflow added/altered |
|---|---|
| 2 | Image is sent as soon as the camera capture completes (overlapping with audio). LLM call payload prepends the last 3 turns of history from Redis. |
| 3 | Low-confidence replies escalate to Gemini 2.5 Pro mid-turn; validator strips bad LaTeX or rejects voice payloads outside the safe length cap. |
| 4 | Conceptual-track exams trigger Google Search grounding; per-user pgvector memories are looked up by question embedding. |
| 5 | Each turn writes async to Postgres `turns` and uploads JPEG/audio to Cloudflare R2. |
| 6 | Sentence-level TTS hand-off (first word in ~700 ms instead of 2 s); prompt cache warmup. |
