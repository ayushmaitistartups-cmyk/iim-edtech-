# Backend Phase 3 & 4 — Full Implementation Plan
<!-- Updated: 2026-05-26 — Based on complete codebase audit + changes/ design docs -->

> **Reference docs:** `changes/BACKEND_DESIGN.md`, `changes/04_BACKEND_IMPLEMENTATION.md`,
> `changes/01_MASTER_PLAN.md`, `changes/BACKEND_TODO.md`

---

## Current State Summary

After auditing every file in `lumos-backend/`, the backend is **structurally complete** but
running in a **simplified single-track mode**. Key gaps between the design spec and the
implementation are documented below.

### What's Already Built ✅

| Layer | Component | File | Status |
|---|---|---|---|
| Gateway | WebSocket `/lamp/ws` + binary frames | `app/routes/ws_lamp.py` | ✅ Working |
| Protocol | All 11 frame types (encode/decode) | `app/protocol.py` | ✅ Working |
| Session | Per-device state, turn buffering, cancel | `app/session.py` | ✅ Working |
| Auth | Device JWT + pairing + dev-mode bypass | `app/auth/` | ✅ Working |
| Orchestrator | Full turn pipeline: LLM → validate → TTS+TFT parallel | `app/services/orchestrator.py` | ✅ Working |
| LLM | Gemini Flash multimodal (audio+image) + streaming | `app/providers/llm_gemini.py` | ✅ Working |
| TTS | Cartesia Sonic streaming + MockTTS fallback | `app/providers/tts_cartesia.py` | ✅ Working |
| LaTeX | matplotlib mathtext renderer + self-test + chunked send | `app/providers/latex_renderer.py` | ✅ Working |
| Validator | Speech cleanup, LaTeX gate, sentence cap, confidence | `app/services/validator.py` | ✅ Working |
| Classifier | Heuristic text-based + Gemini fallback | `app/services/classifier.py` | ✅ Working |
| Short-term memory | Redis (or MemoryRedis) last-3-turns | `app/services/memory.py` | ✅ Working |
| Long-term memory | Vector memory with JSONL fallback | `app/storage/vector_memory.py` | ✅ Working |
| Persistence | Blob store (local/S3) + JSONL turns ledger | `app/services/persistence.py` | ✅ Working |
| Streaming TTS | Sentence-level parse from LLM stream | `app/services/streaming_parser.py` | ✅ Working |
| Tests | 66 pytest cases, all green | `tests/` | ✅ Passing |

---

## What's Missing — The Design Spec vs Reality

The `changes/04_BACKEND_IMPLEMENTATION.md` and `changes/01_MASTER_PLAN.md` describe
a significantly more advanced system than what's currently running. The following
features from the spec are **NOT yet implemented**:

### Phase 3 Gaps (Voice + Display — from Master Plan)

| Feature | Spec Location | Current State |
|---|---|---|
| **Two-Track TFT Formatter** | `04_BACKEND_IMPLEMENTATION §formatting/` | ❌ Missing. Orchestrator sends LaTeX or text based on LLM output, but there's no `track_router.py` that enforces strict technical vs conceptual formatting rules. |
| **Voice Cleaner** | `04_BACKEND_IMPLEMENTATION §formatting/voice_cleaner.py` | ⚠️ Partial. Validator strips markdown/`$math$` from speech, but no dedicated `voice_cleaner.py` that strips LaTeX symbols, math notation, and formats spoken math ("x squared" instead of "x^2"). |
| **TFT Constraint Enforcement** | `01_MASTER_PLAN §7` | ⚠️ Partial. Validator caps `TFT_TEXT` at 200 bytes but doesn't enforce the 4-line max or 320×240 layout rules described in the spec. |
| **Cartesia Voice Selection** | `BACKEND_TODO §7.2` | ❌ Missing. TTS uses a placeholder `voice_id`. No voice selection or voice cloning configuration. |

### Phase 4 Gaps (Accuracy Layer — from Master Plan)

