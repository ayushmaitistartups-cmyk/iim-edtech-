# BACKEND_DESIGN.md — AI Tutor Lamp

> **Goal:** sub-2-second perceived latency from end-of-speech → first audio out of speaker / first pixels on TFT.
> **Hardware in the loop:** ESP32-S3 (mic INMP441 + cam OV5640) ⇄ Backend ⇄ ESP32-S3 (TFT ILI9341 + speaker MAX98357A).
> Built on top of the existing pipelines in `audio_pipeline/`, `audio_server/`, `camera_test/`, `tft_latex_client/`.

---

## 1. The latency problem first (read this before anything else)

A naive pipeline looks like this and is **too slow** (~6–8 s):

```
ESP32 ──upload audio (96 KB)──► STT (Whisper) ──text──► LLM ──text──► TTS ──audio──► ESP32
        300 ms                   800–1500 ms             1500 ms       800 ms         300 ms
```

The single biggest win is **collapsing STT+LLM into one multimodal call**, and **streaming TTS while the LLM is still generating**. Target budget:

| Stage | Budget | Tech that hits it |
|---|---|---|
| EOS detected on ESP32 → first byte arrives at backend | **150 ms** | already-buffered PCM, persistent WebSocket, send-while-recording |
| First LLM token | **400–700 ms** | Gemini 2.0 Flash (native audio+image input), Groq Llama-3.x, GPT-4o-mini-realtime |
| First TTS audio chunk | **+150 ms after first sentence** | Cartesia Sonic / ElevenLabs Flash v2 / Deepgram Aura (streaming) |
| First audio byte arrives on speaker | **+100 ms** | persistent WebSocket back to device |
| First TFT frame (if any) | **+200 ms after final-ish text** | parse LaTeX from streamed text, render incrementally |
| **End-to-end (speech-end → speaker-start)** | **~1.2–1.8 s** | the whole pipeline streaming throughout |

Every section below is in service of this number. If a decision doesn't shave ms or improve quality, skip it.

---

## 2. High-level architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ESP32-S3 LAMP (edge)                                                         │
│  ┌──────────────────┐  ┌─────────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Wake word (EI)   │  │ Audio pipeline  │  │ OV5640 cam   │  │ TFT + LED │  │
│  │ "hey lumos"      │─►│ NS→ALE→AGC→VAD  │  │ JPEG capture │  │ MAX98357A │  │
│  └──────────────────┘  └────────┬────────┘  └──────┬───────┘  └─────▲─────┘  │
│                                 │                  │                │        │
│                                 └─────────┬────────┘                │        │
│                                           ▼                         │        │
│                          ┌───────────────────────────────┐          │        │
│                          │  Single WebSocket (TLS)       │◄─────────┘        │
│                          │  multiplexed binary frames    │  responses        │
│                          └─────────────────┬─────────────┘                   │
└────────────────────────────────────────────┼─────────────────────────────────┘
                                             │
                                  (WiFi · single persistent socket)
                                             │
