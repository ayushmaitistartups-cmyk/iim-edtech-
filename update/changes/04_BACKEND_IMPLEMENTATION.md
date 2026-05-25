# LUMOS — Backend Implementation Plan v4
> Updated: Groq connector, two-track formatter, BAO architecture

---

## 1. Repo Structure

```
lumos-backend/
├── main.py
├── config.py
├── requirements.txt
│
├── gateway/
│   ├── websocket.py          # FastAPI WS, frame routing
│   ├── auth.py               # Device JWT verification
│   └── session.py            # Session create/update/close
│
├── orchestrator/
│   ├── turn_handler.py       # MOST CRITICAL FILE — BAO logic
│   ├── nudge_logic.py        # Pure Python, 0 API calls
│   ├── validator.py          # Output validation + track enforcement
│   └── reminder_engine.py   # Rule B + Rule C
│
├── providers/
│   ├── llm_gemini.py         # Turn 1: Gemini Flash + Pro
│   ├── llm_groq.py           # Turn 2+: Groq Llama 3.3 70B
│   ├── cache_manager.py      # 3-layer Gemini cache
│   ├── tts_cartesia.py       # Cartesia Sonic streaming
│   └── grounding.py         # Google Search grounding
│
├── classifiers/
│   └── query_classifier.py   # Runs first, cheap
│
├── formatting/
│   ├── track_router.py       # technical vs conceptual split
│   ├── tft_formatter.py      # TFT frame builder
│   ├── latex_validator.py    # LaTeX check + clean
│   └── voice_cleaner.py     # Strip symbols from voice
│
├── storage/
│   ├── db.py                 # SQLAlchemy + asyncpg
│   ├── redis_client.py       # Redis helpers
│   ├── blobs.py              # R2 client
│   └── memory.py             # pgvector helpers
│
├── workers/                  # ASYNC ONLY — never in hot path
│   ├── embed_turn.py
│   ├── upload_blobs.py
│   └── update_mistake_tracking.py
│
├── schemas/
│   ├── frames.py             # Binary frame types
│   ├── llm_response.py       # Pydantic models
│   └── db_models.py          # SQLAlchemy models
│
└── prompts/
    ├── turn1_system.py       # Turn 1 Gemini prompt
    ├── turn2_system.py       # Turn 2+ Groq prompt
    ├── classifier.py         # Classifier prompt
    ├── technical_module.py   # JEE/GATE/NEET rules
    └── conceptual_module.py  # UPSC/CAT/SSC rules
```

---

## 2. turn_handler.py — Core Logic

```python
async def handle_turn(session_id, student_profile, audio_stream, image_ref=None):

    # Detect if Turn 1 (new question) or Turn 2+ (follow-up)
    question_hash = await detect_question_hash(audio_stream, session_id)
    msm = await redis.get(f"model_answer:{session_id}:{question_hash}")
    attempt_count = int(await redis.get(f"attempt:{session_id}:{question_hash}") or 0)

    if not msm:
        # ── TURN 1: DISCOVERY PHASE ──────────────────────────────
        # Step 1: Classify
        classification = await classify(audio_stream, image_ref)

        # Step 2: Topic context pruning
        topic_history = await get_topic_history(
            student_profile["user_id"],
            classification["subject"],
            max_mistakes=3
        )

        # Step 3: Generate MSM (Gemini Flash, multimodal)
        msm_result = await llm_gemini.generate_msm(
            image_ref=image_ref,
            audio_stream=audio_stream,
            classification=classification,
            topic_history=topic_history,
            student_profile=student_profile,
            use_grounding=classification["needs_grounding"]
        )

        # Step 4: Confidence check
        if msm_result["is_confident"] < 0.60:
            msm_result = await llm_gemini.generate_msm_pro(...)  # escalate

        # Cache MSM
        await redis.set(f"model_answer:{session_id}:{question_hash}",
                        json.dumps(msm_result), ex=1800)
        attempt_count = 1
        await redis.set(f"attempt:{session_id}:{question_hash}", 1, ex=1800)

        # Build Turn 1 nudge from MSM (already in msm_result)
        response = extract_nudge_from_msm(msm_result)

    else:
        # ── TURNS 2+: SOCRATIC DIALOGUE PHASE ───────────────────
        attempt_count += 1
        await redis.set(f"attempt:{session_id}:{question_hash}", attempt_count, ex=1800)

        # Determine nudge level
        nudge_level = nudge_logic.determine(
            attempt_count,
            json.loads(msm)["difficulty_level"],
            student_profile.get("topic_levels", {}).get(classification["subject"], "intermediate"),
            await get_time_spent(session_id, question_hash),
            classification["query_type"]
        )

        # Call Groq (text-only, 150-300ms)
        response = await llm_groq.generate_response(
            transcript=await transcribe(audio_stream),
            msm=json.loads(msm),
            attempt_count=attempt_count,
            nudge_level=nudge_level,
            conversation_history=await get_last_3_turns(session_id),
            exam_track=classification["exam_track"]
        )

        # Confidence escalation to Gemini Pro if needed
        if response["is_confident"] < 0.60:
            response = await llm_gemini.generate_response_pro_text(...)

    # Validate + format
    response = validator.validate(response, classification["exam_track"])

    # Stream to ESP32
    await stream_to_device(session_id, response)

    # Async workers
    asyncio.create_task(post_turn_persist(session_id, response, attempt_count))
```

---

## 3. providers/llm_groq.py

