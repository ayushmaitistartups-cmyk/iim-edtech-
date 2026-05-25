# LUMOS — Decisions, Cost & Quick Reference v4

---

## 1. All Decisions (Locked)

| Decision | Choice | Reason |
|----------|--------|--------|
| Turn 1 LLM | Gemini 2.5 Flash | Native audio+image, generates MSM |
| Turn 2+ LLM | Groq Llama 3.3 70B | Text-only, 150-300ms, cheap |
| Hard fallback | Gemini 2.5 Pro | Confidence < 0.60 escalation |
| Context caching | Gemini 3-layer cache | 75% reduction on Turn 1 tokens |
| Grounding | Google Search (UPSC/SSC only) | Current affairs accuracy |
| TTS | Cartesia Sonic | ~90ms TTFT, streaming |
| Backend | FastAPI + asyncio | WebSocket, fast to ship |
| Cache | Redis | MSM, attempt counters |
| DB | Postgres + pgvector | Relational + vector |
| Blobs | Cloudflare R2 | Free egress |
| Camera | ON Turn 1 only, OFF Turn 2+ | Bandwidth + latency |
| Exam formatting | Two tracks (technical / conceptual) | LaTeX vs plain text |
| TFT constraints | 320×240px, 4 lines, 200 chars | Hardware-grounded |
| Confidence | Float 0.0-1.0 (not boolean) | Retry zone 0.60-0.85 |
| Query taxonomy | 6 types (Ayush's system) | Precise classification |
| Student context | Topic-specific pruning (max 3) | No token bloat |
| Level | Per-topic, not overall | Accurate calibration |
| Claude | ❌ Not used | No audio input |
| Deepseek | ❌ Not used | Data in China |
| TurboQuant | ❌ Not applicable | API consumer, not model host |
| RAG | ❌ Post-MVP | Deferred |

---

## 2. Cost Model

### Per Call (Gemini 2.5 Flash)
| Token type | Cost |
|-----------|------|
| Normal input | $0.075 / 1M |
| Cached input | $0.01875 / 1M |
| Output | $0.30 / 1M |
| Cache storage | $1.00 / 1M / hour |
| Google Search grounding | ~$0.035 / 1000 queries |

### Per Call (Groq Llama 3.3 70B)
| Token type | Cost |
|-----------|------|
| Input | $0.59 / 1M |
| Output | $0.79 / 1M |
| Latency | 150-300ms |

### Per Turn Cost

```
TURN 1 — New question (Gemini Flash + 3-layer cache):
  Classifier:         ~$0.000039
  MSM generation:     ~$0.000195 (6000 cached + 300 new + 200 out)
  Turn 1 nudge:       ~$0.000188 (8000 cached + 100 new + 100 out)
  TOTAL TURN 1:       ~$0.000422

TURN 2+ — Follow-up (Groq Llama 3.3 70B, text-only):
  Input: ~3000 tokens (MSM + history + query) = $0.0018 / 1M × 3000
       = ~$0.0000054 wait that's too low
  Input: 3000 × $0.00059 / 1000 = ~$0.00177 per 1M... 
  Actually: 3000 tokens × ($0.59/1,000,000) = $0.00000177 per token × 3000 = ~$0.00177 / 1000
  = $0.59/1M × 0.003M = ~$0.00000177 × 3000 = ~$0.0018 ... let me recalculate

  Groq Llama 3.3 70B: $0.59/1M input, $0.79/1M output
  Input: 3000 tokens = 3000/1,000,000 × $0.59 = $0.00000177 ≈ $0.0018 ... 
  = 0.003 × $0.59 = $0.00177 ... 
  = $0.59 × 3 / 1000 = $0.00177 / 1000 = $0.00000177 × 3000

  Per turn: (3000 × $0.59 + 150 × $0.79) / 1,000,000
          = ($1.77 + $0.119) / 1,000,000 × turn_tokens
  Simpler: 3000 input + 150 output = ~$0.0000018 + ~$0.00000012 = ~$0.0000019
  
  Groq per turn: ~$0.000002 (essentially free vs Gemini)

4-attempt session (Turn 1 + 3 Groq turns):
  Turn 1:      $0.000422
  Turn 2:      ~$0.000002
  Turn 3:      ~$0.000002
  Turn 4:      ~$0.000002
  TOTAL:       ~$0.000428

vs naive (Gemini, no cache, no BAO, 5 calls × 4 attempts):
  20 × $0.0006 = $0.012

SAVINGS: ~96%
```

### Monthly Per Lamp
| Usage | LLM cost/day | + TTS (Cartesia) | Total/month |
|-------|-------------|-----------------|------------|
| 30 turns/day | ~$0.013 | ~$0.015 | ~$0.84 |
| 50 turns/day | ~$0.021 | ~$0.025 | ~$1.40 |
| 100 turns/day | ~$0.043 | ~$0.050 | ~$2.80 |

**Target subscription: ₹299-499/month (~$3.60-6.00)**
**API cost at 50 turns/day: ~$1.40/month**
**Gross API margin: ~60-75%**

---

## 3. Latency Budget

| Stage | Target | How |
|-------|--------|-----|
| Wake → image sent | 300ms | Capture on wake word |
| EOS → first LLM token (Turn 1) | 400-700ms | Gemini Flash + HTTP/2 |
| EOS → first LLM token (Turn 2+) | 150-300ms | Groq |
| First token → TTS start | +90ms | Cartesia Sonic |
| TTS → speaker | +100ms | Persistent WebSocket |
| **Turn 1: speech-end → speaker** | **<1.5s** ✅ | |
| **Turn 2+: speech-end → speaker** | **<500ms** ✅ | |

---

## 4. Exam Track Quick Reference

| Exam | Track | LaTeX? | Grounding? | Model Turn 2+ |
|------|-------|--------|-----------|--------------|
| JEE | Technical | ✅ | ❌ | Groq |
| GATE | Technical | ✅ | ❌ | Groq |
| NEET | Technical | ✅ | ❌ | Groq |
| UPSC (static) | Conceptual | ❌ | ❌ | Groq |
| UPSC (current) | Conceptual | ❌ | ✅ | Groq |
| CAT | Conceptual | ❌ | ❌ | Groq |
| SSC (static) | Conceptual | ❌ | ❌ | Groq |
| SSC (current GK) | Conceptual | ❌ | ✅ | Groq |

---

## 5. Confidence Routing

| is_confident | Action | Extra latency | Extra cost |
|-------------|--------|--------------|-----------|
| ≥ 0.85 | Send immediately | 0 | $0 |
| 0.60-0.84 | Retry same model | +300ms | ~$0.0002 |
| < 0.60 | Escalate to Gemini Pro | +800ms | ~$0.004 |
| Pro < 0.60 | Send with verbal caveat | 0 | $0 |

---

## 6. Error Handling

| Error | Action |
|-------|--------|
| Gemini cache expired | Recreate from Redis data |
| Groq timeout | Retry once, then fallback to Gemini Flash text |
| WebSocket disconnect | Device auto-reconnect, TLS resume |
| Audio too short (<0.5s) | Return "Didn't catch that, try again" |
| Image corrupt/dark | Proceed audio-only, set image_useful=false |
| JSON in markdown wrapper | Strip ``` before parsing |
| Groq returns non-JSON | Retry with explicit JSON instruction |
| Rate limit hit | Queue + STATE frame to device |
