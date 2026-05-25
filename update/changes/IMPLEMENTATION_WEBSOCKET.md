# IMPLEMENTATION_WEBSOCKET.md — ESP32-side WebSocket Module

> **Scope:** This document specifies *only* the WebSocket transport layer for
> the AI tutor lamp's ESP32-S3 firmware. It is self-contained: an engineer or
> agent with no prior project context can implement `net_ws.h` / `net_ws.cpp`
> from this file alone. It does **not** cover audio DSP, camera, TFT rendering,
> speaker output, the LLM backend, or system prompts — those are referenced as
> consumers/producers of frames but their internals are out of scope.

> **Status:** Specification, not yet implemented. Once implemented, file paths
> in §6 become authoritative; this document remains the protocol reference.

---

## 0. Quick orientation

The lamp talks to its backend over **one persistent secure WebSocket** (`wss://`).
All audio (in + out), the wake-time JPEG, the TTS PCM stream, the TFT pixel
frames, and small control messages multiplex through that single socket as
binary frames with a 4-byte self-describing header.

There is **no REST**, no polling, no second TCP connection. One socket per
device, opened at boot, reconnected on drop.

Why WebSocket and not REST: this module saves ~300 ms per voice turn by
amortising the TCP+TLS handshake across the whole session, and lets the server
push TTS audio and TFT frames without the device having to ask.

---

## 1. Goals and non-goals

### Goals
- Establish and maintain a single persistent `wss://` connection to the backend.
- Provide a tiny C++ API (`net::send_frame`, `net::on_frame`) so other modules
  (mic capture, camera, button handler) don't know WebSocket exists.
- Encode and decode the project's 4-byte-header binary frame format.
- Survive brief WiFi drops, NAT timeouts, and backend restarts via exponential-
  backoff reconnect.
- Be safe to call from the capture FreeRTOS task on core 1 *and* from `loop()`
  on core 1, without races.
- Fit within memory budget alongside the existing audio pipeline (see §7).

### Non-goals
- Audio capture, DSP, wake-word inference — handled by `mic_i2s` / `wake_word`.
- LaTeX rendering — happens on the backend (Python `LatexRenderer`).
- TTS, LLM inference, image preprocessing — all backend.
- HTTP/REST endpoints — none exist in this design.
- Protocol versioning / migration — v1 only for now; one open question in §13.
- Multi-device fan-out / multi-tenant routing — backend responsibility.

---

## 2. Assumptions

| # | Assumption | Failure mode if false |
|---|---|---|
| A1 | Target MCU is **ESP32-S3** with PSRAM enabled (OPI). | Out of DRAM during TLS handshake or large image upload. |
| A2 | Arduino-ESP32 core ≥ 2.0.14 with `WiFiClientSecure` available. | Build break. |
| A3 | Network is IPv4, WiFi station mode, internet reachable. | Connection never establishes; device stays in `BACKOFF`. |
| A4 | Backend exposes one TLS endpoint, default `wss://<host>:443/lamp/ws`. | 404 on upgrade; treated as auth/server error. |
| A5 | Backend issues a long-lived **device JWT** at provisioning time, stored in NVS under key `device_jwt`. | Connection rejected with HTTP 401 on upgrade. |
| A6 | Maximum payload size per frame ≤ **96 KB** (one IMAGE_JPEG at q=12, 640×480). | Library truncates / closes connection. |
| A7 | The device is the only sender of `AUDIO_CHUNK` for its session — no concurrent commands. | Out-of-order audio on the server. |
| A8 | Time on the device is *not* synced (no NTP needed for this module). All timestamps are `millis()`-based. | None — protocol is stateless w.r.t. wall time. |
| A9 | The ESP32 system CA bundle is sufficient to verify the backend's TLS cert (Let's Encrypt etc.). | TLS handshake fails; treat as connection error. |

If any assumption changes, update this section and the affected sections.

---

## 3. High-level data flow (one turn)