┌────────────────────────────────────────────┼─────────────────────────────────┐
│ BACKEND (one region, one VPC, GPU/inference co-located)                      │
│                                            ▼                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 1. Gateway / Session Service (FastAPI + uvicorn, or Go/Fiber)       │    │
│  │    • terminates the device WebSocket                                │    │
│  │    • auth (device JWT), session UUID, per-turn turn_id              │    │
│  │    • routes frames: audio→Orchestrator, image→Vision queue          │    │
│  └────────────────┬────────────────────────────────────────────────────┘    │
│                   │                                                          │
│                   ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 2. Turn Orchestrator (async Python or Go; in-process, NOT a queue)  │    │
│  │    fan-out, all in parallel:                                        │    │
│  │      a) upload audio + image to LLM provider (multimodal, stream)   │    │
│  │      b) start TTS stream (waits on first sentence)                  │    │
│  │      c) start LaTeX/TFT pipeline (waits on whole answer)            │    │
│  │      d) write raw audio + image to Object Storage (async, fire-fwd) │    │
│  └────────────────┬────────────────────────────────────────────────────┘    │
│                   │                                                          │
│      ┌────────────┴───────────────┬────────────────────┬──────────────┐     │
│      ▼                            ▼                    ▼              ▼     │
│  ┌──────────┐               ┌──────────────┐    ┌─────────────┐  ┌────────┐ │
│  │ LLM      │               │ TTS stream   │    │ LaTeX/Text  │  │ Memory │ │
│  │ Multi-   │  text tokens  │ Cartesia /   │    │ Formatter   │  │ Vector │ │
│  │ modal    │ ───────────►  │ ElevenLabs   │    │ (regex +    │  │ Store  │ │
│  │ provider │               │ Flash        │    │  LLM tool)  │  │ pgvec  │ │
│  └──────────┘               └──────┬───────┘    └──────┬──────┘  └────┬───┘ │
│                                    │ PCM 24kHz         │ LaTeX        │     │
│                                    ▼                   ▼              │     │
│                          (back through Gateway WebSocket to ESP32)    │     │
│                                                                       │     │
│  ┌────────────────────────────────────────────────────────────────────┴───┐ │
│  │ 3. Storage layer                                                       │ │
│  │   • Postgres (Supabase / RDS)  — sessions, turns, users, analytics    │ │
│  │   • Postgres + pgvector        — long-term memory embeddings          │ │
│  │   • S3 / Cloudflare R2         — raw audio.wav + image.jpg blobs      │ │
│  │   • Redis                      — short-term session cache, rate limit │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ 4. Async workers (Celery / Arq / Temporal — NOT in hot path)           │ │
│  │   • offline transcript (Groq Whisper) for analytics search             │ │
│  │   • image scene-description (BLIP/LLaVA) for vector memory             │ │
│  │   • embed turn → pgvector                                              │ │
│  │   • cost/usage rollups                                                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. End-to-end data flow (one turn, with timing)

`t=0` is the wake word firing on the device.

| t (ms) | Device | Network | Backend |
|---|---|---|---|
| 0 | `MODE_IDLE → MODE_COMMAND`. White flash. Camera triggered. | | |
| 0–300 | Camera grabs JPEG (~30–60 KB at q=12). Audio recording starts. | | |
| 300 | **Open WS frame `IMAGE`** as soon as JPEG is ready. | ↑ image bytes | Gateway stores image in Redis (key=turn_id), pre-uploads to LLM provider if API supports "image-first then audio" (Gemini does via Files API). |
| 300–3000 | Mic fills `cmd_buf` until VAD EOS (≥2.5 s silence) **OR** start streaming 320-sample chunks every 20 ms over WS as `AUDIO_CHUNK` frames. | ↑ audio chunks | Gateway buffers chunks; orchestrator already has the image. |
| ~EOS | Send WS frame `AUDIO_END`. | ↑ end marker | Orchestrator fires multimodal call (audio bytes + image ref + system prompt). |
| EOS+400–700 | | | First LLM token. As soon as first **sentence** (`. ! ?` or 80 chars) is complete → forward to TTS provider. |
| EOS+600–900 | | ↓ PCM | First TTS audio chunk. Gateway frames as `AUDIO_OUT` → device. |
| EOS+700–1000 | Speaker starts playing. Red breathing LED → orange strobe. | | LLM still streaming remaining tokens; pipeline continues sentence-by-sentence. |
| EOS+700–4000 | (interleaved) | ↓ chunked TFT_PART × N + TFT_FRAME terminator (concurrent with audio chunks via `asyncio.gather`) | TFT accumulator fills; combined LaTeX-top / text-bottom view appears when terminator arrives. **DO NOT send TFT_FRAME serially before audio** — see §6 checklist item #17. |
| EOS+1500 | Display: when LLM stream ends, formatter extracts LaTeX/short text → push `TFT_LATEX` frame. | ↓ latex string | TFT client renders. |
| async | Speaker finishes, LED returns to cyan breathing. | | Worker writes Postgres row, embeds turn, uploads blobs to S3. |

**Why the image is sent first**: by the time the user finishes speaking, the LLM provider already has the image cached (Gemini Files API / Anthropic file upload). Cuts ~150 ms.

**Why we stream audio chunks rather than the existing "send the whole 96 KB cmd_buf at EOS"**: it removes the ~300 ms upload from the critical path. The current `audio_pipeline.ino` `MODE_SENDING` block needs to be modified to send chunks during `MODE_COMMAND`.

---

## 4. Component-by-component decisions

### 4.1 Edge changes (ESP32-S3) — minimal but necessary