```python
import groq

client = groq.AsyncGroq(api_key=GROQ_API_KEY)

async def generate_response(transcript, msm, attempt_count,
                             nudge_level, conversation_history, exam_track):

    system = TURN2_SYSTEM_PROMPT
    if exam_track == "technical":
        system += TECHNICAL_MODULE
    else:
        system += CONCEPTUAL_MODULE

    messages = [
        {"role": "system", "content": system},
        # Inject MSM as ground truth
        {"role": "system", "content": f"MASTER SOLUTION MODEL:\n{json.dumps(msm)}"},
        # Prior conversation
        *conversation_history,
        # Current turn
        {"role": "user", "content": f"attempt_count: {attempt_count}\n"
                                     f"required_level: {nudge_level}\n"
                                     f"student_query: {transcript}"}
    ]

    response = await client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        max_tokens=300,
        temperature=0.3,
        response_format={"type": "json_object"}
    )

    return json.loads(response.choices[0].message.content)
```

---

## 4. Config

```python
# LLM
GEMINI_API_KEY    = env("GEMINI_API_KEY")
GROQ_API_KEY      = env("GROQ_API_KEY")

# Models
GEMINI_FLASH      = "models/gemini-2.5-flash"
GEMINI_PRO        = "models/gemini-2.5-pro"
GROQ_MODEL        = "llama-3.3-70b-versatile"

# TTS
CARTESIA_API_KEY  = env("CARTESIA_API_KEY")

# Storage
REDIS_URL         = env("REDIS_URL", default="redis://localhost:6379")
DATABASE_URL      = env("DATABASE_URL")
R2_BUCKET         = env("R2_BUCKET", default="lumos-blobs")

# Thresholds
CONFIDENCE_ESCALATE  = 0.60
CONFIDENCE_OK        = 0.85
NUDGE_TIME_SEC       = 600    # skip to HINT if student spent >10min
DIRECT_SCORE_THRESHOLD = 3

# Cache TTLs (seconds)
GEMINI_L1_TTL     = 3600
GEMINI_L2_TTL     = 1800
GEMINI_L3_TTL     = 1800
REDIS_MSM_TTL     = 1800

# Output limits
MAX_VOICE_SENTENCES = 4
MAX_TFT_CHARS       = 200
MAX_TFT_LINES       = 4
MAX_OUTPUT_TOKENS   = 300
```

---

## 5. Postgres Schema

```sql
CREATE TABLE users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email      TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE devices (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES users(id),
    hw_serial  TEXT UNIQUE,
    jwt_hash   TEXT,
    last_seen  TIMESTAMPTZ
);

CREATE TABLE sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id  UUID REFERENCES devices(id),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at   TIMESTAMPTZ
);

CREATE TABLE turns (
    id               UUID PRIMARY KEY,   -- uuidv7
    session_id       UUID REFERENCES sessions(id),
    user_id          UUID,
    turn_number      INT,                -- 1 = discovery, 2+ = socratic
    asked_at         TIMESTAMPTZ DEFAULT NOW(),
    query_type       TEXT,
    difficulty       TEXT,
    exam_track       TEXT,               -- technical | conceptual
    attempt_count    INT DEFAULT 1,
    nudge_level      TEXT,
    model_used       TEXT,               -- gemini-flash | groq-llama | gemini-pro
    audio_url        TEXT,               -- Turn 1 only
    image_url        TEXT,               -- Turn 1 only
    transcript       TEXT,
    response_voice   TEXT,
    display_kind     TEXT,
    display_content  TEXT,
    is_confident     NUMERIC(4,3),
    escalated        BOOLEAN DEFAULT FALSE,
    validator_flags  TEXT[],
    ttft_ms          INT,
    total_ms         INT,
    cost_usd         NUMERIC(10,6)
);

CREATE TABLE question_attempts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID REFERENCES users(id),
    question_hash  TEXT,
    mistake_type   TEXT,
    attempt_count  INT DEFAULT 1,
    first_asked_at TIMESTAMPTZ DEFAULT NOW(),
    last_asked_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE memories (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES users(id),
    kind       TEXT,
    content    TEXT,
    embedding  VECTOR(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON memories USING ivfflat (embedding vector_cosine_ops);
```

---

## 6. Redis Keys

```
# MSM per question
model_answer:{session_id}:{q_hash}    → MSM JSON, TTL=1800
attempt:{session_id}:{q_hash}         → int, TTL=1800
time_spent:{session_id}:{q_hash}      → int seconds, TTL=1800

# Session state
session:{session_id}:profile          → lean student profile JSON
session:{session_id}:last_3_turns     → list of last 3 turn summaries
session:{session_id}:image:{turn_id}  → image ref (Turn 1 only)
session:{session_id}:camera_off       → bool, set after Turn 1

# Gemini cache names
gemini:global_cache                   → {name, expires_at}, TTL=3500
gemini:student_cache:{session_id}     → {name}, TTL=1700
gemini:model_answer_cache:{s}:{q}     → {name}, TTL=1700
```

---

## 7. Day-by-Day Build Order

```
Day 1: WebSocket + frame parser + JWT auth + echo test
Day 2: Turn 1 — Gemini Flash multimodal → MSM → Redis
Day 3: Turn 2+ — Groq Llama 3.3 70B → text-only socratic path
Day 4: TTS (Cartesia) + TFT two-track formatter → device output
Day 5: Confidence gate + Gemini Pro escalation + validator
Day 6: Gemini Context Caching (Layers 1+2+3) + topic pruning
Day 7: Latency tuning + end-to-end integration test on hardware
```

---

## 8. Don't Build Yet

- RAG pipeline
- Teacher dashboards
- Multi-user per device
- gRPC
- Kubernetes
- ClickHouse
- Self-hosted LLM/TTS
- Barge-in (user interrupts lamp mid-speech)