```
ESP32 (this module's role)                           Backend (out of scope)
──────────────────────────                           ──────────────────────
boot ──► open wss + JWT ────────────────────────────► verify, create session
        ◄────── 101 + STATE(idle) ────────────────────

(idle, socket held open, PING/PONG ~10 s)

wake word fires ──► IMAGE_JPEG (one frame) ─────────► cache + pre-upload
                ──► AUDIO_CHUNK ×N (20 ms each) ────► buffer
                ──► AUDIO_END ───────────────────────► fire LLM call

                ◄── STATE(thinking) ─────────────────
                ◄── AUDIO_OUT ×M (TTS PCM) ──────────  stream as TTS arrives
                ◄── STATE(speaking) ─────────────────
                ◄── TFT_FRAME (pre-rendered pixels) ─  if math
                ◄── AUDIO_OUT_END ───────────────────
                ◄── STATE(idle) ─────────────────────

(back to idle, socket held open)
```

Everything in the `ESP32` column flows through `net::send_frame()`. Everything
in the inbound column lands on a single `net::on_frame(cb)` callback.

---

## 4. Wire protocol — authoritative

### 4.1 Connection establishment

| Item | Value |
|---|---|
| Scheme | `wss://` (TLS only — never `ws://`) |
| Port | 443 (default for TLS) |
| Path | `/lamp/ws` |
| Subprotocol | none required (`Sec-WebSocket-Protocol` left empty). May be set to `lamp.v1` in future for version negotiation. |
| Required header | `Authorization: Bearer <device_jwt>` |
| Optional header | `X-Device-Id: <hw_serial>` (debugging convenience; not for auth) |
| Server response | `101 Switching Protocols` on success. `401` on bad/missing JWT. `426 Upgrade Required` if backend wants a newer protocol version. `5xx` retried with backoff. |

After `101`, all communication is WebSocket frames; HTTP is done.

### 4.2 Application frame format

Every WebSocket *message* carries exactly one application frame:

```
 0       1               4                                       4 + N
 ├───────┼───────────────┼───────────────────────────────────────┤
 │ type  │ length (BE)   │ payload                               │
 │ u8    │ u24, network  │ N bytes                               │
 └───────┴───────────────┴───────────────────────────────────────┘
```

- `type` (1 byte) — identifies the frame; see §4.3.
- `length` (3 bytes, **big-endian / network byte order**) — number of bytes in
  `payload`. Range 0 … 16 777 215. In practice capped at 96 KB (see A6).
- `payload` — `length` bytes; structure depends on `type`.

WebSocket-level framing (text vs binary, FIN, masking) is handled by the
library. **All our frames are sent as `binary` WebSocket messages**, even when
the payload is UTF-8 text (`TFT_TEXT`). One application frame = one WS message;
do not split or merge.

### 4.3 Frame catalog

ESP→BE = device-to-backend. BE→ESP = backend-to-device.

| Hex | Name | Dir | Payload | When |
|---|---|---|---|---|
| `0x01` | IMAGE_JPEG | ESP→BE | raw JPEG bytes (`length` = JPEG byte count) | Once per wake-word trigger, before audio. |
| `0x02` | AUDIO_CHUNK | ESP→BE | int16 PCM, **little-endian**, 16 kHz mono, ~320 samples (640 bytes, 20 ms) | Repeatedly during `MODE_COMMAND`. |
| `0x03` | AUDIO_END | ESP→BE | empty (`length` = 0) | Once when VAD EOS fires. |
| `0x04` | CANCEL | ESP→BE | empty | User pressed cancel button or backend told us via STATE to stop. |
| `0x10` | AUDIO_OUT | BE→ESP | int16 PCM, little-endian, **24 kHz** mono (TTS) | Streamed while TTS generates. |
| `0x11` | AUDIO_OUT_END | BE→ESP | empty | After last AUDIO_OUT chunk of a turn. |
| `0x20` | TFT_FRAME | BE→ESP | see §4.4 | Once per turn that has rendered display content. |
| `0x21` | TFT_TEXT | BE→ESP | UTF-8 string, ≤ 200 bytes | Once per turn that has short plain-text display. |
| `0x22` | TFT_CLEAR | BE→ESP | empty | When backend wants display blank. |
| `0x30` | STATE | BE→ESP | 1 byte enum (§4.5) | Anytime backend wants to drive LED/state. |
| `0xF0` | PING | both | empty | Library handles this transparently; do not generate. |
| `0xF1` | PONG | both | empty | Library handles this transparently. |

