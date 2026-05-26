# LUMOS — Rules

Non-negotiable invariants for anyone editing this repo. Cite the rule number
in PR descriptions when a change is driven by one.

1. **Socratic mandate.** The lamp never speaks the final answer. Responses
   either ask a guiding question, point at the misstep, or describe the
   sub-skill the student needs to revisit. Direct answers are reserved for
   an explicit teacher-driven nudge level (not yet wired) and require
   validator approval.

2. **One frame protocol, one transport.** Every message on `/lamp/ws` is a
   binary frame matching [`app/protocol.py`](../lumos-backend/app/protocol.py).
   No JSON-over-WS, no second WebSocket route. Inbound JSON belongs on REST.

3. **Device JWT is backend-owned.** Lamps authenticate to the gateway with a
   JWT signed by `DEVICE_JWT_SECRET`. Clerk tokens never reach the lamp;
   lamp tokens never reach Clerk. See [`changes/IMPLEMENTATION_AUTH_PAIRING.md`](changes/IMPLEMENTATION_AUTH_PAIRING.md).

4. **Two close codes, two meanings.** Use `4401` for bad/missing/tampered
   JWTs (no retry, no JWT clear needed). Use `4402` for valid-signature-but-
   revoked devices (no retry; lamp wipes its JWT and re-pairs). Anything else
   is a reconnect candidate.

5. **Latency budgets are testable.** End-to-end target <1.5 s (wake-word to
   first speaker audio), ceiling 2.5 s (per
   [`changes/05_DECISIONS_AND_COST.md`](changes/05_DECISIONS_AND_COST.md)).
   Any code change that touches the hot path must include a benchmark or be
   gated behind a feature flag.

6. **Exam tracks are not cosmetic.** Technical exams (JEE/GATE/NEET) emit
   LaTeX on the TFT and audio-friendly prose on the speaker. Conceptual
   exams (UPSC/CAT/SSC) emit no LaTeX — bullet text only — and may trigger
   Google Search grounding. Cross-track leakage is a validator failure (see
   [`app/services/validator.py`](../lumos-backend/app/services/validator.py)).

7. **No browser tutor.** The Next.js web app is for pairing and account
   management only. Do not add chat, voice, OCR, or live-lesson routes. If
   you need to test the tutoring pipeline locally, use
   [`scripts/mock_lamp.py`](../lumos-backend/scripts/mock_lamp.py).

8. **Pin secrets to environment.** No literal API keys, no `dev-…` fallbacks
   in production builds. The gateway warns at startup if
   `DEVICE_JWT_SECRET` is still the dev default; CI fails the deploy if it
   detects the fallback in a production environment.

9. **Strict TypeScript, strict mypy (when adopted).** No `any` in new code;
   no implicit `Any` in Python orchestrator/provider modules. The reason is
   the same in both languages: silent type drift between frame schemas and
   handlers is the single largest source of LUMOS regressions during a phase
   transition.

10. **Persistence is off the hot path.** Anything that writes to a blob,
    file, or database happens in `asyncio.create_task` *after* the lamp has
    received `STATE(idle)`. The user never waits for an S3 / Postgres /
    pgvector round-trip. See [`app/services/persistence.py`](../lumos-backend/app/services/persistence.py)
    as the reference shape — best-effort, swallows exceptions, logs only.

11. **Provider fallbacks must keep the gateway bootable.** Every external
    dependency (Gemini, Cartesia, Redis, R2) must have a working in-process
    or file-backed fallback so `uvicorn main:app` boots with zero env vars
    and the test suite passes against the mocks. Keys turn live behaviour on;
    they do not gate basic operation. See the matrix in
    [`ARCHITECTURE.md`](ARCHITECTURE.md) §"Provider fallback matrix".

12. **Confidence is float, not boolean.** `LlmReply.is_confident` lives in
    `[0, 1]`; thresholds for escalation (default 0.60) and review-zone
    logging (default 0.85) come from
    [`app/config.py`](../lumos-backend/app/config.py), not from the validator
    or the orchestrator. Tune via env vars after observing prod reviews.
