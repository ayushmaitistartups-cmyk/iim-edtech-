# HARDWARE_CONTEXT.md — What the backend needs to know about the lamp

> **Audience:** Python backend engineers (and the LLM that scaffolds the
> backend). You don't have to read the firmware sources or the wire-protocol
> spec to use this doc — every byte format, every timing constraint, every
> endpoint the lamp will hit is documented here.
>
> **Read order if you're new:** §0 → §3 (state machine) → §4 (data the lamp
> sends you) → §5 (data the lamp expects from you) → §10 (cheat sheet).
> Everything else is reference.
>
> **Sources:** `PROJECT_CONTEXT.md` (hardware inventory + DSP behaviour),
> `BACKEND_DESIGN.md` (architecture intent), `BACKEND_TODO.md` (your
> checklist), `IMPLEMENTATION_WEBSOCKET.md` (wire protocol detail),
> `IMPLEMENTATION_AUTH_PAIRING.md` (pairing endpoints — currently deferred).

---

## 0. What the lamp is

A single ESP32-S3 board that is:

- Always on, plugged in.
- Listening continuously for the wake word **"hey lumos"** locally (Edge Impulse model, runs on-device with NO network access).
- Equipped with **one microphone** (INMP441, 16 kHz mono I2S RX), **one camera** (OV5640, JPEG output), **one TFT screen** (ILI9341/ST7789, 240×320 RGB565), **one speaker** (MAX98357A I2S TX), **one RGB status LED** (WS2812B), optional buttons.
- Connected to the backend via **one persistent WebSocket (WSS)**, opened at boot and held forever.
- **Stateless from the backend's perspective other than `device_id`** — restart it and the only thing it remembers is its pairing JWT in NVS (when auth is on).

The lamp **never** runs any user-facing UI logic (no LLM on device, no LaTeX rendering on device, no transcription on device). The backend does everything heavy.

```
┌────────────────────────────────────────────────┐
│ Lamp                                            │
│   ┌─────────┐                                  │
│   │  mic    │── DSP → wake word → state machine│
│   └─────────┘            │                     │
│   ┌─────────┐            │ ┌──────────┐        │
│   │ camera  │            ▼ │ WS client│        │
│   └─────────┘  IMAGE_JPEG  │ (one     ├───────►│ Python backend
│   ┌─────────┐  AUDIO_CHUNK │  WSS     │◄───────┤   you build this
│   │ TFT     │◄ TFT_FRAME   │  socket) │        │
│   └─────────┘  TFT_TEXT    │          │        │
│   ┌─────────┐  AUDIO_OUT   │          │        │
│   │ speaker │◄ STATE       │          │        │
│   └─────────┘              └──────────┘        │
└────────────────────────────────────────────────┘
```

---

## 1. Hardware capability matrix

| Capability | Spec | Implications for backend |
|---|---|---|
| Mic | INMP441, I2S, **16 kHz mono int16 LE** | You receive audio as raw PCM at this rate/format. Don't expect WAV headers, MP3, or Opus. |
| On-device DSP | NS → ALE → AGC → VAD on the lamp | Audio you receive is **already denoised + AGC'd**. Skip backend NS. |
| Wake word | "hey lumos" — local Edge Impulse model | The backend is contacted **only** after wake. You never see continuous audio. |
| EOS detection | VAD-based: ≥ 2.5 s silence after ≥ 1 s speech, OR 30 s hard cap | A command audio clip arrives complete; you don't have to detect speech-end yourself. |
| Camera | OV5640, JPEG output, ~640×480 typical, q=10–20 | JPEGs come pre-compressed. Just forward bytes to the LLM API. |
| TFT | Panel native 240×320; lamp uses **LANDSCAPE rotation** (320 W × 240 H). RGB565 big-endian byte-swapped, BGR colour order. | Render LaTeX at **W=320, H=240 landscape** (`DisplayConfig(orientation=LANDSCAPE)` is the default in `Latex_engine_tft.py`). Already matches the lamp's `tft_ui` rotation 3. |
| Speaker | MAX98357A I2S TX, **24 kHz mono int16 LE** wire format (lamp expands to stereo internally for full volume on the DAC). Wired via `tutor_lamp/spk_i2s.{h,cpp}` — 32 KB DRAM ring + playback task on core 0 priority 2. | You ship TTS as **mono** at 24 kHz int16 LE. Cartesia/Kokoro `output_format=pcm_s16le sample_rate=24000`. The lamp duplicates L=R itself before the I2S write. |
| RGB LED | WS2812B (single pixel), GPIO 48 | Backend can drive LED state via the `STATE` frame (one byte enum). |
| Buttons | 5 buttons via ADC ladder on GPIO 2 (Up/Down/Left/Right/Select) — `tutor_lamp/buttons.{h,cpp}` wired | `CANCEL` (`0x04`) IS now sent if the user hits Select during MODE_COMMAND/MODE_SENDING. Treat it. |
| MCU compute | ESP32-S3, 240 MHz dual-core LX7 with FPU, 512 KB SRAM, PSRAM (OPI) | Heavy work happens on the lamp's *capture task* (mic) and *loop()*. Don't assume the lamp can decode TFT_FRAME and play AUDIO_OUT simultaneously without breathing room — keep frames moderate. |
| Network | WiFi 2.4 GHz, TLS via mbedTLS | Single persistent `wss://` socket. Reconnects with exp backoff 2 → 30 s. |
| Persistent storage | NVS (~4 KB key/value flash partition) | Stores `device_id`, `device_secret`, `device_jwt`, WiFi creds. Not a database. |

---

## 2. Network endpoints the lamp uses

