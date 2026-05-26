# BACKEND_TODO.md — Implementation checklist for the AI Tutor Lamp backend

> **Reference:** `BACKEND_DESIGN.md` (the architecture), `IMPLEMENTATION_WEBSOCKET.md`
> (the wire protocol), `IMPLEMENTATION_AUTH_PAIRING.md` (pairing/auth — deferred).
>
> **Stack:** Python 3.11+ · FastAPI · uvicorn · async SQLAlchemy / asyncpg ·
> Redis · Gemini API · Cartesia (or Kokoro local) · existing `Latex_engine_tft.py`.
>
> **How to read this doc:** follow the phases top-to-bottom. Each phase ends in
> a "✅ Done when" cue you can verify. Phases are ordered so each one is
> meaningfully testable on its own — you can ship the audio/LLM loop without
> ever touching auth or storage.
>
> **Auth + pairing:** deferred per user direction. Backend should accept any
> JWT (or a dummy `"dev-mode-no-auth"`) until `ENABLE_AUTH` is flipped on the
> lamp. The spec lives in `IMPLEMENTATION_AUTH_PAIRING.md`.

---

## 0. Project scaffolding

The bones. Everything downstream assumes this exists.

- [ ] `python -m venv .venv && source .venv/bin/activate`
- [ ] `pip install fastapi "uvicorn[standard]" pydantic pydantic-settings python-dotenv`
- [ ] Suggested folder layout:
  ```
  backend/
    app/
      main.py                    # FastAPI app, routes, WS endpoint
      config.py                  # env-driven settings (pydantic-settings)
      logging.py                 # structured logging setup
      protocol.py                # frame type enum + encode/decode helpers
      session.py                 # per-lamp session state (turn buffers)
      providers/
        llm_gemini.py            # multimodal Gemini Flash client
        tts_cartesia.py          # streaming TTS (or kokoro_local.py)
        latex_renderer.py        # thin wrapper over Latex_engine_tft.py
      services/
        orchestrator.py          # the turn pipeline (audio in → response out)
        memory.py                # optional short-term + vector memory
      routes/
        ws_lamp.py               # /lamp/ws WebSocket endpoint
        health.py                # /healthz
      db/
        models.py                # SQLAlchemy (later phase)
        migrations/              # alembic (later phase)
    scripts/
      mock_lamp.py               # fake ESP32 client for dev (sends PCM + JPEG)
    tests/
    .env.example
    pyproject.toml
  ```
- [ ] `.env.example`:
  ```
  GEMINI_API_KEY=
  CARTESIA_API_KEY=
  DATABASE_URL=postgresql+asyncpg://...
  REDIS_URL=rediss://...
  DEVICE_JWT_SECRET=                 # only needed once ENABLE_AUTH=1 on lamps
  ENABLE_AUTH=false
  TTS_PROVIDER=cartesia              # or kokoro_local
  LLM_PROVIDER=gemini                # or openai
  ```
- [ ] Minimal `app/main.py` with health check + WS route stub.

✅ **Done when:** `uvicorn app.main:app --reload` boots, `GET /healthz` returns 200, `wscat -c ws://localhost:8000/lamp/ws` connects.

---

## Layer 1 · WebSocket gateway (ESP32 ⇄ backend)

This is the foundation. Everything else hooks onto it.

### 1.1 Wire-protocol primitives
Match `IMPLEMENTATION_WEBSOCKET.md` §4.2 exactly.

- [ ] `app/protocol.py`:
  ```python
  from enum import IntEnum

  class FrameType(IntEnum):
      IMAGE_JPEG     = 0x01   # terminator for chunked image (or whole image if small)
      AUDIO_CHUNK    = 0x02
      AUDIO_END      = 0x03
      CANCEL         = 0x04
      IMAGE_PART     = 0x05   # intermediate chunk of a chunked image (lamp→backend)
      AUDIO_OUT      = 0x10
      AUDIO_OUT_END  = 0x11
      TFT_FRAME      = 0x20   # terminator for chunked TFT frame
      TFT_TEXT       = 0x21
      TFT_CLEAR      = 0x22
      TFT_PART       = 0x23   # intermediate chunk of a chunked TFT frame (backend→lamp)
      STATE          = 0x30

  def decode(buf: bytes) -> tuple[int, bytes]:
      if len(buf) < 4: raise ValueError("short frame")
      t = buf[0]
      n = (buf[1] << 16) | (buf[2] << 8) | buf[3]
      if 4 + n > len(buf): raise ValueError("truncated")
      return t, buf[4:4 + n]

  def encode(type_: int, payload: bytes = b"") -> bytes:
      n = len(payload)
      return bytes([type_, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF]) + payload
  ```
