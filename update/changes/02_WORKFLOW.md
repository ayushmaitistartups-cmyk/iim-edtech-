# LUMOS — Complete Workflow v4
> Updated: Groq for Turn 2+, Camera OFF, Two-track format, BAO Framework

---

## 1. Turn 1 — Discovery Phase (Full Pipeline)

```
t=0    WAKE WORD "Hey Lumos"
         │
         ├── LED: WHITE SOLID
         ├── Camera ON: OV5640 captures JPEG immediately
         └── Start streaming IMAGE_JPEG frames (0x01) over WebSocket

t=0-300ms  Backend receives image
         └── Redis: store image:{session_id}:{turn_id}
         └── Pre-upload to Gemini Files API (image-first optimization)

t=300ms  Audio recording starts
         └── Stream AUDIO_CHUNK (0x02) every 20ms
         └── 320 samples × int16 × 16kHz = 640 bytes/chunk

t=~EOS   VAD detects end of speech → AUDIO_END (0x03)
         └── LED: ORANGE BREATHING (thinking)
         └── Camera: TURN OFF — no more JPEG captures this session

BACKEND — TURN 1 PIPELINE:
         │
         ▼
[STEP 1] CLASSIFY (~100ms, 1 cheap call, Gemini Flash text)
         Input:  audio transcript + image description
         Output: {query_type, difficulty, subject, exam_type,
                  exam_track, needs_grounding}
         Cache:  Layer 1 only
         │
         ▼
[STEP 2] TOPIC CONTEXT PRUNING (Redis + Postgres, ~10ms)
         Detect topic from classifier
         Query Postgres: mistakes on THIS topic only, max 3
         Build: student_topic_history summary string
         │
         ▼
[STEP 3] GENERATE MASTER SOLUTION MODEL — MSM (~400-700ms)
         Model:  Gemini 2.5 Flash (multimodal: image + audio)
         Cache:  Layer 1 + Layer 2 (student session)
         Grounding: YES if needs_grounding=True (UPSC/SSC current)
         Output: {
           master_solution: "full step-by-step",
           key_steps: [...],
           formula_used: "...",
           common_mistakes: [...],
           display_latex: "...",   ← technical track only
           correct_answer: "...",
           subject: "...",
           is_confident: float 0.0-1.0
         }
         Store: Redis model_answer:{session_id}:{q_hash}, TTL=1800s
                Gemini Cache Layer 3 created from MSM
         Set:   attempt_count = 1 in Redis
         │
         ▼
[STEP 4] CONFIDENCE CHECK
         ≥ 0.85  → proceed
         0.60-0.84 → retry Gemini Flash once
         < 0.60  → escalate to Gemini 2.5 Pro
         │
         ▼
[STEP 5] GENERATE TURN 1 NUDGE (~150-300ms, uses MSM cache)
         Model:  Gemini Flash (Layer 1+2+3 cached)
         Level:  NUDGE (point out flaw, NO formulas/steps/values)
         Format: exam_track == technical → LaTeX in display
                 exam_track == conceptual → plain text only
         Output: {
           is_confident: float,
           query_type: "...",
           voice_output: "spoken nudge",
           tft_display: {kind, content}
         }
         │
         ▼
[STEP 6] VALIDATE
         Strip markdown wrappers
         Check LaTeX syntax if technical track
         Check voice: no symbols, ≤4 sentences, no LaTeX
         Check TFT: ≤4 lines, ≤200 chars for text kind
         │
         ▼
[STEP 7] STREAM TO ESP32
         AUDIO_OUT (0x10): Cartesia TTS → PCM 24kHz
         TFT_CLEAR (0x22): clear display
         TFT_FRAME (0x20) or TFT_TEXT (0x21): display content
         STATE (0x30): thinking → speaking → idle
         │
         ▼
[ASYNC — off hot path]
         Write turn to Postgres
         Upload audio.wav + image.jpg to R2 (Turn 1 only)
         Embed turn → pgvector

TOTAL LATENCY (Turn 1):
  Speech-end → speaker start: ~1.2-1.8s ✅
```