| Change | Why |
|---|---|
| Replace one-shot TCP send to `cmd_audio_receiver.py:5060` with a **persistent WebSocket** (or raw TLS TCP) to backend. | Avoid TCP handshake (~RTT) per turn; same connection carries image, audio chunks, TTS audio back, TFT payload. |
| Start sending `AUDIO_CHUNK` frames during `MODE_COMMAND` instead of waiting for EOS. | Removes upload from hot path. |
| Capture JPEG **on wake-word detection**, not on EOS. | Image upload overlaps with the user speaking. |
| Add a small ring buffer for incoming `AUDIO_OUT` PCM from server → I2S TX (you already have the I2S TX code in `wifi_audio_player/`). | Streaming playback. |
| Heartbeat ping every 10 s. | Detect dead socket quickly. |

Frame format on the wire (single WS, binary):

```
[1 byte type][3 bytes length][payload]

types:
  0x01 IMAGE_JPEG
  0x02 AUDIO_CHUNK   (int16 PCM, 16 kHz, mono, ~320 samples = 20 ms)
  0x03 AUDIO_END
  0x10 AUDIO_OUT     (int16 PCM, 24 kHz, mono, TTS chunk)
  0x11 AUDIO_OUT_END
  0x20 TFT_LATEX     (UTF-8 LaTeX string)
  0x21 TFT_TEXT      (UTF-8 plain text)
  0x30 STATE         (idle/listening/thinking/speaking)
  0xF0 PING / 0xF1 PONG
```

### 4.2 Gateway / Session Service

- **Language**: Python (`FastAPI` + `websockets`) is fine and fastest to ship; if you ever need >1000 concurrent lamps, port to Go (`gorilla/websocket` or `fiber/websocket`). Latency-wise both are < 1 ms framing.
- **Auth**: each lamp gets a device JWT baked into NVS at provisioning. Verify on connect, not per-frame.
- **Session model**: one WS = one session. Inside the session, each utterance gets a `turn_id` (uuidv7 — time-sortable).
- **Backpressure**: if TTS-out > WS-write rate, drop oldest `AUDIO_OUT` queue — better to skip than to lag.

### 4.3 Turn Orchestrator (the most important file)

In-process, **not** Celery/Kafka for the live turn. Queues add 10–50 ms each — that's a budget killer. Use `asyncio.TaskGroup`.

Pseudocode:

```python
async def handle_turn(turn_id, ws):
    image_ref = await image_pre_upload_task   # already running since wake word
    audio_stream = await await_audio_end()    # streaming buffer

    llm_stream = llm_client.stream_multimodal(
        system=SYSTEM_PROMPT,
        image_ref=image_ref,
        audio=audio_stream,        # or audio_uri if provider needs upload
        memory=await fetch_recent_memory(session.user_id),
    )

    sentence_buf = []
    async for token in llm_stream:
        sentence_buf.append(token)
        if ends_sentence(sentence_buf):
            text = "".join(sentence_buf); sentence_buf.clear()
            await tts_queue.put(text)            # streams to TTS provider
        await persist_token(turn_id, token)      # to Redis stream

    # Full answer ready
    full_text = await get_full_answer(turn_id)
    latex = extract_latex(full_text)
    if latex:
        await ws.send_frame(TFT_LATEX, latex)
    else:
        await ws.send_frame(TFT_TEXT, summarise_for_tft(full_text, max_chars=200))

    asyncio.create_task(post_turn_persist(turn_id))  # fire and forget
```

### 4.4 LLM choice — the single biggest cost/latency lever

You said you're not sure whether you need STT. **You don't** — modern multimodal LLMs accept raw audio. Comparison:

| Option | Audio input? | Image input? | TTFT (typical) | $ per turn | Notes |
|---|---|---|---|---|---|
| **Gemini 2.5 Flash** | ✅ native | ✅ | 400–700 ms | ~$0.0005 | **Recommended primary.** Big context, cheap, fast, audio understanding is solid. |
| Gemini 2.5 Pro | ✅ | ✅ | 800–1500 ms | 10× Flash | Use as fallback when Flash returns "I don't know". |
| GPT-4o-mini Realtime API | ✅ | ✅ (via separate vision call) | 300–500 ms | Higher | Best for full duplex voice, but image handling is awkward. |
| GPT-4o (non-realtime, audio in) | ✅ | ✅ | 700–1200 ms | Higher | Good fallback. |
| Claude Sonnet 4 | ❌ (text only) | ✅ | 600–900 ms | Mid | Needs STT step. Skip unless you specifically want Claude's tutoring tone. |
| Groq Llama 3.3 70B | ❌ | ❌ | **150–300 ms** | Cheap | Only if you go STT→LLM. Astonishingly fast at text. |

