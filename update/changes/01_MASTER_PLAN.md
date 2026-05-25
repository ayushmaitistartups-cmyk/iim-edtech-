# LUMOS / ClarityAI — Master Plan v4
> Merged: Samiul backend design + Ayush criticisms + Gemini caching + Groq routing
> Version: 4.0 | Status: Pre-build

---

## 1. Product Vision

A physical desk lamp (ESP32-based) that acts as a 24/7 Socratic AI tutor.
Student points it at their notebook/textbook, asks a question via voice,
gets a guided response via speaker + 4.5" TFT display.

**Target users:** JEE / UPSC / CAT / GATE / SSC aspirants
**Core promise:** Sub-2-second response. Guides, never just gives. Adapts to each student.

---

## 2. Hardware Stack (Locked)

| Component | Part | Purpose |
|-----------|------|---------|
| MCU | ESP32-S3 (240MHz dual-core) | Main controller |
| Mic | INMP441 | 16kHz mono PCM voice input |
| Camera | OV5640 | JPEG capture (Turn 1 only) |
| Display | ILI9341 TFT 4.5" (320×240px) | Visual output |
| Speaker | MAX98357A I2S Class-D | 24kHz mono PCM audio output |
| Wake word | Edge Impulse model | "Hey Lumos" detection |

**ESP32 = terminal only. All compute = cloud.**
**Camera = ON for Turn 1 only. OFF for all follow-up turns.**

---

## 3. Software / API Stack (Locked)

| Layer | Choice | Reason |
|-------|--------|--------|
| Turn 1 LLM | Gemini 2.5 Flash | Native audio+image, generates MSM |
| Turn 2+ LLM | Groq Llama 3.3 70B | Text-only, 150-300ms, cheapest fast |
| Hard fallback | Gemini 2.5 Pro | Low confidence escalation only |
| Context caching | Gemini Context Cache (3 layers) | 75% token cost reduction on Turn 1 |
| Grounding | Google Search Grounding | UPSC/SSC current affairs only |
| TTS | Cartesia Sonic | ~90ms TTFT, streaming |
| Backend | FastAPI + asyncio | WebSocket, async |
| Session cache | Redis | MSM, attempt counters, session state |
| Database | Postgres + pgvector | Turns, memory embeddings |
| Blob storage | Cloudflare R2 | Audio + image blobs |

**NOT using:** Claude (no audio), Deepseek (data sovereignty concern), self-hosted LLM

---

## 4. The BAO (Base Answer Once) Framework — Core Architecture

### The Two Phases

**TURN 1 — Discovery Phase (heavy, multimodal)**
- Camera captures workspace JPEG
- Gemini 2.5 Flash processes image + audio together
- Generates complete Master Solution Model (MSM)
- MSM cached in Redis (TTL 30 min) + Gemini Layer 3 cache
- Sends NUDGE (attempt_count = 1) to device
- Camera turns OFF after this turn

**TURNS 2+ — Socratic Dialogue Phase (light, text-only)**
- Camera completely OFF — no image uploads
- Student's follow-up voice → transcribed to text
- Groq Llama 3.3 70B fetches MSM from Redis
- Generates HINT or FULL_ANSWER in 150-300ms
- No re-analysis of image. No re-generating solution.

### Why This Works
- Pay for heavy multimodal call ONCE per question
- All follow-ups = cheap text call (~$0.0001 each)
- LLM always reads verified MSM → cannot hallucinate steps
- Camera off = saves bandwidth + ESP32 processing

---

## 5. Query Type Taxonomy (6 types — Ayush's system)

> "Query Type" not "Doubt Type"

| # | Query Type | Student's Situation | Pedagogy |
|---|-----------|-------------------|---------|
| 1 | `conceptual_doubt` | Doesn't understand theory | Real-world analogies, no math |
| 2 | `solving_support_concept` | Knows theory, can't apply it | Guide FBD / boundary equations |
| 3 | `solving_support_formula` | Knows concept, forgot formula | Remind equation structure |
| 4 | `solving_support_calc` | Has formula, stuck in algebra/steps | Hint substitution or factoring |
| 5 | `validation` | Solved it, wants confirmation | Cross-ref with MSM, confirm/deny |
| 6 | `mistake_identification` | Wrong answer, wants to know why | Find exact wrong step vs MSM |

Types 5 and 6 → always DIRECT response. Never nudge.

---

## 6. Graded Socratic Response System

```
attempt_count == 1  →  NUDGE        — point out conceptual flaw, NO formulas/steps/values
attempt_count == 2  →  TACTICAL HINT — give key formula, identity, or algebraic setup
attempt_count >= 3  →  FULL RESOLUTION — complete step-by-step in LaTeX
```