| Feature | Spec Location | Current State |
|---|---|---|
| **BAO Framework (Base Answer Once)** | `01_MASTER_PLAN §4` | ❌ **Critical missing piece.** The current orchestrator treats every turn as independent. There is no Master Solution Model (MSM) generation on Turn 1, no MSM caching in Redis, and no cheap Turn 2+ path. Every follow-up re-runs full Gemini multimodal. |
| **Groq Llama 3.3 70B for Turn 2+** | `04_BACKEND_IMPLEMENTATION §3` | ❌ Missing. No `llm_groq.py` provider. All turns go through Gemini Flash. |
| **Nudge Logic** | `01_MASTER_PLAN §6` | ❌ Missing. No `nudge_logic.py`. The graded Socratic response system (NUDGE → TACTICAL HINT → FULL RESOLUTION) based on `attempt_count` is not implemented. |
| **Direct Answer Score Matrix** | `01_MASTER_PLAN §6` | ❌ Missing. No scoring system to override nudge level based on time spent, difficulty, student level, or cross-session mistakes. |
| **3-Layer Gemini Context Caching** | `01_MASTER_PLAN §3`, `04_BACKEND_IMPLEMENTATION §4` | ❌ Missing. No `cache_manager.py` implementation that uses Gemini's Context Caching API for 75% token cost reduction. Current `cache_manager.py` exists but is a render cache for LaTeX, not LLM context. |
| **Google Search Grounding** | `01_MASTER_PLAN §3` | ⚠️ Partial. The classifier sets `needs_grounding` and `llm_gemini.py` accepts `enable_grounding` param, but the actual Google Search tool wiring in the Gemini API call is not confirmed to be functional. |
| **Cross-Session Mistake Tracking (Rule B + C)** | `01_MASTER_PLAN §8` | ❌ Missing. No `question_attempts` table, no mistake-type aggregation, no "I've noticed you often..." injection. |
| **Camera OFF after Turn 1** | `01_MASTER_PLAN §4` | ❌ Missing. Backend doesn't signal the lamp to turn off camera after Turn 1. |
| **Question Hash Detection** | `04_BACKEND_IMPLEMENTATION §2` | ❌ Missing. No `detect_question_hash()` to distinguish new questions from follow-ups on the same question. |

---

## Implementation Plan — Phase 3 & 4 Build

### Phase 3A: Two-Track Formatter + Voice Cleaner

#### [NEW] `app/formatting/track_router.py`
- Receives `ClassificationResult.exam_track` and the raw `LlmReply`
- **Technical track (JEE/GATE/NEET):** Enforces `display.kind = "latex"` for any equation content. Validates LaTeX against the mathtext subset. Falls back to text on render failure.
- **Conceptual track (UPSC/CAT/SSC):** Forces `display.kind = "text"` always. Strips any accidental LaTeX from display content. Reformats into bullet-point structure with cause-effect.
- **TFT constraint enforcement:** Ensures text content fits 4 lines × ~50 chars on the 320×240 TFT screen.
- **Library:** None new. Pure Python string processing.

#### [NEW] `app/formatting/voice_cleaner.py`
- Runs on `LlmReply.speech` before TTS
- Strips leftover `$...$`, `\frac{}{}`, `\sqrt{}` from speech
- Converts common LaTeX to spoken form: `x^2` → "x squared", `\pi` → "pi", `\frac{1}{2}` → "one half"
- Enforces `MAX_VOICE_SENTENCES = 4` and `MAX_VOICE_CHARS = 350`
- **Library:** `re` (stdlib). No external deps.

#### [MODIFY] `app/services/orchestrator.py`
- Wire `track_router.route()` after validator
- Wire `voice_cleaner.clean()` before TTS dispatch
- **Algorithm:** Track routing is a pure if/else on `exam_track` — zero API calls.

### Phase 3B: Cartesia Voice Configuration

#### [MODIFY] `app/providers/tts_cartesia.py`
- Add configurable `CARTESIA_VOICE_ID` env var
- Add voice selection logic (warm/patient voice for tutoring)
- **Library:** `cartesia` (already in requirements.txt)

---

### Phase 4A: BAO Framework (The Core Architecture Change)