**Decision tree**:

1. **Default → Gemini 2.5 Flash** with audio+image inputs. One API call, no STT.
2. If you want faster TTFT and your educational content is mostly textual → STT with Deepgram Nova-3 streaming (results during speech, ~100 ms after EOS) → Groq Llama 3.3 70B → TTS. This route can hit 800 ms total but loses audio nuance (tone, prosody).
3. Vision quality matters a lot for a tutor lamp (handwriting, textbook pages, drawings). Gemini Flash is good but **not** for tiny handwriting; consider a one-time image preprocessor (sharpen + adaptive threshold) before sending — your existing `camera_test/` perspective-correction is already a win.

### 4.5 TTS choice

| Option | TTFT | Quality | Streaming | Notes |
|---|---|---|---|---|
| **Cartesia Sonic** | **~90 ms** | High | ✅ | **Recommended.** Cheapest fast option. Voice cloning available. |
| ElevenLabs Flash v2.5 | ~150 ms | Very high | ✅ | More expensive; warmer voices. |
| Deepgram Aura-2 | ~150 ms | Good | ✅ | Cheap. |
| OpenAI TTS (tts-1) | ~400 ms | Good | partial | Slower TTFT — skip. |
| Local Piper / Coqui XTTS | ~80 ms on GPU | Decent | ✅ | Self-host route. Saves $ at scale but adds infra. |

Send PCM 24 kHz mono to the device. Chunk size: **EXACTLY 4 KB per WS message** (2 048 int16 samples = 85.3 ms playback). Pace at **85 ms** between sends. The lamp's `MAX98357A` accepts 24 kHz directly via I2S; no resampling. (Tried 12 KB / 250 ms in v1 — `[spk] ring full — dropped` because the lamp's `spk_i2s.cpp` 64 KB ring overflows when chunks come in bursts. 4 KB / 85 ms exactly matches playback drain rate. Reference: `dummy_backend.py:_respond` `_stream_audio_task`.)

### 4.6 LaTeX / TFT extraction

The LLM returns **two outputs** per turn:

```
{
  "speech": "Sure! The integral of e to the minus x squared from zero to infinity is one half times the square root of pi.",
  "display": {
    "kind": "latex",      // or "text"
    "content": "\\int_0^\\infty e^{-x^2}\\,dx = \\frac{1}{2}\\sqrt{\\pi}"
  }
}
```

Use **structured output / JSON mode** on Gemini/OpenAI to guarantee parsability. Stream tokens but only emit `TFT_LATEX` once the `display` field is complete.

The backend imports `LatexRenderer` from `Latex_engine_tft.py` directly (don't run it as a sidecar — the import is cheap, matplotlib state is per-process).

#### 4.6.1 LaTeX format constraints — READ BEFORE TOUCHING THE LLM PROMPT

`Latex_engine_tft.py` renders via **matplotlib's `mathtext` engine** (`rcParam mathtext.fontset = "stix"`), NOT a full LaTeX installation. mathtext implements a deliberate subset of LaTeX — most amsmath / amssymb / array / environment commands will raise `ParseSyntaxException` and the frame will be dropped (the LLM's intended display is wasted).

**The system prompt MUST instruct the LLM to stay within this subset.** Add this verbatim to the `display.content` field's instructions:

> "The `content` field is rendered by Python's matplotlib mathtext, which supports only a subset of LaTeX. Use ONLY the commands in the supported list below. Do not use `\\tfrac`, `\\substack`, `\\boxed`, `\\text`, `\\xrightarrow`, `\\overset`, `\\underset`, `align`/`aligned`/`cases`/`array` environments, or any amsmath command. Keep the expression on a single line (no `\\\\` line breaks). If the answer needs multiple equations, pick the most important one."

##### ✅ Supported in mathtext (safe to emit)