All other `type` values are **reserved** and MUST be ignored by both sides
(silently dropped — do not close the connection).

### 4.4 TFT_FRAME payload layout

```
 0    1    2    3    4         5    6                          6 + W*H*2*nFrames
 ├────┴────┼────┴────┼─────────┼────┼───────────────────────────┤
 │ W (BE)  │ H (BE)  │ nFrames │ rsv│  RGB565 pixels            │
 │  u16    │  u16    │  u8     │ u8 │  big-endian byte-swapped, │
 │         │         │         │    │  BGR colour order         │
 └─────────┴─────────┴─────────┴────┴───────────────────────────┘
```

- `W`, `H` — frame size in pixels, big-endian. Typically `240 × 320`.
- `nFrames` — number of consecutive `W × H` frames concatenated in the pixel
  region. `1` for an equation that fits the screen; `>1` for a wide equation
  that the device animates as a horizontal scroll, frame by frame at ~10 fps.
- `rsv` — reserved, MUST be 0.
- Pixels — exactly `W × H × 2 × nFrames` bytes. Byte order: each pixel is one
  16-bit RGB565 value stored **byte-swapped big-endian** (i.e. high byte first
  on the wire), with **BGR colour order**. This matches what TFT_eSPI's
  `pushColors(buf, n, /*swap=*/false)` expects when feeding an ILI9341. It also
  matches the existing `Latex_engine_tft.py` output format exactly.

Total payload size for one 240×320 frame: `6 + 240*320*2 = 153 606 bytes`.
Long-scrolled equations can run several frames; cap at `nFrames ≤ 8` to keep
each frame under 1.3 MB on the wire. (Backend responsibility.)

### 4.5 STATE byte enum

| Value | Meaning | LED behaviour on device |
|---|---|---|
| `0x00` | idle | breathing cyan |
| `0x01` | listening | red breathing (already entered locally on wake; STATE re-affirms) |
| `0x02` | thinking | orange slow pulse |
| `0x03` | speaking | warm yellow steady |
| `0x04` | error | red strobe |

Other values reserved. Device falls back to local LED state machine if STATE
is missing or invalid.

### 4.6 Ordering guarantees and invariants

- WebSocket guarantees in-order delivery within one direction. The device may
  rely on `AUDIO_OUT` chunks arriving in send order. The backend may rely on
  `AUDIO_CHUNK` arriving in send order.
- There is **no ordering guarantee between the two directions** — the device
  may receive `STATE(thinking)` before its own `AUDIO_END` has fully flushed.
  Each side processes its incoming stream independently.
- `IMAGE_JPEG` for turn N MUST be sent before any `AUDIO_CHUNK` of turn N.
- `AUDIO_END` MUST be the last ESP→BE frame of a turn until the next wake.
- `AUDIO_OUT_END` MUST be the last `AUDIO_OUT*` frame of a turn; the device
  uses it to know when to drain the speaker ring buffer and return to idle.
- There is no explicit "turn id" in v1. Turns are implied by `AUDIO_END` →
  `AUDIO_OUT_END` boundaries. If a session needs to multiplex turns in
  future, add a `turn_id` field — see §13.

### 4.7 Close codes

If the device chooses to close (rare):

| Code | Meaning |
|---|---|
| 1000 | Normal closure (device shutting down) |
| 1001 | Going away (deep sleep) |

If the backend closes the device, the device treats:

| Code | Action |
|---|---|
| 1000 / 1001 | Reconnect after `INITIAL_BACKOFF_MS` |
| 4401 | Auth failed — stop reconnecting, surface to user (red strobe LED) |
| 4426 | Protocol upgrade required — log and stop (out-of-date firmware) |
| any other 4xxx | Treat as fatal for this boot; halt with red strobe |
| 1006 / abrupt drop | Reconnect with exponential backoff |

---

## 5. Module surface (`net_ws.h`)

The whole module exposes nine functions. No types other than the frame-type
enum cross the module boundary.