This is the single most impactful change. It transforms the backend from "every turn is a fresh Gemini call" to "pay for one heavy multimodal call, then cheap text follow-ups."

#### [NEW] `app/services/bao.py` (Base Answer Once)
- **Turn 1 (Discovery Phase):**
  1. Receive audio + image from lamp
  2. Call Gemini Flash multimodal to generate the **Master Solution Model (MSM)** — a complete solution with steps, key equations, common mistakes
  3. Cache MSM in Redis: `model_answer:{session_id}:{question_hash}`, TTL=1800s
  4. Extract initial NUDGE from MSM (first hint, no direct answer)
  5. Set `attempt_count = 1`
  6. Signal lamp to turn camera OFF (no more image uploads needed)
- **Turn 2+ (Socratic Dialogue Phase):**
  1. Receive audio only (no image)
  2. Fetch MSM from Redis
  3. Increment `attempt_count`
  4. Determine nudge level via `nudge_logic.py`
  5. Call Groq Llama 3.3 70B with MSM + transcript + nudge level
  6. Return response in ~150-300ms instead of ~700-1500ms
- **Algorithm:** Question hash detection using Levenshtein distance on consecutive transcripts. If similarity > 80% to last question → same question (Turn 2+). Otherwise → new question (Turn 1).
- **Library:** `python-Levenshtein` (already in the project)

#### [NEW] `app/services/nudge_logic.py`
- Pure Python, zero API calls
- Implements the graded Socratic response system:
  ```
  attempt_count == 1  →  NUDGE (point out flaw, NO formulas)
  attempt_count == 2  →  TACTICAL HINT (key formula/identity)
  attempt_count >= 3  →  FULL RESOLUTION (complete step-by-step)
  ```
- Override rules:
  - `difficulty=hard` + `student_level=beginner` → start at HINT
  - `time_spent > 600s` → start at HINT
  - `query_type` in `[validation, mistake_identification]` → always DIRECT
- Direct Answer Score Matrix (additive scoring, threshold ≥ 3):
  - `attempt_count ≥ 3` → +3
  - `time_on_question > 900s` → +2
  - `difficulty=hard + level=beginner` → +2
  - `query_type = validation/mistake_id` → +5
  - `same_mistake_type ≥ 3 cross-session` → +2
- **Library:** None. Pure Python logic.

#### [NEW] `app/providers/llm_groq.py`
- Groq Llama 3.3 70B async client for Turn 2+ responses
- Text-only (no audio, no image) — receives MSM + transcript + conversation history
- JSON mode: `response_format={"type": "json_object"}`
- Same `LlmReply` schema output as Gemini
- 150-300ms TTFT (vs 400-700ms for Gemini Flash)
- **Library:** `groq` (new dependency, add to `requirements.txt`)
- **Config:** `GROQ_API_KEY` env var, `GROQ_MODEL = "llama-3.3-70b-versatile"`

#### [MODIFY] `app/services/orchestrator.py`
- Replace the current single-path `run_turn()` with the BAO two-phase logic
- Turn 1: Gemini Flash multimodal → MSM → Redis → NUDGE → camera OFF signal
- Turn 2+: Redis MSM fetch → Groq text-only → nudge-gated response
- Confidence escalation stays (Gemini Pro fallback on low confidence)

### Phase 4B: Analytics Database & Mistake Tracking

#### [NEW] `app/storage/analytics_repo.py`
- Create a dedicated database schema (PostgreSQL) for user analytics
- Track **Questions Solved**: Total number of questions solved per subject/topic
- Track **Time Spent**: Time spent per question and aggregated time spent per topic/subject
- Track **Mistakes & Weaknesses**:
  - Total mistakes made
  - Most repeated mistake types
  - Concepts with the lowest proficiency (weak concepts)
- Track **Subject Proficiency**: A computed score based on attempts, time, and mistake frequency
- Expose endpoints or functions to retrieve these analytics for the user profile