| Category | Allowed |
|---|---|
| Arithmetic | `+ - * /` and combinations |
| Fractions | `\frac{a}{b}`, `\dfrac{a}{b}` |
| Roots | `\sqrt{x}`, `\sqrt[n]{x}` |
| Powers / subscripts | `x^2`, `a_{ij}`, `x^{n+1}` |
| Greek (lower / upper) | `\alpha \beta \gamma … \omega`, `\Gamma \Delta \Lambda \Omega …` |
| Operators (sized) | `\sum \prod \int \oint \bigcup \bigcap`, with `\limits` (preprocessor strips this anyway — see below) |
| Limits / functions | `\lim`, `\sin \cos \tan \log \ln \exp` |
| Brackets (auto-size) | `\left( … \right)`, `\left[ … \right]`, `\left\{ … \right\}`, `\langle \rangle`, `\lvert \rvert`, `\lfloor \rfloor`, `\lceil \rceil` |
| Spacing | `\,` `\:` `\;` `\quad` `\qquad` (thin/medium/thick spaces) |
| Dots | `\cdot \cdots \ldots \vdots \ddots` |
| Special symbols | `\partial \nabla \infty \hbar \zeta \Re \Im \emptyset \aleph` |
| Font shapes | `\mathcal{F}`, `\mathbb{R}`, `\mathbf{v}`, `\mathit{x}`, `\mathrm{const}`, `\mathsf{T}` |
| Arrows (basic) | `\rightarrow \leftarrow \Rightarrow \leftrightarrow \mapsto` |
| Relations | `\leq \geq \neq \approx \equiv \sim \propto \in \subset` |
| Big delimiters | `\big( \Big( \bigg( \Bigg(` (and `)`, `[`, `]`, `\{`, `\}`) |
| Accents | `\hat{x} \tilde{a} \bar{y} \dot{p} \vec{v}` |

##### ❌ NOT supported — these will crash the render