---

## 2. Turns 2+ — Socratic Dialogue Phase

```
Student speaks follow-up
         │
         ├── Camera: STAYS OFF (no image capture)
         └── Stream AUDIO_CHUNK → AUDIO_END

BACKEND — TURN 2+ PIPELINE:
         │
         ▼
[STEP 1] TRANSCRIBE audio → text (~100ms, Deepgram/Groq Whisper)
         │
         ▼
[STEP 2] FETCH MSM from Redis (~1ms cache hit)
         key: model_answer:{session_id}:{q_hash}
         Increment: attempt_count++
         │
         ▼
[STEP 3] NUDGE DECISION (pure logic, 0 API calls)
         attempt_count == 2 → TACTICAL HINT
         attempt_count >= 3 → FULL RESOLUTION
         query_type in [validation, mistake_id] → DIRECT
         (override matrix from MASTER_PLAN Section 6)
         │
         ▼
[STEP 4] CALL Groq Llama 3.3 70B (~150-300ms)
         Input:  MSM text + student transcript + attempt_count
                 + conversation history (last 3 turns from Redis)
                 + nudge_level instruction
         NO image. NO audio bytes. Text only.
         Output: {is_confident, query_type, voice_output, tft_display}
         │
         ▼
[STEP 5] CONFIDENCE CHECK (float)
         < 0.60 → escalate to Gemini 2.5 Pro (text-only call)
         │
         ▼
[STEP 6] VALIDATE + STREAM TO ESP32
         Same as Turn 1 Step 6+7

TOTAL LATENCY (Turn 2+):
  Speech-end → speaker start: ~400-600ms ✅ (vs 1.2-1.8s Turn 1)
```

---

## 3. Gemini Context Cache Lifecycle

```
APP STARTUP
  └── Create Layer 1 (Global: base system + exam rules)
      TTL: 3600s | Store name in Redis: gemini:global_cache
      Refresh at 50min mark

STUDENT SESSION START
  └── Create Layer 2 (Student lean profile)
      TTL: 1800s | Store: gemini:student_cache:{session_id}

TURN 1 — NEW QUESTION
  └── Generate MSM → store in Redis
  └── Create Layer 3 (MSM content)
      TTL: 1800s | Store: gemini:model_answer_cache:{s}:{q_hash}

NOTE: Layers 2+3 used for Turn 1 only.
      Turns 2+ use Groq (not Gemini) → caches not consumed.
      Savings stack only on Turn 1 calls = still significant.

GROUNDING ACTIVE (UPSC/SSC current affairs):
  └── Use Layer 1 only + Google Search tool
  └── Cannot combine full cache stack with grounding
```

---

## 4. Model Routing Decision Tree

```
QUERY ARRIVES
     │
     ├── Is this Turn 1 (new question)?
     │     │
     │     ├── needs_grounding?
     │     │     YES → Gemini Flash + Google Search + Layer 1 cache
     │     │     NO  → Gemini Flash + Layer 1 + Layer 2 + Layer 3 cache
     │     │
     │     └── is_confident < 0.60?
     │           YES → escalate to Gemini 2.5 Pro
     │
     └── Is this Turn 2+?
           │
           └── Groq Llama 3.3 70B (text-only, MSM from Redis)
                 │
                 └── is_confident < 0.60?
                       YES → escalate to Gemini 2.5 Pro (text-only)
```

---

## 5. Two-Track Output Format

### Technical Track (JEE / GATE / NEET)
```
voice_output rules:
  - Speak math in words: "negative b plus or minus the square root of b squared minus 4ac, all over 2a"
  - 1-4 conversational sentences
  - No symbols, no LaTeX, no markdown

tft_display rules:
  - kind = "latex" for all equations
  - Use $$ ... $$ delimiters (centered display)
  - Max 4 lines on 320×240 screen
  - No verbose text definitions alongside math
```