#### [NEW] `app/storage/mistake_tracker.py`
- Track `question_attempts` per user: question hash, mistake type, attempt count
- Integrate with `analytics_repo` to persist mistake patterns
- **Rule B:** If same mistake TYPE appears in 3+ different questions across sessions → inject reminder: "I've noticed you often [mistake type]. Worth reviewing."
- **Rule C:** If 5+ mistakes in same concept across sessions → periodic revision reminder
- **Library:** None new. Postgres + asyncpg.

#### [NEW] `app/services/topic_pruner.py`
- Detect active topic from classifier output
- Query mistake tracker for mistakes on THAT topic only (max 3)
- Inject as context: "Student has struggled twice with [concept]"
- Never dump full history — prevents token bloat
- **Library:** None new.

### Phase 4C: Gemini Context Caching (Cost Optimization)

#### [NEW] `app/providers/gemini_cache.py`
- 3-layer Gemini Context Caching per `04_BACKEND_IMPLEMENTATION §4`:
  - **Layer 1 (Global):** System prompt + LaTeX rules, shared across all sessions. TTL=3600s.
  - **Layer 2 (Student):** Student profile + topic history. TTL=1800s per session.
  - **Layer 3 (MSM):** Cached MSM for the active question. TTL=1800s per question.
- Uses Gemini's `CachedContent` API to reduce input token costs by ~75%
- **Library:** `google-genai` (already installed)
- **Config:** `GEMINI_L1_TTL`, `GEMINI_L2_TTL`, `GEMINI_L3_TTL` env vars

---

## Libraries & Algorithms Summary

| Library | Purpose | New? |
|---|---|---|
| `groq` | Llama 3.3 70B for cheap Turn 2+ responses | ✅ New |
| `google-genai` | Gemini Flash/Pro + Context Caching | Already installed |
| `cartesia` | TTS streaming | Already installed |
| `python-Levenshtein` | Question hash similarity detection | Already in project |
| `redis` / `MemoryRedis` | MSM caching, attempt counters, session state | Already installed |

| Algorithm | Location | Purpose |
|---|---|---|
| BAO (Base Answer Once) | `services/bao.py` | One heavy multimodal call, then cheap text follow-ups |
| Nudge Escalation | `services/nudge_logic.py` | NUDGE → HINT → FULL based on attempt count |
| Direct Answer Score Matrix | `services/nudge_logic.py` | Additive scoring for when to give direct answers |
| Question Hash (Levenshtein) | `services/bao.py` | Detect same-question follow-ups vs new questions |
| Track Routing | `formatting/track_router.py` | Technical LaTeX vs Conceptual text formatting |
| Cross-Session Mistake Frequency | `storage/mistake_tracker.py` | Rule B + Rule C reminders |
| Student Analytics Aggregation | `storage/analytics_repo.py` | Track questions solved, time spent, weak concepts, and proficiency |
| 3-Layer Context Caching | `providers/gemini_cache.py` | 75% token cost reduction |

---

## Build Order

```
Day 1: Phase 3A — Track router + voice cleaner + wire into orchestrator
Day 2: Phase 4A Part 1 — nudge_logic.py + bao.py skeleton + Redis MSM caching
Day 3: Phase 4A Part 2 — llm_groq.py + Turn 2+ path + BAO orchestrator rewrite
Day 4: Phase 4B — Analytics Database schema + mistake tracker + topic pruner
Day 5: Phase 4C — Gemini context caching (3 layers)
Day 6: Integration testing — full mock_lamp round-trip with Turn 1 + Turn 2+ flow
Day 7: Latency measurement + tuning — target <1.8s Turn 1, <800ms Turn 2+
```

---

## Verification Plan

1. **Unit tests:** Add tests for each new module (nudge_logic, bao, track_router, voice_cleaner, llm_groq, mistake_tracker, gemini_cache)
2. **Integration test:** `mock_lamp.py` sends Turn 1 (image+audio) → receives NUDGE response. Then sends Turn 2 (audio only) → receives HINT response from Groq in <500ms.
3. **Cost verification:** Log input/output tokens per turn. Verify Turn 2+ costs are ~10x cheaper than Turn 1.
4. **Latency verification:** Measure TTFT and total_ms for both paths. Target: Turn 1 < 1.8s, Turn 2+ < 800ms.