| Bad command | Use instead |
|---|---|
| `\tfrac{a}{b}` | `\frac{a}{b}` or `\dfrac{a}{b}` |
| `\substack{i \\ j}` | inline subscripts, e.g. `_{i,j}` |
| `\boxed{x}` | drop the box; emit plain `x` |
| `\xrightarrow{f}` | `\rightarrow` (no label) or `\stackrel{f}{\rightarrow}` (works) |
| `\overset{!}{=}` / `\underset{x}{f}` | `\stackrel{!}{=}` works; `\underset` does not |
| `\text{const}` | `\mathrm{const}` (visually identical, always renders) |
| `\!` (negative thin space) | omit it — flaky across matplotlib versions |
| `\begin{aligned} a &= b \\ &= c \end{aligned}` | pick ONE line; mathtext is single-line |
| `\begin{cases} … \end{cases}` | rewrite in prose in `speech`, drop `display` |
| `\begin{array}{cc} … \end{array}` | mathtext has no environments at all |
| `\color{red}{x}` | no color in mathtext; rendered B/W on lamp anyway |
| `\dfrac{}{}` with empty operand | always pad with at least a space; empty groups crash |
| Trailing backslash with nothing after it | `\` alone is invalid |
| Unicode math (`∫`, `√`, `Σ`) directly | use the LaTeX command (`\int`, `\sqrt`, `\sum`) |

##### Preprocessor aliases (defined in `Latex_engine_tft.py:ALIASES`)

The renderer runs a string-replace pass before handing the expression to mathtext. The LLM can use these short forms and they'll be rewritten:

| LLM may emit | Rewritten to |
|---|---|
| `\integral` | `\int` |
| `\derivative` | `\frac{d}{dx}` |
| `\inf` | `\infty` |
| `\oo` | `\infty` |
| `\cross` | `\times` |
| `\dot_product` | `\cdot` |
| `\limits` | (stripped) — `\sum\limits_{n=1}^N` becomes `\sum_{n=1}^N`, mathtext displays the limits either way at display-style |

> **Important**: `\limits` being stripped means the LLM can include it without harm, but it has no visual effect either. Don't tell the LLM to use `\limits` — it's just defensive.

Outer `$…$` or `$$…$$` delimiters are also stripped before render. The LLM may safely include them or not.

##### Sizing / layout behavior

- The renderer scales the equation to **20% of the short screen axis** (≈48 px tall on the lamp's 320×240 landscape panel). Tall stacks of fractions get squashed — prefer one-line forms.
- If the rendered equation is **wider than the screen**, the renderer auto-generates a **horizontal scroll animation** as multiple concatenated frames (typically 8–24 frames). The lamp navigates them with the LEFT/RIGHT buttons. Keep expressions to ≤ ~120 visual characters to fit on one screen if scroll feels janky.
- Background is always black, foreground white, BGR color order, RGB565 big-endian byte-swapped — all handled by the renderer. The LLM doesn't choose colors.

##### Wire format gotcha (lamp side)

A single screen of LaTeX is 320×240×2 = **153 KB**. A 24-frame scroll animation is **~3.6 MB**. The ArduinoWebsockets library on the lamp can only receive WS messages up to ~4 KB safely (heap fragmentation → `std::bad_alloc` → reboot — see §4 of this doc and the in-tree fix). The backend MUST split TFT_FRAME payloads into ≤2 KB chunks using the `FRAME_TFT_PART` (`0x23`) + `FRAME_TFT_FRAME` (`0x20`) protocol — the existing `dummy_backend.py:_send_tft_frame_chunked()` is the reference implementation.

##### Self-test on backend startup

Pre-render a representative complex equation at startup (the `LATEX_CRAZY` constant in `dummy_backend.py` is the reference) and abort the boot if mathtext throws. A bad LaTeX example reaching production silently because nobody tested the render is the most common failure mode of this path.

```python
# At import time, fail loudly if the LaTeX subset shifted
_test_pixels = LATEX_RENDERER.render(LATEX_CRAZY)
assert len(_test_pixels) > 0, "Latex renderer produced no pixels"
```

### 4.7 Storage — SQL vs NoSQL

**Use Postgres. Not MongoDB. Not DynamoDB.** Here's why for your case:

- Your data is highly relational: `user → device → session → turn → (audio_blob, image_blob, transcript, response, embedding)`. Joins matter.
- Postgres gives you, in one DB: JSONB for messy fields, pgvector for memory embeddings, full-text search for transcripts, partial indices for analytics, time-series via `timescaledb` extension if you ever need it.
- You won't hit Postgres scale limits with a tutor lamp product for a long time (well past 100k users).

NoSQL only wins if you have (a) extreme write throughput (>>10k inserts/s), or (b) schemaless data that genuinely changes shape per row, or (c) global low-latency reads with eventual consistency. None of those apply.

**Suggested schema** (start tiny; grow):

```sql
users          (id uuid pk, email, created_at)
devices        (id uuid pk, user_id fk, hw_serial, jwt_hash, last_seen)
sessions       (id uuid pk, device_id fk, started_at, ended_at)
turns (
  id uuid pk,                     -- uuidv7, sortable
  session_id fk,
  user_id fk,                     -- denorm for analytics
  asked_at timestamptz,
  ended_at timestamptz,
  audio_url text,                 -- s3://bucket/turn_id.wav
  image_url text,                 -- s3://bucket/turn_id.jpg
  transcript text,                -- filled async by Whisper worker
  response_text text,             -- the LLM speech field
  display_kind text,              -- 'latex' | 'text' | null
  display_content text,
  llm_model text,
  llm_input_tokens int,
  llm_output_tokens int,
  ttft_ms int,
  total_ms int,
  cost_usd numeric(10,6)
)
turn_embeddings (turn_id fk, embedding vector(1536))   -- pgvector
memories       (user_id fk, kind text, content text, embedding vector(1536), created_at)
```

**Blobs go to object storage** (S3 / R2 / MinIO), not Postgres. Postgres stores the URL only. R2 is ~free egress and very cheap — recommended for a hobby/early product.

**Redis** for: hot session state, last 3 turns of conversation (no DB round-trip in hot path), rate limiting, image cache between "wake-word fires" and "LLM call".

### 4.8 Memory (giving the lamp continuity)

Two tiers:

1. **Short-term**: last N turns of the current session, kept in Redis as a list. Prepended to every LLM call.
2. **Long-term**: per-user vector store (pgvector). After each turn, embed `(question, answer)` with a small model (`text-embedding-3-small` or local `bge-small`). Before each turn, do top-3 ANN lookup on the user's vectors with the question text embedded; inject as "Things you've discussed before".

Don't over-engineer this. A flat `memories` table with embeddings is enough for years. Skip "graph memory" / Mem0 / Zep until you have a real reason.

### 4.9 Analytics

- Same Postgres, separate read replica if it ever matters.
- Materialised views for daily rollups: turns/day, p50/p95 latency, cost/user, top question topics (clustered via embeddings).
- For dashboarding: Metabase or Grafana (free) pointed at the replica.
- **Don't** add ClickHouse / BigQuery yet. Cost and complexity outpace the value until you're at millions of turns/month.

---

## 5. System prompt (starter)

```
You are Lumos, a calm, curious, encouraging tutor living inside a desk lamp.