**Override rules (skip to higher level):**
- `difficulty=hard` + `student_topic_level=beginner` → start at HINT not NUDGE
- `time_spent > 600s` on attempt 1 → start at HINT
- `query_type` in [validation, mistake_identification] → always DIRECT

**Direct Answer Score Matrix (additional override):**

| Condition | Score |
|-----------|-------|
| attempt_count ≥ 3 | +3 |
| time_on_question > 900s | +2 |
| difficulty=hard + level=beginner | +2 |
| query_type = validation or mistake_id | +5 |
| same_mistake_type ≥ 3 cross-session | +2 |
| **Threshold → FULL_RESOLUTION** | **≥ 3** |

---

## 7. Exam Track Routing (NEW — from PDF review)

Two format tracks based on exam type:

### Technical Track: JEE / GATE / NEET
- LaTeX required for all math/physics/chemistry
- Free-body diagrams described in display
- Strict derivations, no handwaving
- `tft_display.kind = "latex"` always for equations

### Conceptual Track: UPSC / CAT / SSC
- Strictly NO LaTeX
- Plain text, bullet points, cause-effect structure
- Logical structuring, pros/cons, background context
- `tft_display.kind = "text"` always

```python
def get_exam_track(exam_type: str) -> str:
    technical = ["jee", "gate", "neet"]
    conceptual = ["upsc", "cat", "ssc"]
    return "technical" if exam_type in technical else "conceptual"
```

---

## 8. Long-Term Tracking Rules

**Rule A — In-session repeat (same question):**
`attempt_count` in Redis per session per question hash → drives nudge escalation

**Rule B — Cross-session mistake patterns:**
Same TYPE of error in 3+ different questions across sessions
→ Inject reminder: "I've noticed you often [mistake type]. Worth reviewing."

**Rule C — Revision reminder:**
5+ mistakes in same concept across sessions
→ Periodic reminder to revise that concept

**Context Injection (topic-specific pruning):**
- Detect active topic from classifier output
- Query Postgres for mistakes on THAT topic only (max 3)
- Inject as: `"Student has struggled twice with base-change theorem of logarithms"`
- Never dump full history — token bloat + model confusion

---

## 9. Build Phases

### Phase 0 — Foundation (Day 1)
- [ ] FastAPI + WebSocket endpoint
- [ ] Binary frame protocol (ESP32 ↔ Backend)
- [ ] Device JWT auth
- [ ] Echo audio + image back to verify socket

### Phase 1 — Turn 1 Core (Day 2)
- [ ] Gemini 2.5 Flash multimodal call
- [ ] MSM generation + Redis cache
- [ ] attempt_count = 1, send NUDGE
- [ ] Gemini Context Caching Layer 1 + 2

### Phase 2 — Turn 2+ Socratic Path (Day 3)
- [ ] Groq Llama 3.3 70B connector
- [ ] Redis MSM fetch + attempt_count increment
- [ ] Camera OFF logic after Turn 1
- [ ] HINT / FULL_RESOLUTION routing

### Phase 3 — Voice + Display (Day 4)
- [ ] Cartesia Sonic TTS streaming → AUDIO_OUT frames
- [ ] Two-track TFT formatter (LaTeX vs plain text)
- [ ] 320×240 constraint enforcement (4 lines max)

### Phase 4 — Accuracy Layer (Day 5)
- [ ] is_confident float check + escalation to Gemini Pro
- [ ] Output validator (LaTeX valid, length, voice clean)
- [ ] Google Search Grounding for UPSC/SSC current affairs

### Phase 5 — Storage + Memory (Day 6)
- [ ] Postgres schema + async logging
- [ ] R2 blob uploads (audio + image, Turn 1 only)
- [ ] Topic-specific context pruning from Postgres

### Phase 6 — Latency Tuning (Day 7)
- [ ] Image upload on wake word (not EOS)
- [ ] Sentence-level TTS handoff
- [ ] HTTP/2 connection pooling
- [ ] Measure TTFW: target <1.8s

### Post-MVP
- [ ] Cross-session mistake tracking (Rule B + C)
- [ ] pgvector long-term memory
- [ ] RAG pipeline (NCERT/PYQ verified answers)
- [ ] ClarityAI web client (parallel browser pipeline)
- [ ] Analytics dashboard

---

## 10. Open Questions

| Question | Owner |
|----------|-------|
| Single-user or multi-user per device? | Product |
| Topic-level init for new student? | Backend |
| Cross-session attempt count: reset daily or lifetime? | Product |
| TFT pixel budget for LaTeX rendering at 320×240? | Hardware |
| Groq API key and rate limits acceptable? | Backend |
| Deepseek acceptable? (data in China) | Product |