```cpp
// net_ws.h
#pragma once
#include <stdint.h>
#include <stddef.h>

namespace net {

enum FrameType : uint8_t {
    FRAME_IMAGE_JPEG    = 0x01,
    FRAME_AUDIO_CHUNK   = 0x02,
    FRAME_AUDIO_END     = 0x03,
    FRAME_CANCEL        = 0x04,
    FRAME_AUDIO_OUT     = 0x10,
    FRAME_AUDIO_OUT_END = 0x11,
    FRAME_TFT_FRAME     = 0x20,
    FRAME_TFT_TEXT      = 0x21,
    FRAME_TFT_CLEAR     = 0x22,
    FRAME_STATE         = 0x30,
};

enum ConnState : uint8_t {
    NET_DISCONNECTED,
    NET_CONNECTING,
    NET_CONNECTED,
    NET_BACKOFF,
    NET_FATAL,        // bad JWT or unsupported protocol — do not retry
};

using on_frame_cb = void (*)(uint8_t type, const uint8_t* payload, size_t len);
using on_state_cb = void (*)(ConnState s);

// One-time init. Reads the device JWT from NVS, configures TLS, joins WiFi if
// not already joined. Does NOT connect — call connect() afterwards.
bool begin(const char* url, const char* nvs_jwt_key = "device_jwt");

// Open the WebSocket. Non-blocking; transitions through CONNECTING.
void connect();

// Drive the socket. Call from loop() every iteration. Cheap when nothing to do.
// Handles RX, ping/pong, reconnect timer, send-queue drain.
void loop();

// Send a frame. Returns true if the frame was accepted into the outbound
// queue (or sent immediately when called from loop() context). Returns false
// on queue-full or disconnected; caller decides whether to drop or retry.
// SAFE to call from any task — internally serialised.
bool send_frame(uint8_t type, const uint8_t* payload, size_t len);

// Convenience for empty-payload frames.
inline bool send_frame(uint8_t type) { return send_frame(type, nullptr, 0); }

// Register the inbound dispatcher. Callback runs in loop()'s context — safe
// to call SPI/TFT/I2S APIs from inside it, but keep it short.
void on_frame(on_frame_cb cb);

// Optional — observe connection state transitions for diagnostics/LED.
void on_state(on_state_cb cb);

// Current state. Use for guards before send_frame.
ConnState state();

}  // namespace net
```

### 5.1 Internal state machine

```
       ┌─────────────────┐
       │ NET_DISCONNECTED│◄────────────┐
       └────────┬────────┘             │ socket dropped /
       connect()│                      │ backend closed
                ▼                      │
       ┌─────────────────┐             │
       │ NET_CONNECTING  │─── auth ───►│ NET_FATAL  (no retry)
       │  (TLS + WS      │   4401/4426 │
       │   handshake)    │             │
       └────────┬────────┘             │
                │ 101 OK               │
                ▼                      │
       ┌─────────────────┐             │
       │ NET_CONNECTED   │─────────────┤
       └────────┬────────┘             │
       drop /   │                      │
       timeout  ▼                      │
       ┌─────────────────┐             │
       │ NET_BACKOFF     │── retry ────┘
       │ (wait then retry│  (exp backoff)
       │  CONNECTING)    │
       └─────────────────┘
```

Backoff schedule (jittered): 2 s, 4 s, 8 s, 16 s, 30 s, 30 s, … with ±25 %
jitter. Reset to 2 s on each successful `NET_CONNECTED`.

---

## 6. File layout and library

```
tutor_lamp/
  net_ws.h              ← header above
  net_ws.cpp            ← implementation
  config.h              ← WS_URL, NVS keys, buffer sizes (already exists)
```

### 6.1 Required Arduino library