Inputs you receive each turn:
- An audio clip of the learner speaking (interpret it; do not transcribe back to them).
- An image from the lamp's downward-facing camera (their desk / textbook / notebook).
- A short history of prior turns in this session.
- Optional retrieved memory of things this learner studied before.

How to respond:
1. Always return a single JSON object with two fields:
   - "speech": what the lamp will say out loud. Conversational, 1–4 sentences.
     No markdown, no LaTeX, no bullet points. Speak math in words
     ("the square root of pi", "x squared plus one").
   - "display": what the TFT will show. EITHER
        {"kind": "latex", "content": "<a LaTeX expression>"}     // for math/physics/chem
        {"kind": "text",  "content": "<short plain text, ≤ 200 chars>"}  // for definitions, hints
        or null if nothing useful to display.
2. Prefer "latex" when the answer has an equation, formula, derivation step, or chemical reaction.
3. Be brief. Latency matters. If the learner needs more, they'll ask.
4. If the image clearly shows a problem they're working on, treat it as their question
   even if their voice query is vague ("help me with this", "what now?").
5. If the image is unrelated or unhelpful, say nothing about it.
6. Never invent facts. If unsure, say so and offer to look it up next turn.
7. Match the learner's apparent level (vocabulary, age cues from voice/topic).
8. Encourage thinking. Where natural, end with a tiny prompt back to them.

Style: warm, patient, never condescending. You are a study companion, not a search engine.
```

Iterate this prompt against eval cases (~30 audio+image pairs from real use) before shipping.

---

## 6. Latency optimisation checklist (tape this to your wall)

1. **One persistent WebSocket** per device. Never re-handshake mid-session. TLS resume on reconnect.
2. **Co-locate** Gateway + Orchestrator + LLM **region**. Gemini → `us-central1` or `europe-west1`; pick the backend region to match. 30 ms saved on every hop.
3. **Start the image upload at wake word**, not at EOS.
4. **Stream audio chunks** during recording; don't wait for `cmd_buf` to fill.
5. **Sentence-level TTS hand-off** — don't wait for the full LLM answer. First spoken word in ~700 ms, not 2 s.
6. **No queues in the hot path.** No Celery, no Kafka, no SQS for the live turn. asyncio in-process.
7. **HTTP/2 (or HTTP/3) keep-alive** to the LLM and TTS providers; pool of 2–4 persistent connections.
8. **JSON mode** on the LLM so you don't waste tokens narrating. Smaller output = faster.
9. **Cap max_output_tokens** to ~150. The lamp doesn't lecture.
10. **Prefetch / pre-warm** the LLM connection on `MODE_COMMAND` start so the TCP+TLS+HTTP/2 handshake is already done by EOS.
11. **Async fire-and-forget** all logging, S3 uploads, embedding writes. Never on the response path.
12. **Postgres connection pool** (pgbouncer) — never open a fresh connection per turn.
13. **Edge buffers small** (20 ms PCM chunks) so the ear-to-ear loop never has > 60 ms of audio sitting around.
14. **Skip server-side enhancement on hot path.** The current `cmd_audio_receiver.py` runs FFmpeg `afftdn` (300–800 ms!) — that's fine for the offline analytics path, but **must not be in the LLM call**. The device-side NS/ALE/AGC is already enough quality for STT/LLM.
15. **Adaptive image quality.** If WiFi is good (RSSI > −65), JPEG q=10–12 (~50 KB). If weak, drop to 320×240, q=20. Latency > resolution.
16. **Don't render a TFT response while still speaking** unless it's already cached — SPI traffic on the same MCU can starve I2S. Sequence: speech start → wait until first sentence done → push TFT.
17. **Stream audio AND chunked TFT_FRAME concurrently from the backend (`asyncio.gather`)**. Sending TFT_FRAME serially BEFORE audio (e.g. `await send_display(); await stream_audio()`) blocks the audio loop for the full TFT transmission time — at ~2 MB chunked LaTeX over WiFi that's 3–5 s of "silent lamp" before the user hears anything. Render the TFT_FRAME up front (matplotlib is sync, ~0.5 s) then `asyncio.gather(stream_audio(), send_tft_frame_chunked())`. Audio is paced (70 ms between 4 KB chunks ≈ 57 KB/s); TFT_PART chunks are unpaced 2 KB messages slotting into the audio gaps. The two streams share the wire fairly (asyncio yields on every send) and the lamp's WS RX dispatches by frame type — AUDIO_OUT goes to the speaker ring, TFT_PART goes to the PSRAM accumulator, no cross-starvation. Reference implementation: `dummy_backend.py:_respond`.

---

## 7. Things to **not** build yet (anti-scope creep)

- Multi-tenant teacher dashboards.
- On-device wake-word *and* keyword spotting (you have one EI model; that's plenty).
- gRPC. WebSocket binary frames are simpler and just as fast at this scale.
- Self-hosted LLM. Even an A100 won't beat Gemini Flash latency until you batch, which you can't (single lamp = single user).
- Kubernetes. One VM with `systemd` + `caddy` + `postgres` + `redis` carries thousands of lamps.
- ClickHouse / data warehouse / dbt. Postgres + a materialised view is fine.
- A general "skills/plugins" framework. Hardcode the 2–3 tools you actually need (timer, dictionary, web search) as function calls.

---

## 8. Suggested service layout (repo / deploy)

```
backend/
  gateway/                # FastAPI app, WS endpoint, auth, routing
  orchestrator/           # turn-handling, provider clients
  providers/
    llm_gemini.py
    llm_openai.py
    tts_cartesia.py
    tts_elevenlabs.py
    stt_deepgram.py       # only if STT route is enabled
  formatting/
    latex_extract.py
    display_summarise.py
  storage/
    db.py                 # sqlalchemy + asyncpg
    blobs.py              # s3/r2 client
    cache.py              # redis
    memory.py             # pgvector helpers
  workers/                # arq / celery / temporal — async only
    transcribe.py
    embed.py
    rollup.py
  schemas/                # pydantic models for WS frames + db rows
  config.py
  main.py