- [ ] Unit-test round-trip for every frame type with both 0-byte and >64 KB payloads.

### 1.2 WebSocket endpoint
- [ ] `routes/ws_lamp.py`:
  ```python
  @router.websocket("/lamp/ws")
  async def lamp_ws(ws: WebSocket):
      jwt = extract_bearer(ws.headers.get("authorization", ""))
      device_id = await authenticate(jwt)            # dev: returns "dev-lamp"
      if not device_id:
          await ws.close(code=4401); return
      session = Session(device_id, ws)
      try:
          await ws.accept()
          async for msg in ws.iter_bytes():
              t, payload = decode(msg)
              await session.on_frame(t, payload)
      except WebSocketDisconnect:
          await session.close()
  ```
- [ ] **Dev-mode auth bypass** (matches the lamp's `ENABLE_AUTH=0`):
  ```python
  async def authenticate(jwt: str) -> str | None:
      if settings.ENABLE_AUTH is False:
          return "dev-lamp"                          # accept anything
      # real path: verify_device_jwt (per IMPLEMENTATION_AUTH_PAIRING §6.3)
      ...
  ```
- [ ] Set max WS message size ≥ **256 KB** for OUTBOUND only (`max_size` in `websockets.serve`) — the BACKEND must accept any size from the lamp side. INBOUND to lamp is hard-capped at **~4 KB per WS message** by the lamp's `ArduinoWebsockets` library (heap fragmentation otherwise → reboot). The backend MUST chunk all large payloads — see `HARDWARE_CONTEXT.md §6` "WS MAX FRAME SIZE" rule.
- [ ] Heartbeat — FastAPI/WebSocket has no built-in ping; rely on the lamp's 10 s ping. If no traffic for 60 s, drop the socket and let the lamp reconnect.

### 1.3 Send helpers
- [ ] `Session.send_frame(type_, payload)` wraps `await ws.send_bytes(encode(...))`.
- [ ] Add `send_state(byte)`, `send_text(s)`, `send_clear()`, `send_audio_chunk(pcm)`, `send_audio_end()`, `send_tft_frame(w, h, n, pixels)` convenience methods.

### 1.4 Backpressure + cleanup
- [ ] If the lamp's queue is full or the underlying TCP is slow, `send_bytes` will block. Wrap in `asyncio.wait_for(..., timeout=2.0)`; on timeout, log and close (lamp will reconnect).
- [ ] On disconnect, cancel any in-flight LLM / TTS task for that session so we don't burn provider tokens for nothing.

### 1.5 Per-session state object
- [ ] `Session` holds:
  - `device_id`, `ws`
  - `current_turn` — a `Turn` object with `image_bytes`, `audio_pcm: bytearray`, `started_at`
  - `tasks: dict[str, asyncio.Task]` — so CANCEL can stop the in-flight LLM/TTS
- [ ] Reset `current_turn` on AUDIO_END (after handing off) and on CANCEL.

✅ **Done when:** `scripts/mock_lamp.py` (below) connects, ships a JPEG + a few AUDIO_CHUNKs + AUDIO_END, and the backend logs the byte counts of each.

### 1.6 Dev tool — `scripts/mock_lamp.py`
- [ ] Connects to `ws://localhost:8000/lamp/ws` with `Authorization: Bearer dev-mode-no-auth`.
- [ ] Reads a local `test.jpg` → sends as `FRAME_IMAGE_JPEG`.
- [ ] Reads a local `test.wav` (16 kHz mono int16) → chunks 320 samples (640 B) → sends as `FRAME_AUDIO_CHUNK` every 20 ms.
- [ ] After last chunk → sends `FRAME_AUDIO_END`.
- [ ] Prints any inbound `FRAME_AUDIO_OUT` / `TFT_FRAME` / `TFT_TEXT` / `TFT_CLEAR` / `STATE` it receives.
- [ ] Saves received AUDIO_OUT to `out.wav` for ear-test.

✅ **Done when:** mock lamp completes a full round-trip with the dummy backend (echo handler).

---

## Layer 2 · Input processing (image + audio)

The frames arrive piecewise — buffer them into a coherent "turn input."

### 2.1 Image (IMAGE_PART × N + IMAGE_JPEG terminator)
The lamp chunks every image to obey the ~4 KB WS message limit.
- [ ] Maintain `session.image_accum: bytearray()` per session.
- [ ] On `FRAME_IMAGE_PART` (`0x05`): `session.image_accum.extend(payload)`. Don't decode anything yet.
- [ ] On `FRAME_IMAGE_JPEG` (`0x01`):
  - If `image_accum` is **non-empty**: append `payload` to it, then `session.current_turn.image_bytes = bytes(image_accum); image_accum.clear()`.
  - If `image_accum` is empty: backward-compat single-message image → `session.current_turn.image_bytes = payload`.
- [ ] Cap reassembled size: reject > 200 KB (`STATE(error)` + drop).
- [ ] Don't decode — Gemini accepts raw JPEG bytes with `mime_type="image/jpeg"`.
- [ ] Optional fire-and-forget: write the JPEG to `commands/turn-{uuid}.jpg` for offline debugging.

Reference impl: `dummy_backend.py:handler` `F_IMAGE_PART` / `F_IMAGE_JPEG` branches.

### 2.2 Audio (AUDIO_CHUNK → AUDIO_END)
- [ ] Append each chunk to `session.current_turn.audio_pcm: bytearray`.
- [ ] Each chunk is int16 little-endian, 16 kHz mono, ~640 bytes. Validate length is even; warn if not.
- [ ] On `AUDIO_END`:
  - Snapshot `audio_bytes = bytes(session.current_turn.audio_pcm)`.
  - Compute duration = `len // 2 / 16000`.
  - **Sanity gate:** if `duration < 0.5 s` or `duration > 30 s`, log + drop.
  - Hand off to the orchestrator (see Layer 4) as `asyncio.create_task(orchestrator.run_turn(session, image_bytes, audio_bytes))`.
- [ ] Reset `current_turn` immediately after the hand-off so the next utterance can start.

### 2.3 Optional — light pre-processing
**Skip on the hot path** (the device already runs NS/ALE/AGC). These are only worth it if you see specific quality issues:

- [ ] (Optional) Wrap PCM as WAV in-memory for upload (Gemini accepts raw bytes with a mime type; WAV makes other providers happier).
- [ ] (Optional) Re-sample to 24 kHz if the LLM provider requests it (Gemini accepts 16 kHz natively).
- [ ] (Optional) Crop/sharpen the JPEG with PIL before upload — your `camera_test/` perspective correction is a good baseline.

### 2.4 CANCEL handling
- [ ] On `FRAME_CANCEL`: cancel any in-flight orchestrator task, send `STATE(idle)` + `TFT_CLEAR`, drop any queued AUDIO_OUT.

✅ **Done when:** mock-lamp sends a test WAV and the backend's orchestrator hand-off prints `received turn: image=38 KB, audio=4.2s (134400 B)`.

---

## Layer 3 · System prompt + context assembly

Build the payload the LLM call gets.

### 3.1 System prompt
- [ ] Store the prompt as a `string` constant in `providers/llm_gemini.py` (or `prompts/system.txt`).
- [ ] Use the template from `BACKEND_DESIGN.md` §5 — but with a **strict JSON output contract**:

  ```
  You are Lumos, a calm, curious, encouraging tutor living inside a desk lamp.

  Inputs you receive each turn:
    • One audio clip (the learner speaking — interpret it; do not transcribe back).
    • One image from the lamp's downward-facing camera.
    • A short history of prior turns in this session.
    • Optional retrieved memory of things this learner studied before.

  You MUST respond with a single, valid JSON object — no markdown fence, no
  trailing text. The schema is:

    {
      "speech":  string,         // what the lamp will say out loud (1–4 sentences).
                                 // Conversational. No markdown, no LaTeX, no bullets.
                                 // Speak math in words: "the square root of pi".
      "display": {
        "kind":    "latex" | "text" | "none",
        "content": string         // empty when kind == "none"
      }
    }

  Rules:
    1. "kind": "latex"   ⇒ "content" is a LaTeX expression (no $$ delimiters).
    2. "kind": "text"    ⇒ "content" is ≤ 200 chars of plain text for the screen.
    3. "kind": "none"    ⇒ nothing useful to display.
    4. Prefer "latex" when the answer has an equation, formula, derivation step,
       or chemical reaction.
    5. Be brief. Latency matters. End with a small prompt back to the learner
       only when it feels natural.
    6. If the image is irrelevant, do not talk about it.
    7. Never invent facts. If unsure, say so.

  Style: warm, patient, never condescending.
  ```
- [ ] **LaTeX subset warning:** append the verbatim paragraph from `BACKEND_DESIGN.md §4.6.1` to the prompt — matplotlib mathtext is a strict subset of LaTeX (no `\tfrac`, `\substack`, `\boxed`, `\text`, `aligned`/`cases` envs, etc.). Without this warning the LLM defaults to amsmath conventions from its training data, the render throws `ParseSyntaxException`, and `TFT_FRAME` never reaches the lamp. Test with `_test = LATEX_RENDERER.render(reply.display.content)` at startup against representative samples.
- [ ] Test the prompt against ~10 hand-crafted (audio, image) pairs to verify it always returns valid JSON.

### 3.2 Conversation history (Redis, short-term)
- [ ] Per device_id, store a list of the last **3 turns**: `[{ "asked_at", "speech_response", "display_kind" }]`. Skip the audio/image — just text.
- [ ] On each turn, prepend the list to the LLM call as text context.
- [ ] Key: `lamp:hist:{device_id}`. TTL: 24 h. List trim: `LPUSH` + `LTRIM 0 2`.

### 3.3 Long-term memory (pgvector — defer until product needs it)
- [ ] On turn completion: embed `(speech_response)` with a small embedding model (e.g. `text-embedding-3-small`).
- [ ] Insert into `memories(user_id, embedding, content)`.
- [ ] On next turn: top-3 ANN lookup based on the LLM's transcript of the question (or skip this leg in v1).

**Recommendation:** skip 3.3 entirely for now. Implement only when you have a real user asking for it.

✅ **Done when:** the LLM call payload includes `[system_prompt, history, image, audio]`, in that order, and you can dump it as JSON for inspection before sending.

---

## Layer 4 · LLM API call

The single most important latency lever. Stream tokens — never wait for the full response.

### 4.1 Provider client — Gemini 2.5 Flash (recommended)
- [ ] `pip install google-genai` (the official Gen AI SDK, v1+).
- [ ] `providers/llm_gemini.py`:
  ```python
  from google import genai
  from google.genai import types

  client = genai.Client(api_key=settings.GEMINI_API_KEY)

  async def call_multimodal_stream(
      system_prompt: str,
      history_text: str,
      image_bytes: bytes,
      audio_bytes: bytes,
  ):
      response = client.aio.models.generate_content_stream(
          model="gemini-2.5-flash",
          config=types.GenerateContentConfig(
              system_instruction=system_prompt,
              response_mime_type="application/json",   # JSON mode
              max_output_tokens=200,
              temperature=0.7,
          ),
          contents=[
              types.Part.from_text(history_text),
              types.Part.from_bytes(image_bytes, mime_type="image/jpeg"),
              types.Part.from_bytes(audio_bytes, mime_type="audio/pcm;rate=16000"),
          ],
      )
      async for chunk in response:
          if chunk.text:
              yield chunk.text
  ```
- [ ] **JSON mode** is critical — `response_mime_type="application/json"` makes Gemini always return parseable JSON.
- [ ] **Cap `max_output_tokens` at ~200**. The lamp doesn't lecture.

### 4.2 (Optional) Fallback / alt provider
- [ ] OpenAI GPT-4o is the closest multimodal alternative; same shape via the OpenAI SDK with `response_format={"type":"json_object"}`.
- [ ] Implement only if Gemini stalls / has policy errors / costs spike.

### 4.3 Latency budget contract
| Stage | Target | What to instrument |
|---|---|---|
| EOS → first LLM token (TTFT) | 400–700 ms | timer started at AUDIO_END, stopped at first non-empty chunk |
| LLM total wall time | 800–1500 ms | timer stopped at stream end |
| LLM input tokens, output tokens | log every turn | for cost dashboards |

Log p50/p95/p99 in a Redis counter so you can dashboard later.

### 4.4 Error handling
- [ ] Provider 5xx / timeout (> 8 s) → fallback message: `{"speech":"Sorry, I had trouble connecting. Try again.", "display":{"kind":"none","content":""}}`. Still go through the same TTS pipeline so the user hears it.
- [ ] Provider safety block (Gemini sometimes returns a block reason instead of text) → same fallback, log the block reason.
- [ ] Cancellation → swallow `asyncio.CancelledError` cleanly; do **not** ship any frames after cancel.

✅ **Done when:** orchestrator yields a stream of text chunks that, concatenated, parse as a valid `{speech, display}` JSON object for ≥ 95% of test inputs.

---

## Layer 5 · JSON parsing + dispatch

The point where text → speaker + screen.

### 5.1 Streaming JSON accumulator
- [ ] Concatenate stream chunks into a buffer; the buffer should always parse as valid JSON because of Gemini's JSON mode.
- [ ] For latency, you can stream sentence-by-sentence to TTS **before** the full JSON closes — but JSON tokens (quotes, braces, commas) make this fragile. Recommended approach:
  - Wait for the full JSON to arrive (you cap at 200 tokens → typically < 1 s).
  - Or: use Gemini's "function calling" / "structured output" with a Pydantic schema, which makes incremental parsing safer.

  For v1, **wait for full JSON.** Optimise to streaming TTS once you have stable end-to-end working.

### 5.2 Pydantic models
- [ ] `app/schemas.py`:
  ```python
  from pydantic import BaseModel
  from typing import Literal

  class Display(BaseModel):
      kind: Literal["latex", "text", "none"]
      content: str = ""

  class LlmReply(BaseModel):
      speech: str
      display: Display
  ```
- [ ] Validate after parse; on validation error, treat as if LLM returned the fallback message.

### 5.3 Dispatch logic
```python
reply = LlmReply.model_validate_json(buffer)

# Speech leg → TTS (Layer 7)
asyncio.create_task(speak_and_stream(session, reply.speech))

# Display leg → TFT (Layer 6)
if reply.display.kind == "latex":
    await render_latex_and_send(session, reply.display.content)
elif reply.display.kind == "text":
    await session.send_frame(FrameType.TFT_TEXT, reply.display.content.encode("utf-8"))
elif reply.display.kind == "none":
    await session.send_frame(FrameType.TFT_CLEAR)
```

### 5.4 State emissions around the turn
- [ ] On `AUDIO_END` received: send `STATE(0x02 thinking)` to the lamp.
- [ ] Just before first AUDIO_OUT: send `STATE(0x03 speaking)`.
- [ ] After AUDIO_OUT_END: send `STATE(0x00 idle)`.

These drive the LED and let the lamp show a "Thinking…" `TFT_TEXT` while the LLM is still chewing.

### 5.5 Persistence (fire-and-forget)
- [ ] Write the parsed reply (text only, no audio) into Postgres `turns` table (see Layer 9).
- [ ] Push to Redis history list for next turn.

✅ **Done when:** orchestrator parses a stream into `{speech, display}` and dispatches both legs in parallel.

---

## Layer 6 · TFT rendering (display leg)

Re-uses the work already in `Latex_engine_tft.py` — wrap, don't rewrite.

### 6.1 LaTeX render wrapper
- [ ] `providers/latex_renderer.py`:
  ```python
  from Latex_engine_tft import LatexRenderer, DisplayConfig

  _cfg = DisplayConfig()                       # 240×320, BGR, rotation matches lamp
  _renderer = LatexRenderer(_cfg)

  def render(latex: str) -> tuple[int, int, int, bytes]:
      """Returns (W, H, nFrames, rgb565_bytes)."""
      pixels = _renderer.render(latex)         # concatenated frames
      W, H   = _cfg.render_w, _cfg.render_h
      n      = len(pixels) // (W * H * 2)
      return W, H, n, pixels
  ```

### 6.2 TFT_FRAME payload builder + **CHUNKED SEND** (mandatory)
The lamp's WS RX cannot allocate a >4 KB `std::string` reliably under load
(see `HARDWARE_CONTEXT.md §6`). A single screen of LaTeX is 153 KB; a
scroll animation can be 3+ MB. The backend MUST chunk every TFT_FRAME.

- [ ] In `providers/latex_renderer.py`:
  ```python
  import struct

  def build_tft_frame_payload(W: int, H: int, nFrames: int, pixels: bytes) -> bytes:
      inner = struct.pack(">HHBB", W, H, nFrames, 0)
      return inner + pixels
  ```
- [ ] In `session.py`, add a chunked sender (verbatim from `dummy_backend.py`):
  ```python
  WS_MAX_FRAME_BYTES = 2 * 1024   # ≤ 2 KB per WS message — well below the lamp's 4 KB cap

  async def send_tft_frame_chunked(self, payload: bytes):
      """Splits payload into F_TFT_PART chunks (lamp accumulates) + final
      F_TFT_FRAME terminator (commits to PAGE_SPEAKING_LATEX)."""
      n = len(payload)
      if n <= WS_MAX_FRAME_BYTES:
          await self.send_frame(FrameType.TFT_FRAME, payload)
          return
      sent = 0
      while n - sent > WS_MAX_FRAME_BYTES:
          await self.send_frame(FrameType.TFT_PART,
                                payload[sent:sent + WS_MAX_FRAME_BYTES])
          sent += WS_MAX_FRAME_BYTES
      await self.send_frame(FrameType.TFT_FRAME, payload[sent:])
  ```
- [ ] Note: `FrameType.TFT_PART = 0x23` must be in `app/protocol.py`. Add it.

NEVER call `session.send_frame(FrameType.TFT_FRAME, big_payload)` directly
for payloads > 2 KB — the lamp will reboot.

### 6.3 Render cache
- [ ] The `RenderCache` class already exists in `Latex_engine_tft.py`. Wire it in front of `render()` so common equations don't re-render.
- [ ] Cache key already includes the DisplayConfig hash.

### 6.4 Plain-text dispatch
- [ ] No backend rendering needed — just UTF-8 bytes via `FRAME_TFT_TEXT`. The lamp uses its built-in font.
- [ ] Enforce ≤ 200-byte cap to fit the lamp's screen.

### 6.5 TFT timing — PARALLEL with audio (asyncio.gather)
- [ ] Send `TFT_TEXT` FIRST (single small message) right after `STATE(0x03 speaking)`. This flips the lamp's page off `PAGE_THINKING` immediately — kills the "spinner during audio" UX gap.
- [ ] Then stream audio AND chunked TFT_FRAME **in parallel** via `asyncio.gather()`. Sending sequentially (`await send_tft_frame(); await stream_audio()`) blocks audio for 3–5 s on a multi-MB LaTeX payload — the user perceives "no audio."
  ```python
  await session.send_text(reply.speech_display_text)  # short instant
  rendered = build_tft_frame_payload(*render(reply.latex))   # sync, ~0.5 s
  await asyncio.gather(
      speak_and_stream(session, reply.speech_audio),       # 85 ms paced
      session.send_tft_frame_chunked(rendered),            # unpaced 2 KB
  )
  ```
  The audio reaches the speaker within ~100 ms of EOS; the LaTeX combined view appears mid-stream when the TFT_FRAME terminator lands. See `BACKEND_DESIGN.md §6 item #17`.
- [ ] If `display.kind == "none"`, send `TFT_CLEAR` at end-of-turn (after AUDIO_OUT_END) — `TFT_TEXT` alone is fine if there's a short caption to show.

✅ **Done when:** the mock-lamp script receives a `TFT_FRAME` for a math question, saves the pixels, and an offline PNG-decoder shows the equation correctly.

---

## Layer 7 · TTS (speech leg)

The other big latency lever. Pick **one** primary provider; have a fallback.

### 7.1 Decision: API vs self-hosted

For a hobby/early product on home WiFi → **start with Cartesia API.** ~90 ms TTFT, ~$0.0005/turn. Switch to local Kokoro when you hit ~500 lamps or compliance requires it.

### 7.2 Primary path — Cartesia Sonic API
- [ ] `pip install cartesia` (official SDK).
- [ ] `providers/tts_cartesia.py`:
  ```python
  from cartesia import Cartesia

  client = Cartesia(api_key=settings.CARTESIA_API_KEY)

  async def stream_tts(text: str):
      """Yields int16 PCM chunks at 24 kHz mono."""
      stream = client.tts.bytes(
          model_id="sonic-2",
          transcript=text,
          voice={"mode": "id", "id": "<voice_uuid_from_cartesia>"},
          output_format={"container":"raw","encoding":"pcm_s16le","sample_rate":24000},
      )
      async for chunk in stream:
          yield chunk
  ```
- [ ] In the orchestrator, around the stream:
  ```python
  async def speak_and_stream(session, text: str):
      await session.send_frame(FrameType.STATE, bytes([0x03]))       # speaking
      async for pcm in stream_tts(text):
          await session.send_frame(FrameType.AUDIO_OUT, pcm)
      await session.send_frame(FrameType.AUDIO_OUT_END)
      await session.send_frame(FrameType.STATE, bytes([0x00]))       # idle
  ```

### 7.3 Chunking & pacing (CRITICAL — `[spk] ring full — dropped` happens otherwise)
- [ ] Re-chunk Cartesia output to **EXACTLY 4 KB per WS message** (2 048 int16 LE samples = 85.3 ms of audio at 24 kHz mono). This is the speaker's per-chunk drain duration.
- [ ] Pace at **85 ms wall-clock between sends** (`await asyncio.sleep(0.085)`). Earlier docs that said "12 KB / 250 ms" or "70 ms" are WRONG — they over-send and overflow the lamp's 64 KB ring buffer after ~3 s of playback.
- [ ] Math: 4 KB / (24 000 × 2 B/s) = 85.3 ms playback per chunk. Backend pace 85 ms ≈ exact match — ring stays stable.
- [ ] Reference: `dummy_backend.py` `CHUNK_BYTES = 4 * 1024`, `CHUNK_INTERVAL_S = 0.085`.

### 7.4 Alternative — self-hosted Kokoro-82M
For v2 / scale:

- [ ] Spin up Kokoro on a single L4 / 4090 GPU in the same VPC as the backend.
- [ ] Wrap as `providers/tts_kokoro.py` with the same `async def stream_tts(text)` interface.
- [ ] Toggle via `TTS_PROVIDER=kokoro_local` env var.

Numbers: ~40–80 ms TTFT on L4, decent quality. ~$200/month box vs ~$0.0005/turn API.

### 7.5 Error handling
- [ ] Provider error → send `STATE(0x04 error)` + a short on-device fallback `TFT_TEXT("Sorry, my voice broke. Try again.")` + `AUDIO_OUT_END` + `STATE(0x00)`. Do not close the socket.

✅ **Done when:** mock-lamp plays back the synthesised speech and it matches the LLM's `speech` field.

---

## Layer 8 · Orchestrator — the glue

The `Turn` pipeline, end-to-end. One function in `services/orchestrator.py`.

```python
async def run_turn(session, image_bytes: bytes, audio_bytes: bytes):
    turn_id = uuid7()
    t0 = time.monotonic()

    await session.send_frame(FrameType.STATE, bytes([0x02]))   # thinking
    # Optional immediate display:
    await session.send_frame(FrameType.TFT_TEXT, b"Thinking...")

    history = await load_history(session.device_id)
    system  = SYSTEM_PROMPT

    # LLM (Layer 4)
    buf = ""
    async for chunk in call_multimodal_stream(system, history, image_bytes, audio_bytes):
        buf += chunk

    # Parse (Layer 5)
    try:
        reply = LlmReply.model_validate_json(buf)
    except Exception:
        reply = FALLBACK_REPLY

    # Fire both legs in parallel
    await asyncio.gather(
        speak_and_stream(session, reply.speech),                        # Layer 7
        push_display(session, reply.display),                            # Layer 6
    )

    # Persist (Layer 9) — fire-and-forget
    asyncio.create_task(persist_turn(turn_id, session.device_id,
                                     image_bytes, audio_bytes, reply, t0))
```

- [ ] Wrap each layer call in `try/except` so a Cartesia outage doesn't cause a dangling `STATE(speaking)`.
- [ ] Always end with `STATE(0x00 idle)` even on error.
- [ ] Track `time.monotonic()` checkpoints at: EOS received, first LLM token, JSON parsed, first TTS chunk, first TTS sent to lamp. Log all five.

✅ **Done when:** end-to-end latency from mock-lamp's `AUDIO_END` → first `AUDIO_OUT` is **< 1500 ms** for a small input.

---

## Layer 9 · Storage + persistence (parallel, off the hot path)

Everything here runs as `asyncio.create_task` — never blocks a response.

### 9.1 Postgres schema
- [ ] `pip install sqlalchemy[asyncio] asyncpg alembic`
- [ ] Tables (deferred — full schema lives in `IMPLEMENTATION_AUTH_PAIRING.md` §6.2):
  - `devices` (only needed when ENABLE_AUTH=1)
  - `turns`:
    ```sql
    CREATE TABLE turns (
      id              uuid PRIMARY KEY,
      device_id       text NOT NULL,
      user_id         text,                          -- Clerk ID, nullable in dev
      asked_at        timestamptz NOT NULL DEFAULT now(),
      ended_at        timestamptz,
      audio_url       text,                          -- s3://... or local path
      image_url       text,
      transcript      text,                          -- filled later by offline Whisper
      response_text   text,
      display_kind    text,
      display_content text,
      llm_model       text,
      llm_input_tok   int,
      llm_output_tok  int,
      ttft_ms         int,
      total_ms        int,
      cost_usd        numeric(10, 6)
    );
    CREATE INDEX turns_device_idx ON turns(device_id, asked_at DESC);
    ```

### 9.2 Blob storage
- [ ] Pick one of:
  - **Local filesystem** during dev (`./commands/` like `audio_server/cmd_audio_receiver.py` already does).
  - **S3 / Cloudflare R2** in prod.
- [ ] Async upload via `aioboto3` or `boto3` in a thread.
- [ ] Save: `turn-{uuid}.jpg` and `turn-{uuid}.wav` (wrap PCM in WAV).

### 9.3 Async transcription (for analytics + memory)
- [ ] Background worker (Arq / Celery / Temporal) consumes saved WAVs.
- [ ] Runs Groq Whisper Large v3 (~200 ms for 3 s, dirt cheap).
- [ ] Writes `turns.transcript`.
- [ ] Triggers embedding insertion (if pgvector memory is enabled).

### 9.4 Cost & latency rollups
- [ ] Daily materialised view: turns/day, p50/p95 TTFT, p95 total_ms, $/day.
- [ ] Surface via Metabase or Grafana pointed at the Postgres read replica.

**Recommendation:** stub all of this with `print()` calls for v1. Real persistence kicks in when you have a user to support.

✅ **Done when:** every completed turn appears in `turns` table with `total_ms` populated.

---

## Layer 10 · Auth + pairing (deferred — track only)

Already fully specified in `IMPLEMENTATION_AUTH_PAIRING.md`. **Do not implement now.**

- [ ] When firmware flips `ENABLE_AUTH=1`:
  - Implement §6.1 endpoints (register, poll-pairing, complete-pairing, devices, unlink, rename).
  - Implement §6.1.9 Clerk webhook.
  - Implement §6.4 WS gateway JWT verification.
  - Configure Clerk in the frontend.

Until then, the backend's `authenticate()` accepts any JWT.

---

## Layer 11 · Production hardening (last step)

Don't bother until the audio/LLM/TFT loop is solid.

- [ ] TLS — terminate at Caddy / Nginx / cloud LB. Use Let's Encrypt.
- [ ] Rate limiting per device_id on `/lamp/ws` connect attempts (Redis token bucket).
- [ ] Logging — `structlog` with JSON output to stdout; ship to Grafana Loki or similar.
- [ ] Tracing — OpenTelemetry spans around each layer's call. Helps when a single turn is slow.
- [ ] Health endpoint that checks DB, Redis, Gemini, Cartesia all reachable.
- [ ] `Dockerfile` + `docker-compose.yml` for local dev (postgres + redis sidecars).
- [ ] Deploy target: Render / Railway / Fly.io / Google Cloud Run.
- [ ] Choose region to **co-locate with Gemini's endpoint** (e.g. `us-central1`) — saves 30–80 ms per call.

✅ **Done when:** lamp on production WiFi connects to the production backend and a real "hey lumos" answer comes back end-to-end through HTTPS/WSS.

---

## End-to-end smoke test (single command)

Once Layers 1–7 are done:

1. Start backend: `uvicorn app.main:app --reload`.
2. Start mock-lamp: `python scripts/mock_lamp.py --audio test.wav --image desk.jpg`.
3. Expect logs:
   ```
   [WS] connected device=dev-lamp
   [RX] IMAGE_JPEG 38214 B
   [RX] AUDIO_CHUNK ×N
   [RX] AUDIO_END (audio=3.21s)
   [LLM] ttft=520ms total_ms=1180  in_tok=842  out_tok=84
   [TTS] first chunk in 90ms
   [TX] AUDIO_OUT ×M (total 92160 B)
   [TX] TFT_FRAME 153606 B (240x320 ×1)
   [TX] AUDIO_OUT_END
   [TX] STATE idle
   turn done in 1480ms
   ```
4. `out.wav` is playable and matches the LLM's `speech`.
5. The TFT_FRAME pixels decode to the equation image.

That's the whole loop.

---

## Build order (TL;DR)

If you only read one section, read this one:

1. **Layer 0**: scaffold the project.
2. **Layer 1**: WebSocket + frame protocol + mock-lamp dev tool.  ← biggest unlock
3. **Layer 2**: buffer audio + image into a `Turn` object.
4. **Layer 4**: hard-code the system prompt, call Gemini, dump JSON to stdout.
5. **Layer 5**: parse JSON.
6. **Layer 6**: wrap `Latex_engine_tft.py`, send a single `TFT_FRAME`.
7. **Layer 7**: Cartesia stream, send `AUDIO_OUT` frames.
8. **Layer 8**: glue them together in the orchestrator.
9. **Layer 3**: add history + (optionally) memory.
10. **Layer 9**: persistence — only when needed.
11. **Layer 10**: auth — only when lamp flips `ENABLE_AUTH=1`.
12. **Layer 11**: hardening + deploy.

Layers 1–8 are the MVP. Each takes ~half a day to a day. The whole MVP fits in a focused week.