**[ArduinoWebsockets](https://github.com/gilmaimon/ArduinoWebsockets) by Gil
Maimon**, version ≥ 0.5.4.

Reasons over alternatives:
- Supports `wss://` with `WiFiClientSecure` out of the box.
- Single-header-ish API, no fighting with build flags.
- Maintained, used in production by other ESP32 projects.

Install via Arduino Library Manager: `ArduinoWebsockets`.
Include: `#include <ArduinoWebsockets.h>`.

If you must swap libraries later, the only API surface that has to be
re-implemented is the `connect`, `send`, `poll`, `onMessage`, `onEvent`
behaviour. The frame layer (§4) is library-agnostic.

### 6.2 Compile-time configuration (`config.h`)

```cpp
#define WS_URL                "wss://lamp.example.com/lamp/ws"
#define WS_NVS_NAMESPACE      "lamp"
#define WS_NVS_KEY_JWT        "device_jwt"

#define WS_RX_MAX_FRAME       (96 * 1024)    // matches A6
#define WS_TX_QUEUE_DEPTH     8              // pending frames waiting for poll()
#define WS_AUDIO_TX_DEPTH     32             // dedicated AUDIO_CHUNK ring depth
#define WS_RECONNECT_INIT_MS  2000
#define WS_RECONNECT_MAX_MS   30000
#define WS_HEARTBEAT_MS       10000          // library-level ping interval
```

---

## 7. Memory budget

This module must coexist with the audio pipeline; budget is tight on the S3.

| Region | Size | Notes |
|---|---|---|
| TLS handshake heap | ~30–50 KB transient | Spikes during `NET_CONNECTING`. Freed afterwards. |
| TLS session buffer | ~16 KB | Held for socket lifetime. |
| ArduinoWebsockets RX buffer | `WS_RX_MAX_FRAME` (96 KB) | Allocate from **PSRAM** via `setMaxMessageSize` if the library supports it; otherwise resize down and chunk large frames at the application layer. |
| Outbound queue | `WS_TX_QUEUE_DEPTH * sizeof(FrameDesc)` ≈ 256 B | DRAM. |
| AUDIO_CHUNK ring | `WS_AUDIO_TX_DEPTH * 644 B` ≈ 21 KB | DRAM ring buffer for hot path. |
| Outbound assembly buffer | 1 × `WS_RX_MAX_FRAME` (reused) | **PSRAM**, reused across sends. |

Total steady-state cost: ~40 KB DRAM + ~100 KB PSRAM. Verify with
`heap_caps_print_heap_info` after `connect()` returns `NET_CONNECTED`.

---

## 8. Threading and serialisation

Three contexts touch this module:

| Context | Calls into net | Notes |
|---|---|---|
| `loop()` on core 1 | `net::loop()`, occasional `send_frame()` for one-shot frames (IMAGE_JPEG, AUDIO_END, CANCEL) | Owns the underlying socket and the TX queue drain. |
| Capture FreeRTOS task on core 1, priority 8 | `send_frame(FRAME_AUDIO_CHUNK, …)` only | Pre-empts loop(). Must be lock-free. |
| (None) RX path | n/a | Runs inside `ws.poll()` invoked from `loop()`. |

### 8.1 The serialisation rule

> The actual call into the ArduinoWebsockets `send()` happens ONLY from
> `net::loop()`. No other context calls the library directly.

Capture task's `send_frame(AUDIO_CHUNK, …)` pushes into a **lock-free SPSC ring
buffer** (one producer = capture task, one consumer = loop). The ring stores
copies of the audio payload — capture task's `sampleBuffer` is reused
immediately after `send_frame` returns.

One-shot frames from loop() context can bypass the ring and go straight to
`ws.send()` since they're already in the right thread.

### 8.2 RX dispatch

`on_frame_cb` is invoked from `loop()` (inside `ws.poll()` callback). It is
allowed to do anything legal in `loop()` — touch TFT SPI, push to speaker
ring, etc. — but must return quickly (< 5 ms) so the next message can be
processed.

The current TX path is not blocked while the callback runs, since the callback
just hands off to other module ring buffers.

---

## 9. Implementation tasks (concrete checklist)

Each task has a clear "done when" criterion. A new agent can run them
top-to-bottom.

### T1 — Library + config skeleton
1. Install ArduinoWebsockets ≥ 0.5.4 via Library Manager.
2. Create `net_ws.h` per §5 and an empty `net_ws.cpp` that compiles.
3. Add `#include "net_ws.h"` to `tutor_lamp.ino` and confirm it builds.

**Done when:** firmware boots unchanged with `net::begin()` called but
`connect()` not yet called.

### T2 — JWT load from NVS
1. Open NVS namespace `WS_NVS_NAMESPACE`, read key `WS_NVS_KEY_JWT` as string.
2. If absent, log error and transition to `NET_FATAL`.
3. Cache as `std::string` for the life of the process.

**Done when:** booting with a JWT pre-written to NVS prints the first/last
8 chars of the JWT in the boot log.

### T3 — `connect()` happy path
1. Configure `WiFiClientSecure` with system root CAs:
   `setCACertBundle(rootca_crt_bundle_start);`
2. Construct `WebsocketsClient` with that secure client.
3. Add header: `Authorization: Bearer <jwt>`.
4. Set max message size via library API (or document the runtime limit).
5. Call `client.connect(WS_URL)`. Transition to `NET_CONNECTING`, then
   `NET_CONNECTED` on success (library `onEvent` `ConnectionOpened`).

**Done when:** lamp connects and a test backend logs the inbound WS upgrade.

### T4 — `loop()` integration
1. `loop()` calls `net::loop()` every iteration (~ once per ms in practice).
2. Internally: pump `client.poll()` if connected; check backoff timer if
   disconnected; service the TX ring (see T6).

**Done when:** PING/PONG keep the connection alive across a 60 s idle period.

### T5 — Frame encode/decode
1. Header pack: `out[0] = type; out[1..3] = (uint24_be)len; memcpy(out+4, payload, len)`.
2. Receive: assert WS message is binary and `len ≥ 4`; unpack header; pass
   payload pointer + length to the registered `on_frame_cb`.
3. Unknown `type` → drop silently. Malformed (len < 4, or header says more
   bytes than the WS message contains) → log and close socket with 1002.

**Done when:** a unit test (loopback server) round-trips all 11 frame types.

### T6 — TX path: SPSC ring + drain
1. Implement a lock-free SPSC ring of `FrameDesc { uint8_t type; uint16_t len;
   uint8_t buf[644]; }` with `WS_AUDIO_TX_DEPTH` slots. (644 = 4 hdr + 640 PCM.)
2. `send_frame(AUDIO_CHUNK, …)` from any context: claim a slot, memcpy header
   and payload, publish. Returns false if ring full → caller decides drop.
3. One-shot `send_frame` for any other type from loop() context: assemble
   straight into the PSRAM outbound buffer and call `client.sendBinary(buf, n)`
   immediately, no ring.
4. `net::loop()` drains the ring: while ring non-empty AND `client.available()`,
   pop one slot and `client.sendBinary(...)`.

**Done when:** during simulated capture at 50 frames/s for 30 s, no audio
chunk is lost (ring depth chosen large enough; verify with a counter).

### T7 — RX dispatch
1. Library `onMessage` callback receives `WebsocketsMessage m`. Confirm
   `m.isBinary()`. Decode header per §4.2.
2. Call the user-registered `on_frame_cb(type, payload, payload_len)`.
3. If `cb` is null, drop silently.

**Done when:** test backend can send `STATE(idle)` and the LED state machine
on the device responds.

### T8 — Reconnect and backoff
1. On `ConnectionClosed` event: log close code, transition to `NET_BACKOFF`,
   set retry timer to `WS_RECONNECT_INIT_MS` × current factor.
2. After timer elapses, transition to `NET_CONNECTING` and try again.
3. On `ConnectionOpened`: reset backoff to initial.
4. Hard close on `4401` (bad auth): transition to `NET_FATAL`; never retry.

**Done when:** killing the backend mid-session causes the device to retry
every 2/4/8/16/30 s and resume cleanly when the backend comes back.

### T9 — Heartbeat / keepalive
1. ArduinoWebsockets exposes a `ping()` method and auto-pong. Enable a
   per-`WS_HEARTBEAT_MS` ping from `net::loop()`.
2. If three consecutive pings have no pong within 5 s each, force-close and
   reconnect.

**Done when:** unplugging the router for 90 s and reconnecting WiFi causes the
device to detect death and reconnect within ~30 s.

### T10 — Backpressure on RX
1. Speaker module exposes `spk::space_available()` (bytes free in its ring).
2. In the `AUDIO_OUT` dispatch case, if the speaker ring is full, **drop the
   oldest queued AUDIO_OUT** (the speaker module owns its own ring). Do not
   block the WS RX path.

**Done when:** an artificially slow consumer doesn't stall RX; the lamp falls
behind audibly but the socket stays healthy.

### T11 — Observability
1. Maintain counters: `tx_frames`, `tx_bytes`, `rx_frames`, `rx_bytes`,
   `tx_drops`, `reconnects`.
2. Print a one-line summary every 30 s when in `NET_CONNECTED`.

**Done when:** the boot log lets you tell at a glance whether the socket is
healthy.

---

## 10. Server contract — what the backend MUST do

This section is the **client-facing requirement on the backend**; it does not
specify backend implementation, only its observable behaviour. The Python
backend (out of scope of this doc) must satisfy all of it.

### 10.1 Endpoint
- `wss://<host>/lamp/ws` (port 443).
- Accept `Authorization: Bearer <jwt>`. Validate JWT signature + expiry +
  device_id claim. Reject with HTTP `401` and close code `4401` on any failure.
- Reject with HTTP `426` + close code `4426` if the device's protocol version
  is unsupported (v1 has no explicit version header; treat all current
  connections as v1).

### 10.2 Per-frame processing

| Inbound frame | Server MUST | Server MUST NOT |
|---|---|---|
| `IMAGE_JPEG` | Buffer for current turn. May pre-upload to LLM provider. | Send any response based on the image alone. |
| `AUDIO_CHUNK` | Append to current turn's PCM buffer. | Begin LLM inference before `AUDIO_END`. |
| `AUDIO_END` | Trigger LLM inference; emit AUDIO_OUT* and optional TFT_* in response. | Wait for any further inbound frame before responding. |
| `CANCEL` | Abort current turn; drop any pending AUDIO_OUT for that turn; send `STATE(idle)` and `TFT_CLEAR`. | Continue billing the LLM call (cancel it provider-side). |
| any unknown | Silently drop. | Close the connection. |

### 10.3 Outbound response shape

A normal turn emits, in this order (sentence-level streaming allowed):

```
STATE(thinking)
[AUDIO_OUT × N]                ← TTS chunks as TTS arrives
STATE(speaking)                ← may be sent before first AUDIO_OUT
[TFT_FRAME | TFT_TEXT]?         ← exactly one if display content exists
AUDIO_OUT_END
STATE(idle)
```

A turn with no spoken response (rare) emits at minimum `AUDIO_OUT_END` so the
device knows the turn is over.

### 10.4 Failure responses

- LLM provider error → `STATE(error)`, optional `TFT_TEXT("Sorry, I had trouble — try again.")`, `AUDIO_OUT_END`, `STATE(idle)`. Do not close the socket.
- Backend internal error → close socket with code `1011`. Device will reconnect.
- Auth revoked mid-session → close with `4401`.

### 10.5 Frame size and rate limits the backend MAY enforce

- Reject `IMAGE_JPEG` > 100 KB with `STATE(error)`.
- Reject more than one turn in flight (no new `AUDIO_CHUNK` accepted between
  `AUDIO_END` and the matching `AUDIO_OUT_END`).
- Rate-limit `AUDIO_CHUNK` to no more than ~110 % of real-time (52 chunks/s)
  to detect malfunctioning devices.

---

## 11. Edge cases and failure modes

| Scenario | Device behaviour |
|---|---|
| WiFi drops during command recording | Capture task keeps filling `cmd_buf`. `send_frame` returns false → drops the chunk. On reconnect, the in-flight turn is lost (no resend). LED → red strobe briefly, then back to idle. |
| Backend silent for > 10 s after `AUDIO_END` | Device stays in `MODE_AWAITING`. After 15 s timeout, lamp gives up: emit local "Sorry, no response" text on TFT and return to idle. |
| `AUDIO_OUT` arrives faster than speaker can play | Speaker module's own ring buffer drops oldest. WS RX never blocks. |
| `TFT_FRAME` payload length mismatches `W*H*2*nFrames+6` | Log, discard the frame. Do not paint. |
| Backend sends a frame mid-handshake | Library queues; we process after `ConnectionOpened`. |
| JWT expires mid-session | Backend closes with `4401`. Device → `NET_FATAL`. User must re-provision (out of scope). |
| Sudden brownout / panic | Library state lost. After reboot, fresh `connect()`. Server treats it as a new session. |

---

## 12. Test plan

| # | Test | Method |
|---|---|---|
| TC1 | Frame header round-trip | Loopback unit test for all 11 types, including 0-length payloads. |
| TC2 | Reconnect after backend restart | Restart backend Python server; verify device reconnects within 30 s. |
| TC3 | Reconnect after WiFi drop | Switch off router 30 s; verify device reconnects within 60 s of recovery. |
| TC4 | Sustained audio streaming | Capture for 60 s; verify no `tx_drops`. |
| TC5 | Large IMAGE_JPEG | Capture 95 KB JPEG; verify it arrives intact. |
| TC6 | TTS playback through speaker | Backend sends a known sine-wave PCM; device plays it cleanly. |
| TC7 | TFT_FRAME paint | Backend sends a pre-rendered LaTeX frame; device displays it identically to old `tft_latex_client.ino` output. |
| TC8 | Bad JWT | Provision an invalid JWT; verify `NET_FATAL` and red strobe. |
| TC9 | CANCEL | Press cancel button mid-command; verify backend receives CANCEL and stops responding. |
| TC10 | Backend half-close | Backend sends FIN without close frame; device reconnects. |

---

## 13. Open questions and future work

These are NOT in scope for the first implementation, but worth noting:

1. **Protocol versioning.** v1 has no version negotiation. Suggest adding
   `Sec-WebSocket-Protocol: lamp.v1` header and rejecting unknown subprotocols
   server-side once a v2 exists.
2. **Turn IDs.** Currently turns are inferred from `AUDIO_END` ↔ `AUDIO_OUT_END`
   pairing. If multi-turn pipelining or barge-in (user interrupts the lamp)
   becomes a feature, add a 4-byte `turn_id` field to every audio/TFT frame.
3. **Compression.** Audio is already low-bitrate; image could use WebP at q=70
   for ~40 % size cut. Verify ESP32 JPEG-vs-WebP encoder cost first.
4. **OTA firmware update channel.** Could ride this same socket as a new frame
   type `0x80 OTA_CHUNK`. Out of scope here.
5. **Multiple lamps per user / cross-device sync.** Backend concern, not
   protocol concern, but might motivate a `session_id` echo.
6. **Resume.** Today an in-flight turn is lost on reconnect. A future "resume"
   could re-send the last `IMAGE_JPEG` and resume `AUDIO_CHUNK` flow from
   wherever capture is now — not worth the complexity for v1.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| Frame | One application message on the wire, 4-byte header + payload (§4.2). |
| WS message | One WebSocket-level binary message. We use exactly one per frame. |
| Turn | One interaction: wake → command audio → response audio/display → idle. |
| TTFT | Time to first token (LLM). Used in latency budgeting. |
| EOS | End of speech — VAD-detected silence ≥ 2.5 s after speech. |
| MODE_* | The lamp's local state machine; see `tutor_lamp.ino`. |
| Backoff | Exponential delay between reconnect attempts. |
| SPSC | Single-producer single-consumer (ring buffer). |
| JWT | JSON Web Token; the device's auth credential, baked in at provisioning. |

---

## 15. Quick reference — frame cheat sheet (print this)

```
header: [type:1][len:3 BE]

ESP → BE                                    BE → ESP
─────────                                   ─────────
0x01 IMAGE_JPEG    JPEG bytes               0x10 AUDIO_OUT     int16 LE 24k
0x02 AUDIO_CHUNK   int16 LE 16k             0x11 AUDIO_OUT_END (empty)
0x03 AUDIO_END     (empty)                  0x20 TFT_FRAME     W,H,n,rsv,RGB565
0x04 CANCEL        (empty)                  0x21 TFT_TEXT      UTF-8
                                            0x22 TFT_CLEAR     (empty)
                                            0x30 STATE         1 byte enum

0xF0/F1 PING/PONG (library; do not generate)
```