### Conceptual Track (UPSC / CAT / SSC)
```
voice_output rules:
  - Same as technical: conversational, 1-4 sentences

tft_display rules:
  - kind = "text" ALWAYS — strictly NO LaTeX
  - Bullet points for cause-effect, pros/cons
  - Logical structuring, scannable
  - Max 200 characters
  - 4 lines max
```

---

## 6. ESP32 Binary Frame Protocol

```
Wire format: [1 byte type][3 bytes length][payload]

ESP32 → Backend:
  0x01  IMAGE_JPEG    raw JPEG bytes (Turn 1 only)
  0x02  AUDIO_CHUNK   int16 PCM 16kHz mono, 320 samples = 640 bytes
  0x03  AUDIO_END     empty — end of speech
  0x04  CANCEL        empty — student cancelled
  0xF0  PING          empty — heartbeat every 10s

Backend → ESP32:
  0x10  AUDIO_OUT     int16 PCM 24kHz mono (TTS stream)
  0x11  AUDIO_OUT_END empty — TTS done
  0x20  TFT_FRAME     [u16 W][u16 H][u8 nFrames][u8 rsv][RGB565 bytes]
  0x21  TFT_TEXT      UTF-8 string ≤200 chars
  0x22  TFT_CLEAR     empty — clear display
  0x30  STATE         0=idle 1=listening 2=thinking 3=speaking 4=escalating
  0xF1  PONG          empty

LED per STATE:
  idle       → cyan breathing
  listening  → white solid
  thinking   → orange breathing
  speaking   → green pulse
  escalating → yellow pulse
```

---

## 7. Full End-to-End System Diagram

```
[Student wakes device]
│
├──► ESP32: Camera grabs JPEG snapshot
├──► ESP32: Streams binary JPEG over WebSocket
│
[Student speaks]
│
├──► ESP32: Streams AUDIO_CHUNK frames
├──► Server: Buffers image + audio simultaneously
│
[Student stops — VAD EOS]
│
├── NEW question (Turn 1)?
│   ├── Gemini 2.5 Flash (image + audio)
│   ├── Generate MSM → Redis cache
│   ├── Gemini Context Cache Layers 1+2+3
│   ├── Set attempt_count = 1
│   ├── Camera OFF for rest of session
│   └── Send NUDGE → Validate → Device
│
└── ONGOING (Turn 2+)?
    ├── Transcribe voice → text
    ├── Fetch MSM from Redis
    ├── attempt_count++
    ├── Groq Llama 3.3 70B (text-only, 150-300ms)
    └── Send HINT/FULL → Validate → Device

[FastAPI Validation Layer]
│
├── is_confident (float) check
│   ├── ≥ 0.85 → strip markdown, format payload
│   └── < 0.60 → route to Gemini 2.5 Pro fallback
│
└── Format check: LaTeX valid? Voice clean? Length ok?

[ESP32 Outputs]
├── Speaker: MAX98357A plays PCM stream
└── Display: ILI9341 renders LaTeX or text (320×240)
```

---

## 8. Validator Flow

```
RAW LLM RESPONSE
     │
[CHECK 1] is_confident < 0.60? → escalate to Pro
[CHECK 2] JSON wrapped in markdown? → strip ```json wrappers
[CHECK 3] voice has LaTeX/symbols ($, \\, **)?  → clean voice
[CHECK 4] voice > 4 sentences? → trim
[CHECK 5] tft_display text > 200 chars? → trim
[CHECK 6] tft_display > 4 lines? → trim
[CHECK 7] exam_track=technical but kind=text for equation? → flag (soft)
[CHECK 8] exam_track=conceptual but kind=latex? → convert to text
ALL PASS → send to ESP32
```

---

## 9. Session Lifecycle

```
DEVICE BOOT → WebSocket connect → JWT auth → session created
TURN 1     → Camera ON → MSM generated → Camera OFF → attempt_count=1
TURN 2     → Voice only → Groq → MSM from Redis → attempt_count=2
TURN 3+    → Same as Turn 2 → attempt_count++
NEW Q      → New question hash → full Turn 1 pipeline again
DISCONNECT → Session closed → Redis TTLs expire naturally
RECONNECT  → Same session if within 30min → else new session
```
