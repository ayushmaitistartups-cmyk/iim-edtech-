# LUMOS — Changelog
> What changed in v4 and why

## v4.0 — Changes from v3

| Change | Source | Impact |
|--------|--------|--------|
| Groq Llama 3.3 70B for Turns 2+ | PDF review | Latency drops from 400-700ms to 150-300ms on follow-ups |
| Camera OFF after Turn 1 | PDF review | Saves bandwidth, ESP32 processing |
| Two exam tracks (technical / conceptual) | PDF review | LaTeX for JEE/GATE, plain text for UPSC/CAT |
| TFT constraint explicit: 320×240, 4 lines | PDF review | Hardware-grounded, was vague before |
| Turn 1 + Turn 2+ separate prompts | PDF review | Cleaner, Groq-compatible |
| is_confident as float kept (not boolean) | Our design | Boolean too coarse, misses retry zone |
| Gemini Context Caching kept | Our design | Not in PDF, critical cost reduction |
| Google Search Grounding kept | Our design | Not in PDF, UPSC accuracy |
| Cross-session Rule B + Rule C kept | Our design | Not in PDF, long-term learning |
| Topic-specific context pruning | Both | PDF + our lean profile design |

## What stayed the same
- BAO (Base Answer Once) framework — both had this
- 6-type Query Type taxonomy (Ayush's)
- Direct answer score matrix
- Redis + Postgres + R2 storage layer
- Binary frame protocol
- Cartesia Sonic TTS
- Validator rules

---

## 2026-05-26 — Phase 0 shipped

| Change | Where | Notes |
|---|---|---|
| `lumos-backend/` created with the LUMOS module layout | new | `gateway/` + `schemas/` + `storage/` populated; provider/orchestrator/classifier/formatter folders deferred to Phases 1–4 |
| Device JWT issuer aligned to `lumos-auth`, `ver=1` claim added | `lumos-backend/gateway/auth.py` | Pre-pivot tokens invalidated (no prod users) |
| `/lamp/ws` route with 4401/4402 close-code split + PING→PONG | `lumos-backend/gateway/websocket.py` | Phase 0 stub turn answers `AUDIO_END` with `STATE(thinking) → TFT_TEXT → AUDIO_OUT_END → STATE(idle)` |
| 15-test pytest suite (auth, registry, frames, WebSocket round-trip) | `lumos-backend/tests/` | Covers valid/missing/tampered JWT, revoked device, PING/PONG, AUDIO_END, CANCEL |
| ESP32-S3 firmware skeleton | `firmware/tutor_lamp/` | NVS-stored device id/secret/JWT, pairing flow, WSS connection, 10 s heartbeat, 2/4/8/16/30/30 s ± 25 % jitter backoff |
| Old ESP32-CAM firmware archived | `firmware/legacy/` | Kept for reference only |
| Old `backend/` and `tests/` deleted, `/ws/client/{id}` + `/ws/hardware/{id}` removed | repo root | Empty `backend/` folder may persist on Windows due to handle lock |
| v0.1 web app stripped — ~25 routes/hooks/components/lib files removed | `app/`, `components/`, `hooks/`, `lib/` | New web app is 6 routes: `/`, sign-in/up, `/devices`, `/pair/[code]`, `/api/webhooks/clerk` |
| Deps trimmed (`@google/generative-ai`, `framer-motion`, `react-markdown`, `rehype-katex`, `remark-math`, `remark-gfm`, `@tailwindcss/typography`, `@notionhq/client`) | `package.json` | `npm run typecheck && lint && build` clean |
| `update/*` docs rewritten for the lamp-only product | `update/PRD.md`, `ARCHITECTURE.md`, `TECH_STACK.md`, `FEATURES.md`, `TASKS.md`, `IMPLEMENTATION_PLAN.md`, `RULES.md`, `PROJECT_CONTEXT.md`, `workflow.md` | v0.1 phase descriptions kept under TASKS.md §Archived for git-history continuity |