infra/
  docker-compose.yml      # postgres+redis+caddy locally
  Caddyfile               # TLS + WS reverse proxy
  terraform/              # only if/when you go cloud
```

Single VM to start: 2 vCPU / 4 GB RAM is enough for the gateway+orchestrator. Postgres on the same box for dev; managed Postgres (Supabase / Neon / RDS) in prod.

---

## 9. Cost back-of-envelope (per turn, Gemini Flash route)

- LLM (audio ~3 s in + image + 80 tokens out): **~$0.0004–0.0008**
- TTS (Cartesia, 80 tokens ≈ 60 words ≈ 25 s audio): **~$0.0005**
- Storage (audio 96 KB + image 50 KB): negligible (~$0.000003)
- Postgres + Redis: rounding error at small scale.

**~$0.001 per turn.** At 50 turns/day per lamp, $0.05/day = $1.50/month/lamp in API costs. Sell at $5/month subscription and it's already healthy.

---

## 10. What to build first (1-week MVP path)

1. **Day 1**: stand up FastAPI + WS endpoint, echo audio back to verify the device socket. Replace `cmd_audio_receiver.py` as the device's TCP target with the new WS endpoint.
2. **Day 2**: Gemini Flash multimodal call (audio bytes + image), return text. Skip TTS — print to console.
3. **Day 3**: add Cartesia/ElevenLabs streaming TTS → device `AUDIO_OUT` frames. Hear it speak.
4. **Day 4**: structured output (speech + display) → push `TFT_LATEX` frames to the existing `tft_latex_client`. See it render.
5. **Day 5**: Postgres + S3 logging (async, off hot path). Last-3-turns memory in Redis.
6. **Day 6**: latency tuning — image-on-wake, audio streaming, sentence-level TTS, connection pooling. Measure end-to-end.
7. **Day 7**: system-prompt iteration with real questions; LED state machine on the device tied to backend `STATE` frames.

Everything else (vector memory, analytics dashboards, fallback routing, eval suite) is a post-MVP enhancement.

---

## Open questions you should answer next

1. Single-user or multi-user lamps? (Affects auth + memory partition.)
2. Cloud or self-hosted? (Affects which LLM/TTS APIs are viable.)
3. Online-only or any offline fallback? (If offline matters, you need at minimum a local "I lost connection, try again" voice prompt baked into ESP32 flash.)
4. Kids product? (Adds content-safety filters + COPPA implications — adjust system prompt + add output moderation pass.)
5. Do you want barge-in (user interrupts the lamp mid-speech)? Doable with VAD-on-output but adds real complexity; skip for v1.