### 2.1 During pairing (deferred — `ENABLE_AUTH=1` only)
| Method | URL | Auth | When |
|---|---|---|---|
| `POST` | `{BACKEND}/api/device/register` | body: `{device_id, device_secret}` | First boot with no JWT |
| `POST` | `{BACKEND}/api/device/poll-pairing` | body: `{device_id, device_secret, pairing_code}` | Polled every 3 s after `/register` |

Full request/response shapes are in `IMPLEMENTATION_AUTH_PAIRING.md` §6.1.1–§6.1.2. **Not needed right now** — backend's `ENABLE_AUTH=False` makes these endpoints unnecessary.

### 2.2 During normal operation (the only path you need today)
| Protocol | URL | Auth | Lifetime |
|---|---|---|---|
| **WSS** | `{BACKEND_WSS}/lamp/ws` | `Authorization: Bearer <device_jwt>` (literal `"dev-mode-no-auth"` in dev) | One per boot, held open. Lamp reconnects on drop with exp backoff. |

After the WebSocket upgrades, **all** runtime data flows over this one socket.

### 2.3 What the lamp does NOT do
- ❌ Make HTTP POSTs per request like REST.
- ❌ Long-poll / SSE.
- ❌ Open a second connection.
- ❌ Talk to Clerk or any third-party.
- ❌ Open a server port the backend can reach in (lamp is NAT'd; backend can only talk via the open WS).

---

## 3. The lamp's state machine (so backend knows context)

The lamp has three modes. **Pre-pairing/auth states are not shown** — they happen before the WebSocket opens.

```
                       wake::tick() true        (WS open the whole time)
   ┌──────────────────────────────────────────┐
   │                                          ▼
MODE_IDLE                                MODE_COMMAND
LED: cyan breathing                      LED: red breathing
WS: open, idle                           WS: stream AUDIO_CHUNK every ~20 ms
   ▲                                          │
   │                                          │ VAD silence ≥ 2.5 s
   │                                          │ OR cmd_buf full (30 s cap)
   │                                          ▼
   │                                     MODE_SENDING
   │                                     LED: orange strobe
   │                                     WS: send AUDIO_END once, then reset
   └──────────────────────────────────────────┘
```

**What the backend sees (per turn):**

| Order | Frame | When (relative to wake) | Backend reaction |
|---|---|---|---|
| 1 | `IMAGE_JPEG` (`0x01`) | t ≈ 100 ms after wake | Cache for upcoming LLM call |
| 2..N | `AUDIO_CHUNK` (`0x02`) | every ~20 ms while user speaks | Append to bytearray |
| N+1 | `AUDIO_END` (`0x03`) | EOS detected on lamp | Fire LLM call |
| (later) | `CANCEL` (`0x04`) | If buttons module ever sends it | Abort the in-flight LLM/TTS task |

> ⚠️ `IMAGE_JPEG` is **not yet sent** by the current firmware (camera module is on the TODO list). For now the lamp sends only audio. The backend should accept turns with no image and degrade gracefully (just don't pass an image to the LLM).

---

## 4. Data the lamp SENDS to the backend

All frames share the same outer header (per `IMPLEMENTATION_WEBSOCKET.md` §4.2):

```
 byte 0       byte 1   byte 2   byte 3       byte 4 .. 3+N
 ┌──────┐    ┌────────────────────────┐     ┌─────────────┐
 │ type │    │  length (3 bytes, BE)  │     │  payload    │
 │ u8   │    │       u24              │     │  N bytes    │
 └──────┘    └────────────────────────┘     └─────────────┘
```

One application frame = one WebSocket **binary** message. All numerics big-endian unless explicitly noted.

### 4.1 `0x01 IMAGE_JPEG` (terminator) + `0x05 IMAGE_PART` (intermediate chunks)
The lamp sends every image as a sequence of small WS messages — the
ArduinoWebsockets library on the lamp can't safely transmit a single
WS frame larger than ~4 KB (heap-fragmentation `bad_alloc` crashes
the chip, see §6). So:

```
FRAME_IMAGE_PART × N   (each ≤ 1 KB payload)
FRAME_IMAGE_JPEG × 1   (the final chunk — signals "image complete")
```

| Field | Value |
|---|---|
| `IMAGE_PART` payload | Raw JPEG bytes, ≤ 1 KB per chunk. Append to a per-session accumulator. |
| `IMAGE_JPEG` payload | Raw JPEG bytes — the LAST chunk. Append to accumulator, then treat the accumulator as a complete JPEG. |
| Typical total size | 20–40 KB at SVGA q=10 (see §10 "lamp camera default") |
| Maximum total size | 200 KB hard cap recommended; lamp side won't send larger. |
| Single-message case | If accumulator is empty when `IMAGE_JPEG` arrives, the lamp sent a tiny image that fit in one message — treat the payload directly as the complete JPEG. Backward-compatible. |
| Frequency | **One image per turn**, ~25 PARTs + 1 JPEG terminator, fired ~100 ms after wake-word detection. |
| What to do | Maintain `session.image_accum: bytearray`. On PART → `extend(payload)`. On JPEG → either append + flush if accum non-empty, or treat payload as complete if accum empty. Forward to LLM as `mime_type="image/jpeg"`. Reference impl: `dummy_backend.py:handler` (`F_IMAGE_PART` / `F_IMAGE_JPEG` branches). |

### 4.2 `0x02 AUDIO_CHUNK` — streaming command audio
| Field | Value |
|---|---|
| Payload | int16 **little-endian** PCM, **16 kHz mono**. ~320 samples per chunk (640 bytes). |
| Typical chunk rate | ~50 frames per second (one per 20 ms DMA frame) |
| Total per turn | ~3 s × 50 = 150 chunks ≈ 96 KB total |
| Maximum per turn | 30 s × 50 = 1 500 chunks ≈ 960 KB |
| What to do | Append to `bytearray`. **Do not** echo / acknowledge — fire-and-forget on the lamp side. |
| Validation | length always even, ≤ 640 B in practice. Warn (don't crash) on odd or oversized. |

**Audio is already cleaned.** The on-device pipeline applies single-band Wiener noise suppression, NLMS adaptive line enhancement, AGC with hold-during-silence, and VAD. The samples you receive are **post-NS/ALE/AGC** — clean enough to send straight to Gemini's audio input. Don't apply backend NS or AGC; you'll undo work and waste latency.

### 4.3 `0x03 AUDIO_END` — end-of-speech marker
| Field | Value |
|---|---|
| Payload | Empty (`length = 0`) |
| When | The lamp's VAD detected ≥ 2.5 s of silence after ≥ 1 s of speech, OR the 30 s hard cap fired |
| What to do | **Trigger LLM call.** This is your "user finished speaking" signal. |

After receiving `AUDIO_END` for a turn, the lamp will not send any more `AUDIO_CHUNK` for that turn. The next thing you may receive is another `IMAGE_JPEG`/`AUDIO_CHUNK` sequence for the next utterance (which won't happen until the user says "hey lumos" again).

### 4.4 `0x04 CANCEL` — user aborted
| Field | Value |
|---|---|
| Payload | Empty |
| When | (Future) user pressed a cancel button. Not sent today; firmware has no buttons module. |
| What to do | Cancel in-flight LLM/TTS task, send `STATE(idle)` + `TFT_CLEAR`, drop queued AUDIO_OUT. |

### 4.5 PING/PONG (transparent)
The lamp library handles its own 10 s WebSocket ping. Don't generate them server-side; just respond to PING with PONG (the FastAPI WebSocket layer does this automatically).

---

## 5. Data the backend SENDS to the lamp

Same outer header format as §4. All numerics big-endian.

### 5.1 `0x10 AUDIO_OUT` — TTS PCM chunks
| Field | Value |
|---|---|
| Payload | int16 **little-endian** PCM, **24 kHz mono**. |
| **Recommended chunk size** | **4 KB per frame (= 2 048 samples = 85 ms of audio at 24 kHz mono)**. This is the EXACT one-chunk playback duration so backend pacing and speaker drain stay aligned. ≤ 4 KB also keeps each WS message under the lamp's heap-fragmentation cap (see §6). |
| **Pacing (critical)** | **One chunk every ~85 ms wall-clock** (matches playback rate exactly). Earlier docs said "12 KB / 250 ms" — that's WRONG. Sending at 70 ms (old `dummy_backend.py` default) over-sent by 22% and overflowed the speaker ring after ~3 s of playback (`[spk] ring full — dropped`). Reference: `dummy_backend.py` `CHUNK_BYTES = 4096`, `CHUNK_INTERVAL_S = 0.085`. |
| Frequency | ~12 chunks/sec, ~47 KB/sec wire load. |
| Total per turn | 10 s TTS = ~480 KB across ~117 chunks. 3-min TTS = ~8.6 MB across ~2100 chunks. |
| Lamp's reaction | The WS RX path calls `spk::push_pcm()` which enqueues bytes into a **64 KB FreeRTOS ring buffer** (≈ 680 ms of audio at 24 kHz — bumped from 32 KB to absorb bursts from concurrent chunked TFT_FRAME traffic). A dedicated **playback task on core 0, priority 2** drains the ring, expands each mono int16 sample to **stereo** (`L = R = sample`) into a 2 KB DRAM buffer, and writes to **I2S_NUM_0 TX** via DMA. The mono→stereo expansion is what makes the MAX98357A play at full volume regardless of how SD is wired. |
| First chunk behaviour | **Half-duplex with the mic:** on the very first `AUDIO_OUT` chunk per turn, the playback task calls `mic::stop()` → uninstalls `I2S_NUM_0` (mic) → reinstalls it in TX mode at 24 kHz stereo → starts playing. Cold-start latency from first byte received to first audible sample is **~100 ms** (matches §7 budget). While playing, the mic is OFF and wake-word detection cannot fire — user must use the Select button to cancel (sends `FRAME_CANCEL`). |
| Backpressure | If you ship faster than the lamp drains, `push_pcm` blocks the WS RX path for up to 20 ms then drops the chunk (`[spk] ring full — dropped`). The 64 KB ring + WiFi-stack TCP buffer give ~1 s headroom — 85 ms / 4 KB pacing never drops. |

### 5.2 `0x11 AUDIO_OUT_END` — end of TTS
| Field | Value |
|---|---|
| Payload | Empty |
| When | After the last `AUDIO_OUT` chunk of a turn |
| Lamp's reaction | Sets the internal "end marked" flag. The playback task keeps draining the ring until it empties, then waits a 200 ms safety window for late chunks, then calls `release_i2s_tx()`: uninstalls TX, reinstalls `I2S_NUM_0` in RX mode at 16 kHz for the mic, restarts the capture task, resets `audio_post_process` + `wake::reset_debounce`. **Net mic-deaf gap after AUDIO_OUT_END: ~300–500 ms.** During that window the lamp will not hear "hey lumos". |
| Why you MUST send it | Without `AUDIO_OUT_END` the lamp never releases I2S back to the mic. The lamp would stay locked with the LED on "speaking" forever and would not accept the next wake. |

### 5.3 `0x20 TFT_FRAME` (terminator) + `0x23 TFT_PART` (intermediate chunks)
This is the LaTeX path. The lamp does not render LaTeX; you do.

**Just like IMAGE_JPEG, TFT_FRAME payloads MUST be chunked.** A single screen
of LaTeX is 153 KB, a 24-frame scroll animation is 3.6 MB — far above the
lamp's ~4 KB-per-WS-message receive limit (see §6). The protocol mirrors
IMAGE_JPEG:

```
FRAME_TFT_PART × N    (each ≤ 2 KB payload)
FRAME_TFT_FRAME × 1   (final chunk — signals "frame complete")
```

The backend chunks the rendered `[u16 W][u16 H][u8 nFrames][u8 rsv][pixels]`
payload into ≤ 2 KB pieces. The lamp accumulates them into a single 3 MB
PSRAM buffer (shared with `tft_ui::s_latex` — both pointers reference the
same allocation, so chunked receive writes directly into the cache with no
extra copy). On the `FRAME_TFT_FRAME` terminator the lamp commits the
buffer and transitions to `PAGE_SPEAKING_LATEX`.

Single-message TFT_FRAME (payload ≤ 2 KB) still works — if the lamp's
accumulator is empty when a TFT_FRAME arrives, it's treated as a complete
one-shot frame. Backward-compatible.

Reference implementation: `dummy_backend.py:_send_tft_frame_chunked()`.


**Payload layout (inner):**
```
 byte 0..1   byte 2..3   byte 4    byte 5     byte 6 ..
 ┌────────┐ ┌────────┐ ┌───────┐ ┌──────┐   ┌────────────────────────┐
 │ W (BE) │ │ H (BE) │ │ nFram │ │ rsv  │   │ RGB565 pixels          │
 │  u16   │ │  u16   │ │  u8   │ │  u8  │   │ W*H*2*nFrames bytes    │
 └────────┘ └────────┘ └───────┘ └──────┘   └────────────────────────┘
```

| Field | Value |
|---|---|
| W, H | Frame dimensions in pixels. Lamp is **landscape**: `W=320, H=240`. |
| nFrames | `1` if the equation fits the screen; `>1` for wide equations the lamp will scroll-animate via buttons. |
| rsv | Must be `0`. |
| pixels | RGB565, **big-endian byte-swapped, BGR colour order** — exactly what `Latex_engine_tft.py` `_to_rgb565(..., "BGR")` produces. Don't byte-swap on the backend; the lamp's `tft_ui::on_tft_frame` calls `pushColors(swap=false)`. |
| Total size | Single 320×240 frame = `6 + 320*240*2 = 153 606 bytes`. Multi-frame ≤ 8 frames. |
| **Scrolling behaviour** | **Multi-frame is no longer auto-animated.** The lamp paints frame 0; the user navigates with the **Left** (`< prev`) and **Right** (`next >`) buttons. A `1/N` page indicator sits at the bottom-right. |
| **Vertical budget** | Lamp reserves the **top 20 px** for the status bar and the **bottom 18 px** for the hint strip. A frame at full `H=240` will have its bottom 18 px overlaid by the hint strip. **Recommended:** the LaTeX engine's `eq_max_height=0.2` already keeps equations ≈ 48 px tall and vertically centred — they fit comfortably. If you want zero overlap, render at `W=320, H=200`. |

**How to build it from `Latex_engine_tft.py`:**

```python
from Latex_engine_tft import LatexRenderer, DisplayConfig, Orientation
import struct

cfg      = DisplayConfig(orientation=Orientation.LANDSCAPE)  # 320×240, matches lamp
renderer = LatexRenderer(cfg)

pixels   = renderer.render(latex_str)     # concatenated frames as bytes
W, H     = cfg.render_w, cfg.render_h     # 320, 240
n_frames = len(pixels) // (W * H * 2)
inner    = struct.pack(">HHBB", W, H, n_frames, 0)
payload  = inner + pixels
# Then send_frame(0x20, payload) via the WebSocket session.
```

### 5.4 `0x21 TFT_TEXT` — short plain-text message
| Field | Value |
|---|---|
| Payload | UTF-8 string, **≤ 200 bytes** |
| Lamp's reaction | Renders with the on-device font, auto-wraps at the screen edge. Non-Latin glyphs render as garbage — for those, use `TFT_FRAME`. |
| Typical use | "Thinking…", "Try again", definitions, hints. |

### 5.5 `0x22 TFT_CLEAR` — wipe display
| Field | Value |
|---|---|
| Payload | Empty |
| Use | End-of-turn when there's no display content; after CANCEL; before showing a new screen. |

### 5.6 `0x30 STATE` — drive the LED **and** the lamp's UI page
| Field | Value |
|---|---|
| Payload | One byte, enum: |

| Byte | Meaning | LED on lamp |
|---|---|---|
| `0x00` | idle | cyan breathing (default after `AUDIO_OUT_END`) |
| `0x01` | listening | red breathing (the lamp already enters this locally on wake; you can re-affirm) |
| `0x02` | thinking | orange slow pulse |
| `0x03` | speaking | warm yellow steady |
| `0x04` | error | red strobe |
| `0x05` | unpaired | red strobe + **lamp wipes JWT and reboots** to pairing mode |

> Send `STATE(0x02)` as soon as you get `AUDIO_END`, `STATE(0x03)` just before first `AUDIO_OUT`, and `STATE(0x00)` after `AUDIO_OUT_END`. The lamp's UI module (`tft_ui`) responds to STATE by transitioning pages:
>
> | STATE byte | LED | TFT page transition |
> |---|---|---|
> | `0x00 idle` | cyan breathing | → `PAGE_IDLE` (animated eyes) |
> | `0x02 thinking` | orange pulse | → `PAGE_THINKING` (orbiting-dots spinner) |
> | `0x03 speaking` | warm yellow | side-edge speaker animation activates |
> | `0x05 unpaired` | red strobe | clears JWT, reboots |
>
> The lamp already shows its own "Listening" waveform + "Thinking" spinner locally based on `pipeline_mode`, so STATE is **redundant but recommended** — it makes the LED + top-bar state glyph match what your server is actually doing.

### 5.7 Ordering you MUST follow for one turn

The proven flow from `dummy_backend.py:_respond`:

```
(receive AUDIO_END from lamp)
  │
  ├─► send STATE(0x02 thinking)             ← optional, but lights the LED
  │
  │   (LLM call running…)
  │
  ├─► send STATE(0x03 speaking)
  │
  ├─► send TFT_TEXT (small, ~one WS message) ← lamp page transitions
  │                                            THINKING → SPEAKING_TEXT
  │                                            IMMEDIATELY — kills the
  │                                            "spinner during audio" gap
  │
  ├─► (render LaTeX synchronously, ~0.5 s, matplotlib)
  │
  ├─► await asyncio.gather(                 ← RUN IN PARALLEL — critical
  │     stream_audio(pcm),                  ←   paced 85 ms / 4 KB chunks
  │     send_tft_frame_chunked(payload)     ←   unpaced 2 KB chunks
  │   )                                       Audio reaches speaker within
  │                                           ~100 ms of EOS; LaTeX TFT_PARTs
  │                                           interleave on the wire. When
  │                                           the TFT_FRAME terminator lands,
  │                                           lamp transitions to combined
  │                                           SPEAKING_LATEX view (formula
  │                                           on top, text card below).
  │
  ├─► send AUDIO_OUT_END                    ← REQUIRED, releases I2S to mic
  └─► send STATE(0x00 idle)                 ← REQUIRED, returns LED to cyan
```

A turn that emits no display still must end with `AUDIO_OUT_END` and `STATE(idle)`.

**Anti-pattern:** sending TFT_FRAME chunked SEQUENTIALLY before audio
(`await send_display(); await stream_audio()`). At ~2 MB chunked LaTeX
that's 3–5 s of silent lamp before the user hears anything. Always
`asyncio.gather()` the two streams.

---

## 6. Data format reference (the exact bytes on the wire)

| Frame type | Value | Direction | Notes |
|---|---|---|---|
| `IMAGE_JPEG` | `0x01` | lamp → backend | final chunk of an image (or whole image if small) |
| `AUDIO_CHUNK` | `0x02` | lamp → backend | int16 LE 16 kHz mono, ~640 B |
| `AUDIO_END` | `0x03` | lamp → backend | empty payload, fires LLM |
| `CANCEL` | `0x04` | lamp → backend | empty payload, abort in-flight |
| `IMAGE_PART` | `0x05` | lamp → backend | intermediate chunk of a chunked image (lamp accumulates) |
| `AUDIO_OUT` | `0x10` | backend → lamp | int16 LE 24 kHz mono TTS, **4 KB / 85 ms paced** |
| `AUDIO_OUT_END` | `0x11` | backend → lamp | empty, REQUIRED — releases I2S to mic |
| `TFT_FRAME` | `0x20` | backend → lamp | final chunk of a TFT frame (commits LaTeX page) |
| `TFT_TEXT` | `0x21` | backend → lamp | UTF-8 ≤ 200 B |
| `TFT_CLEAR` | `0x22` | backend → lamp | empty |
| `TFT_PART` | `0x23` | backend → lamp | intermediate chunk of a chunked TFT_FRAME, ≤ 2 KB |
| `STATE` | `0x30` | backend → lamp | one byte enum |

Format conventions:

| Domain | Format | Endianness |
|---|---|---|
| Outer frame header | `[u8 type][u24 length]` (4 bytes total) | length is **big-endian** |
| `AUDIO_CHUNK` PCM | int16, 16 kHz, mono | **little-endian** |
| `AUDIO_OUT` PCM | int16, 24 kHz, mono | **little-endian** |
| `IMAGE_JPEG` / `IMAGE_PART` | raw JPEG bytes (each chunk is a slice; reassemble in order) | n/a |
| `TFT_FRAME` inner header | `[u16 W][u16 H][u8 nFrames][u8 rsv]` (6 bytes, sits at offset 0 of the reassembled buffer) | W, H **big-endian** |
| `TFT_FRAME` pixels | RGB565, **byte-swapped big-endian**, BGR colour order | per-pixel BE on the wire |
| `TFT_TEXT` | UTF-8 string | n/a |
| `STATE` | one byte enum | n/a |

**WS MAX FRAME SIZE — hard rule, both directions:** Each WebSocket
message **must be ≤ ~4 KB**. The lamp's `ArduinoWebsockets` library
allocates a contiguous DRAM `std::string` of `len` bytes on both
`sendBinary()` and the `WebsocketsMessage` ctor — anything larger than
the lamp's ~128 KB DRAM headroom (under WiFi+camera+I2S load, with
fragmentation) throws `std::bad_alloc`, no `catch`, → `terminate()` →
`abort()` → reboot. Reference: `BACKEND_DESIGN.md §4.6.1 "Wire format
gotcha"`. The two CHUNKED protocols (`IMAGE_PART` and `TFT_PART`) exist
solely to obey this limit. Future frame types > 4 KB MUST follow the
same pattern.

When in doubt: outer length is BE; audio PCM is LE (native ESP32); TFT pixels are BE-swapped per pixel (this is what TFT_eSPI expects with `swap=false`).

---

## 7. Latency expectations

What the firmware promises (and what the backend should beat):

| Stage | Budget | Notes |
|---|---|---|
| Wake-word fire → first `AUDIO_CHUNK` over WS | ≤ 150 ms | mic DSP + WS encode |
| First `AUDIO_CHUNK` → last (EOS) | speaker-dependent | ~3 s typical, 30 s max |
| `AUDIO_END` → backend receives | < 50 ms over home WiFi | one WS frame |
| **`AUDIO_END` → first `AUDIO_OUT` arrives at lamp** | **≤ 1500 ms target, ≤ 2500 ms max** | LLM TTFT + TTS TTFT + network |
| First `AUDIO_OUT` arrives → speaker plays | ~100 ms | ring buffer prefill |
| Final `AUDIO_OUT_END` arrives → speaker silent | ~250 ms after ring buffer drains | n/a |

If end-to-end > 2.5 s, **drop the multimodal+JSON contract**, switch to streaming TTS earlier (per `BACKEND_TODO.md` §5.1).

---

## 8. Behaviour you should not assume

The lamp's firmware has some intentional quirks. The backend should not break them:

| Don't | Why |
|---|---|
| ❌ Send `AUDIO_CHUNK` *to* the lamp | That's a lamp→backend frame. Use `AUDIO_OUT`. The lamp will silently drop unknown direction. |
| ❌ Send `AUDIO_OUT` at any rate other than 24 kHz int16 LE mono | The lamp's I2S TX is configured for that exact rate. Other rates will sound wrong. |
| ❌ Send `TFT_FRAME` with `swap=true` style RGB565 (native ESP32 order, not byte-swapped) | The lamp calls `pushColors(swap=false)` to match `Latex_engine_tft.py`. You'd see a colour-mangled equation. |
| ❌ Send ANY single WS message > ~4 KB | ArduinoWebsockets allocates a contiguous DRAM `std::string` of the message length on receive — beyond ~4 KB risks `bad_alloc` → abort → reboot. Use the chunked protocols (`TFT_PART` 0x23 + `TFT_FRAME` terminator; `IMAGE_PART` 0x05 + `IMAGE_JPEG` terminator). The "single 153 KB TFT_FRAME" path quoted in older docs IS NOT SAFE and will brick the lamp under load. |
| ❌ Re-encode the lamp's audio with denoise / AGC | It's already been through NS/ALE/AGC on the device. Re-processing typically hurts LLM understanding. |
| ❌ Expect VAD / EOS info beyond `AUDIO_END` | The lamp doesn't tell you intermediate VAD state. |
| ❌ Send a STATE byte the lamp doesn't recognise | Anything other than `0x00–0x05` is silently dropped (no crash, but no LED change either). |
| ❌ Assume you can hold AUDIO_OUT for "later" | The lamp's speaker ring buffer is **64 KB** (~680 ms at 24 kHz). If you over-send (faster than 85 ms / 4 KB), the lamp drops oldest. Pace 85 ms/4 KB wall-clock — exactly matches playback rate. |
| ❌ Forget `AUDIO_OUT_END` | Without it, the lamp's state machine never returns to idle. The user will see a stuck "speaking" LED forever. |

---

## 9. Hardware limitations the backend should respect

| Resource | Limit | Backend implication |
|---|---|---|
| PSRAM (`cmd_buf`) | 96 KB allocated for recording | Hard cap of 30 s audio per turn; lamp enforces this. |
| WS RX buffer | Tunable (default ~64 KB) | Keep one frame ≤ 96 KB to be safe. TFT_FRAME needs bumped buffer (see `IMPLEMENTATION_WEBSOCKET.md` §6.1). |
| Speaker ring buffer | **64 KB DRAM, implemented in `spk_i2s.cpp`** (≈ 680 ms of audio at 24 kHz — bumped from 32 KB after parallel TFT_PART bursts caused overflows). | Don't send AUDIO_OUT faster than the lamp can play. Pace **85 ms / 4 KB** exactly = playback rate. |
| Mono→stereo expansion buffer | 2 KB DRAM, owned by `spk_i2s` | Internal. You always send **mono**; the lamp duplicates samples L=R on its side. |
| Half-duplex mic ↔ speaker | One physical I2S controller (`I2S_NUM_0`) with shared BCK/WS pins. Only one mode active at a time. | While speaker plays, mic is off. ~100 ms cold-start before audible, ~300–500 ms warm-up after `AUDIO_OUT_END` before mic is back. |
| Mic DMA buffer | 8 × 256 = 2 KB per ear | Lamp internal; not your concern unless you starve loop() with huge inbound frames. |
| TFT SPI throughput | ~40 MHz, ~150 ms to push a full 240×320 frame | A long scroll (`nFrames=8`) = ~1.2 s of SPI traffic. During that time the lamp can't comfortably also drink a 12 KB AUDIO_OUT every 250 ms. Stagger TFT_FRAME slightly after first AUDIO_OUT. |
| Single mic + single speaker | n/a | No echo cancellation in v1. Don't play loud TTS while expecting the user to interrupt — full-duplex is a v2 feature. |

---

## 10. Cheat sheet — what to remember

```
                    INBOUND (lamp → backend)
─────────────────────────────────────────────────────────────────
0x05 IMAGE_PART      JPEG slice ≤ 1 KB       lamp accumulates
0x01 IMAGE_JPEG      JPEG slice (terminator) flushes accumulator
                     → SVGA q=10 ≈ 20–40 KB across ~25 PARTs + 1 JPEG
0x02 AUDIO_CHUNK     int16 LE 16 kHz mono    ~640 B each, ~50/sec
0x03 AUDIO_END       empty                   once, signals EOS
0x04 CANCEL          empty                   user pressed Select

                    OUTBOUND (backend → lamp)
─────────────────────────────────────────────────────────────────
0x10 AUDIO_OUT       int16 LE 24 kHz MONO    EXACTLY 4 KB / 85 ms paced
                     → lamp expands L=R internally for full DAC volume
                     → first chunk steals I2S from mic (half-duplex)
                     → 64 KB ring buffer on lamp; over-send → drops
0x11 AUDIO_OUT_END   empty                   REQUIRED — releases I2S back
                                              to mic (~300–500 ms gap)
0x23 TFT_PART        ≤ 2 KB chunk            lamp accumulates
0x20 TFT_FRAME       chunk (terminator)      [W H nFrames rsv][pixels]
                     → 320×240×2 = 153 KB single screen
                     → 24-frame scroll ≈ 3.6 MB across ~1380 PARTs
                     → SEND IN PARALLEL with AUDIO_OUT via asyncio.gather
0x21 TFT_TEXT        UTF-8 ≤ 200 bytes       built-in font on-device
0x22 TFT_CLEAR       empty                   wipe screen
0x30 STATE           1 byte                  0x00 idle, 0x02 thinking,
                                              0x03 speaking, 0x05 unpaired

                    HARD RULE
─────────────────────────────────────────────────────────────────
Every WS message ≤ ~4 KB, both directions. Larger → bad_alloc → reboot.

                    URLs the lamp hits
─────────────────────────────────────────────────────────────────
WSS  {BACKEND}/lamp/ws           Authorization: Bearer <device_jwt>
                                   (literal "dev-mode-no-auth" in dev)
HTTPS {BACKEND}/api/device/register   (deferred — ENABLE_AUTH=1 only)
HTTPS {BACKEND}/api/device/poll-pairing (deferred)

                    Required per-turn ordering (BACKEND → LAMP)
─────────────────────────────────────────────────────────────────
STATE(0x02 thinking)
STATE(0x03 speaking)
TFT_TEXT                              # flips PAGE_THINKING → SPEAKING_TEXT
asyncio.gather(
    AUDIO_OUT × N (paced 85 ms / 4 KB),
    TFT_PART × N + TFT_FRAME terminator,
)
AUDIO_OUT_END                         # REQUIRED
STATE(0x00 idle)                      # REQUIRED — returns LED to cyan
```

---

## 11. Cross-references

When you need more detail, go here:

| Question | Doc |
|---|---|
| Exact byte format of every frame | `IMPLEMENTATION_WEBSOCKET.md` §4 |
| Why this rate / format / byte order | `PROJECT_CONTEXT.md` Subsystems 1–4 |
| What the backend's job is, big picture | `BACKEND_DESIGN.md` |
| How to actually build the backend | `BACKEND_TODO.md` |
| Auth / pairing endpoints (deferred) | `IMPLEMENTATION_AUTH_PAIRING.md` |
| LaTeX rendering — the bytes you wrap | `Latex_engine_tft.py` (the `LatexRenderer` class) |
| What frames the lamp's `handle_server_frame()` actually dispatches today | `tutor_lamp/tutor_lamp.ino` |
| Lamp-side WebSocket implementation (the thing you talk to) | `tutor_lamp/net_ws.{h,cpp}` |
| Lamp-side TFT painter (consumer of your TFT_FRAME) | `tutor_lamp/tft_ui.{h,cpp}` (older `tft_display.{h,cpp}` is dead code) |
| Lamp-side speaker engine (consumer of your AUDIO_OUT) | `tutor_lamp/spk_i2s.{h,cpp}` — half-duplex, mono→stereo expansion, ring buffer |
| Lamp-side button reader (sender of FRAME_CANCEL) | `tutor_lamp/buttons.{h,cpp}` |

---

## 12. Lamp UI awareness — what the lamp shows on its own (no backend involved)

The lamp now has a full local UI module (`tft_ui`). Backend should know which
screens the lamp can put up **without any prompting from you**:

| Page | When the lamp shows it locally | What that means for the backend |
|---|---|---|
| `PAGE_BOOT` | first 0.5 s on power-up | n/a |
| `PAGE_WIFI_CONNECTING` | during `WiFi.begin()` wait | n/a |
| `PAGE_QR_PAIRING` | first boot with no `device_jwt` (auth on) | n/a — pairing endpoints handle it |
| `PAGE_GREETING` | ~1 s after pairing or dev boot | n/a |
| `PAGE_IDLE` | between turns — animated eyes, blink, look-around | n/a |
| `PAGE_LISTENING` | wake fires → MODE_COMMAND — live mic waveform | this is **before** you receive AUDIO_END |
| `PAGE_THINKING` | MODE_SENDING (right after EOS) — orbiting dot spinner | **the lamp shows this on its own** at AUDIO_END. You do NOT need to ship a `TFT_TEXT("Thinking…")` — it's already on-screen. |
| `PAGE_IMAGE_PREVIEW` | when camera ships, briefly after wake (~1.5 s) | n/a |
| `PAGE_SPEAKING_TEXT` | when **you** send `TFT_TEXT` and no `TFT_FRAME` has arrived for this turn | text rendered inside a card with on-device font; **UP/DOWN scrolls** if the paragraph exceeds the visible card (2 KB buffer = ~10+ pages); side-edge bars animate while AUDIO_OUT is flowing |
| `PAGE_SPEAKING_LATEX` (LaTeX-only) | when **you** send `TFT_FRAME` and no `TFT_TEXT` has arrived | pixel-perfect paint of your bytes, full screen; LEFT/RIGHT scrolls through `nFrames` |
| `PAGE_SPEAKING_LATEX` (**combined view**) | when **both** `TFT_TEXT` AND `TFT_FRAME` are loaded for the turn | LaTeX in TOP half (110 px), text card in BOTTOM half (~90 px). LEFT/RIGHT scrolls LaTeX frames; UP/DOWN scrolls text card. This is the standard "answer with formula + explanation" layout. |
| `PAGE_ERROR` | WS in `NET_FATAL` | n/a |

Things to internalise:

1. **The lamp draws "Thinking" itself.** Skip the placeholder `TFT_TEXT("Thinking...")` you may have in `services/orchestrator.py` — at best it's redundant, at worst it briefly overwrites the local spinner before being replaced by your real answer.
2. **The top status bar lives on-device.** WiFi bars + backend dot + clock + state glyph — the backend doesn't drive any of this. You don't need to maintain a "WS health" message back to the lamp.
3. **The LED is co-driven.** Local LED behaviour (cyan/red/orange/yellow) maps to local state; STATE frames you send adjust it. They don't fight — the most recent wins.
4. **No display? No problem.** If your reply has `display.kind = "none"`, just send `TFT_CLEAR`. The lamp gracefully returns to `PAGE_IDLE` after `AUDIO_OUT_END` + `STATE(0x00)` anyway.

---

## 13. Buttons — what the user can press, and what it sends you

Hardware: 5 buttons on a single ADC pin (GPIO 2) via a resistor ladder. Ranges
copied verbatim from `push_buttons/push_buttons.ino`:

| Button | Raw ADC range | tft_ui action | Triggers a frame to backend? |
|---|---|---|---|
| **Left**  (`BTN1`) | `< 200` (~0.00 V) | `PAGE_SPEAKING_LATEX`: previous scroll frame (horizontal LaTeX scroll) | no |
| **Select** (`BTN2`, centre) | `< 600` (~0.30 V → ~395) | `PAGE_SPEAKING_*` / `PAGE_IMAGE_PREVIEW`: dismiss to idle. During `MODE_COMMAND`/`MODE_SENDING`: **cancel** | **yes — sends `FRAME_CANCEL` (`0x04`)** |
| **Right** (`BTN3`) | `< 1100` (~0.59 V → ~780) | `PAGE_SPEAKING_LATEX`: next scroll frame (horizontal LaTeX scroll) | no |
| **Down**  (`BTN4`) | `< 1700` (~1.05 V → ~1380) | `PAGE_SPEAKING_TEXT` AND combined-view `PAGE_SPEAKING_LATEX`: scroll text DOWN one line | no |
| **Up**    (`BTN5`) | `< 2800` (~1.65 V → ~2180) | `PAGE_SPEAKING_TEXT` AND combined-view `PAGE_SPEAKING_LATEX`: scroll text UP one line | no |
| (no press) | `> 2800` (~3.30 V → 4095) | — | — |

> **Two axes of scroll in the combined view** (when BOTH `TFT_TEXT` and
> `TFT_FRAME` arrive for the same turn): LEFT/RIGHT moves through the
> LaTeX scroll frames (formula sliding horizontally in the top half of
> the screen); UP/DOWN scrolls the text card (paragraph in the bottom
> half). Hint strip at the bottom reads
> `L/R latex 3/18   UP/DN text 2/4   SEL exit` so users know both axes
> are live.

Debounce: 50 ms. Edge-triggered on press (no repeat-on-hold for now).

What the backend should do with `FRAME_CANCEL`:

- **Abort the in-flight LLM call** (`asyncio.Task.cancel()` on Gemini stream).
- **Cancel TTS streaming** (close the Cartesia/Kokoro async stream).
- **Drop any queued AUDIO_OUT** for this turn — don't ship anything more.
- **Optionally send** `STATE(0x00 idle)` + `TFT_CLEAR` so the LED snaps back to cyan and the screen clears. The lamp already locally jumped to `PAGE_IDLE`, so these are belt-and-braces.

---

## 14. Open gaps (firmware side — backend should be aware)

These are things the lamp **doesn't do yet**. The backend should not depend on them, and should degrade gracefully.

| Gap | Backend impact | Workaround |
|---|---|---|
| No camera module wired into `tutor_lamp.ino` | `IMAGE_JPEG` never arrives | Build LLM call with audio-only when image is absent. Gemini handles this fine. |
| **Half-duplex mic ↔ speaker on `I2S_NUM_0`** | While the lamp is playing `AUDIO_OUT`, the mic is OFF (`tutor_lamp/spk_i2s.cpp` swaps the I2S controller from RX → TX). Wake word cannot fire during TTS. | Backend should keep TTS replies short (≤ 10 s) so the lamp isn't deaf for long. User cancels via the Select button (sends `FRAME_CANCEL`). |
| **Speaker warm-up after `AUDIO_OUT_END`** | After the ring drains, the lamp takes ~300–500 ms to re-init the mic at 16 kHz, drain the INMP441 startup transient, and reset wake-word state | If you want the lamp ready to hear the next "hey lumos" quickly, end TTS replies cleanly without trailing silence chunks. |
| No production CA bundle / TLS pinning | Backend can run on HTTP/`ws://` in dev, but production needs `wss://` and a valid cert | Use Let's Encrypt + a real domain when deploying. |
| `ENABLE_AUTH=0` (firmware-side) | Lamp sends placeholder JWT | Backend must accept any JWT today. |

When these gaps close, this doc gets updated. Until then, the protocol is forward-compatible — frames you send for features the lamp doesn't yet handle are silently dropped (logged on serial only).
