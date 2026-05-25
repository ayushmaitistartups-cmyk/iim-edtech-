# LUMOS — Features

Status as of 2026-05-26 (end of Phase 0). Features that haven't shipped yet
point to the LUMOS phase that will deliver them.

## Shipped

### Pairing & device management

- Sign in / sign up via Clerk.
- Lamp shows a 6-character code on first boot. Visit `/pair/<code>` while signed in, click "Link this lamp", and the lamp polls itself into a paired state.
- `/devices` lists every lamp on the account; supports rename and unlink. Unlinking revokes the device JWT immediately — the next inbound frame from that lamp is closed with code 4402.
- Pairing codes expire after 5 minutes; expired codes are GC'd on the next poll.

### Persistent lamp connection

- ESP32-S3 firmware keeps one persistent WSS to `/lamp/ws` for the lifetime of a session.
- Binary frame protocol (4-byte header + payload) with 12 frame types per [`changes/IMPLEMENTATION_WEBSOCKET.md`](changes/IMPLEMENTATION_WEBSOCKET.md).
- 10 s heartbeat (`PING` → `PONG`).
- Exponential backoff reconnect (2 / 4 / 8 / 16 / 30 / 30 s ± 25 % jitter); fatal stop on 4401 / 4402 / 4426.
- Phase 0 stub turn: on `AUDIO_END`, the gateway answers with `STATE(thinking) → TFT_TEXT → AUDIO_OUT_END → STATE(idle)` so end-to-end transport can be exercised before LLM/TTS land.

## Pending (per LUMOS phase)

| Feature | Phase |
|---|---|
| Wake-word listening ("hey lumos") on-device | 1 |
| Image-on-wake capture, JPEG send | 1 |
| Gemini 2.5 Flash MSM generation with 3-layer cache | 1 |
| Query classifier (6-type taxonomy, exam_track routing) | 1 |
| Groq Llama 3.3 70B Turn 2+ with HINT/FULL nudges | 2 |
| Cartesia streaming TTS | 3 |
| Two-track display: LaTeX-on-TFT (technical) vs text bullets (conceptual) | 3 |
| Confidence-gated validator + Gemini Pro escalation | 4 |
| Google Search grounding for current-affairs exams | 4 |
| Persistent `turns` / `question_attempts` / `memories` with pgvector recall | 5 |
| Cloudflare R2 blob storage for audio + JPEG history | 5 |
| <1.5 s Turn 1 / <500 ms Turn 2+ latency | 6 |

See [`changes/01_MASTER_PLAN.md`](changes/01_MASTER_PLAN.md) for build order
and [`changes/02_WORKFLOW.md`](changes/02_WORKFLOW.md) for the full pipeline.
