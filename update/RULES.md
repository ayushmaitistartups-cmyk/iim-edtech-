# LUMOS — Rules

Non-negotiable invariants for anyone editing this repo. Cite the rule number
in PR descriptions when a change is driven by one.

1. **Socratic mandate.** The lamp never speaks the final answer. Responses
   either ask a guiding question, point at the misstep, or describe the
   sub-skill the student needs to revisit. Direct answers are reserved for
   the explicit `DIRECT` nudge level (Phase 2+) and require validator approval.

2. **One frame protocol, one transport.** Every message on `/lamp/ws` is a
   binary frame matching [`schemas/frames.py`](../lumos-backend/schemas/frames.py).
   No JSON-over-WS, no second WebSocket route. Inbound JSON belongs on REST.

3. **Device JWT is backend-owned.** Lamps authenticate to the gateway with a
   JWT signed by `DEVICE_JWT_SECRET`. Clerk tokens never reach the lamp;
   lamp tokens never reach Clerk. See [`changes/IMPLEMENTATION_AUTH_PAIRING.md`](changes/IMPLEMENTATION_AUTH_PAIRING.md).

4. **Two close codes, two meanings.** Use `4401` for bad/missing/tampered
   JWTs (no retry, no JWT clear needed). Use `4402` for valid-signature-but-
   revoked devices (no retry; lamp wipes its JWT and re-pairs). Anything else
   is a reconnect candidate.

5. **Latency budgets are testable.** Turn 1 target <1.5 s, Turn 2+ target
   <500 ms (per [`changes/05_DECISIONS_AND_COST.md`](changes/05_DECISIONS_AND_COST.md)).
   Any code change that touches the hot path must include a benchmark or be
   gated behind a feature flag.

6. **Exam tracks are not cosmetic.** Technical exams (JEE/GATE/NEET) must
   emit LaTeX on the TFT and audio-friendly prose on the speaker. Conceptual
   exams (UPSC/CAT/SSC) must emit no LaTeX — bullet text only. Cross-track
   leakage is a validator failure (Phase 4).

7. **No browser tutor.** The Next.js web app is for pairing and account
   management only. Do not add chat, voice, OCR, or live-lesson routes. If
   you need to test the tutoring pipeline locally, use the Python smoke
   client under `lumos-backend/tests/`.

8. **Pin secrets to environment.** No literal API keys, no `dev-…` fallbacks
   in production builds. The gateway warns at startup if
   `DEVICE_JWT_SECRET` is still the dev default; CI fails the deploy if it
   detects the fallback in a production environment.

9. **Strict TypeScript, strict mypy (when adopted).** No `any` in new code;
   no implicit `Any` in Python orchestrator/provider modules. The reason is
   the same in both languages: silent type drift between frame schemas and
   handlers is the single largest source of LUMOS regressions during a phase
   transition.
