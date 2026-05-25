# LUMOS — Workflows

Day-to-day flows shipping at the end of Phase 0. LLM/TTS flows are described
in [`changes/02_WORKFLOW.md`](changes/02_WORKFLOW.md); they will be implemented
during Phases 1–4.

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
9. Gateway verifies signature → checks `devices` row → emits `STATE(idle)`. Connection holds for the session.

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

## F. Phase 0 smoke test (manual)

After pairing, [`tutor_lamp.ino`](../firmware/tutor_lamp/tutor_lamp.ino) `loop()` sends an empty `AUDIO_END` frame every 30 s. The gateway answers with `STATE(thinking) → TFT_TEXT("Gateway is ready. LLM pipeline ships in Phase 1.") → AUDIO_OUT_END → STATE(idle)`. Serial logs the round trip. This is the seam that Phase 1 will replace with the real orchestrator.

## What changes in later phases

| Phase | Workflow added/altered |
|---|---|
| 1 | Wake-word detection on-device fires `IMAGE_JPEG` + `AUDIO_CHUNK*` + `AUDIO_END`; gateway runs Turn 1 (classify → MSM → nudge). |
| 2 | Repeat-question short-circuit fetches MSM from Redis, routes to Groq for Turn 2+. |
| 3 | Backend streams real `AUDIO_OUT` PCM from Cartesia and `TFT_FRAME` LaTeX pixels. |
| 4 | Validator may emit `STATE(error)` and reject a turn that fails the confidence gate before TTS. |
| 5 | Each turn writes async to Postgres `turns` and uploads JPEG/audio to Cloudflare R2. |
| 6 | Image upload starts on wake-word detection, not on `AUDIO_END` — hides ~300 ms. |
