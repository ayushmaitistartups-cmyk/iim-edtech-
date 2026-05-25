# IMPLEMENTATION_AUTH_PAIRING.md — Account, Auth, and Device Pairing

> **Scope:** This document specifies how a user account is created, how a
> physical lamp is linked to that account, and how the lamp authenticates to
> the backend afterwards. It covers **Python backend (FastAPI)**,
> **Next.js frontend with Clerk for human identity**, and **ESP32 firmware**
> — each section is independently implementable.
>
> **Out of scope:** The live audio/image/TFT WebSocket protocol — see
> `IMPLEMENTATION_WEBSOCKET.md`. Once a lamp is paired and has its
> `device_jwt`, this document hands off to that one.
>
> **Audience:** A fresh engineer or LLM on any of the three sides should be
> able to implement their part from this file alone.

---

## 0. One-paragraph overview

Each physical lamp has a unique `device_id` and a secret known only to it
and the Python backend. When a user receives a lamp, the lamp displays a QR
code on its TFT. The user creates an account / logs in on the Next.js
frontend (which uses **Clerk** for all human authentication), scans the QR,
and clicks "Link this lamp". The Python backend verifies the user's Clerk
session, then mints a long-lived `device_jwt` signed with the **backend's
own secret** (not Clerk's). The lamp stores that JWT and uses it on every
WebSocket connect. All pairing traffic is HTTPS; the WebSocket protocol is
**unchanged** by this feature (one new STATE byte and one new close code).

### 0.1 Strict identity boundary — read this before touching code

> **The ESP32 lamp NEVER talks to Clerk.**
>
> Clerk handles only the **human identity layer** on the frontend:
> - Signup / login / logout
> - OAuth (Google, GitHub, etc.)
> - Session management in the browser
> - Password reset
> - Email verification
> - Frontend route protection (`<SignedIn>`, middleware)
>
> Clerk does NOT touch the **device identity system**. The lamp's
> `device_id`, `device_secret`, and `device_jwt` are generated, hashed,
> signed, and verified by the **Python backend** using its own secrets.
> Clerk could be swapped out tomorrow without changing a single line of
> firmware.
>
> The boundary, drawn precisely:
>
> | Component | Talks to Clerk? | Knows `device_jwt`? |
> |---|---|---|
> | Next.js frontend (browser) | ✅ yes — via Clerk SDK | ❌ never |
> | Python backend | ✅ yes — verifies Clerk session tokens on incoming frontend requests | ✅ yes — mints, signs, verifies |
> | ESP32 lamp | ❌ never — no Clerk URL, no Clerk SDK, no Clerk JWT | ✅ yes — stores in NVS, sends as Bearer token |
> | WebSocket gateway (part of Python backend) | ❌ never | ✅ yes — verifies on every connect |
>
> If you ever find yourself writing Clerk code in firmware, or sending a
> Clerk token to the lamp, **stop** — that's the wrong layer.

---

## 1. Goals and non-goals

### Goals
- Bind one physical lamp to exactly one user account.
- No keyboard/touchscreen on the lamp — pairing must work from a QR.
- Survive lamp reboot, WiFi changes, frontend session expiry.
- Allow the user to unlink a lamp (e.g. sell it, give it away, factory reset).
- All identity material stored either in the user's secure browser session,
  in encrypted backend storage, or in ESP32 NVS — never in the QR.
- Hand off cleanly to `IMPLEMENTATION_WEBSOCKET.md` once paired.

### Non-goals
- **WiFi provisioning** (getting the lamp onto the user's WiFi in the first
  place). Mentioned in §13 as a known prerequisite, but assumed solved
  (recommend `WiFiManager` library for v1).
- **Multi-user lamps** / family sharing. v1 is one user per lamp.
- **Self-hosted enterprise SSO.** v1 supports email/password + one OAuth
  provider; add others as needed.
- **Federated devices** across multiple backends. One backend per fleet.
- **Per-feature authorization** (no admin/user role split). All users have
  identical permissions.

---

## 2. Assumptions

| # | Assumption | Failure mode |
|---|---|---|
| A1 | Backend, frontend, and the lamp's WebSocket gateway share the same Postgres database and Redis cache. | Pairing fails to propagate across services. |
| A2 | Lamp has a working HTTPS-capable TCP/IP stack (Arduino `HTTPClient` + `WiFiClientSecure`). | Pairing impossible. |
| A3 | Lamp is on WiFi before pairing begins (assumption A2 in WS doc; see §13 here). | Pairing screen shows "No WiFi" and halts. |
| A4 | Backend can mint and verify JWTs (HS256 or RS256, library of choice). | Backend rejects all WS connects. |
| A5 | Frontend is served over HTTPS in production; same-origin to the backend API or properly CORS'd. | Auth cookies blocked / mixed-content errors. |
| A6 | The user has a smartphone or laptop with a QR scanner / camera. | User stuck — provide a 6-character fallback code (see §6). |
| A7 | Wall-clock time on the backend is correct (NTP synced). Lamp clock NOT assumed accurate. | Backend JWT issuance/expiry checks unreliable if BE clock is wrong. |
| A8 | One lamp ⇄ one user, no concurrent pairings of the same physical lamp. | Race: see §11 edge case 4. |

If any assumption changes, update this section and the affected one.

---

## 3. Architecture overview

```
                ┌───────────────────────────┐
                │ Clerk (managed service)   │
                │   • signup / login        │
                │   • OAuth (Google etc.)   │
                │   • session tokens        │
                │   • password reset        │
                │   • email verification    │
                │   • webhooks: user.*      │
                └───────────┬───────────────┘
                            │  Clerk session   ▲ webhooks (user.deleted etc.)
                            │  (JWT + cookie)  │  Svix-signed
                            ▼                  │
┌──────────────────────────────────────────────┼────────────────────────────┐
│ User's phone / laptop                        │                            │
│   ┌────────────────────────────────────────┐ │                            │
│   │ Next.js frontend                       │ │                            │
│   │   Clerk SDK ── <SignedIn>, useUser()  ─┘ │                            │
│   │   /pair/[code]  /devices  /account       │                            │
│   └─────────────┬──────────────────────────┬─┘                            │
└─────────────────┼──────────────────────────┼──────────────────────────────┘
                  │ HTTPS                    │ HTTPS
                  │ Authorization: Bearer    │ Authorization: Bearer
                  │   <Clerk session token>  │   <Clerk session token>
                  ▼                          │
┌─────────────────────────────────────────────────────────────────────────────┐
│ Python backend  (FastAPI + uvicorn)                                         │
│                                                                              │
│   Pairing endpoints (lamp-facing, HTTPS):                                   │
│     POST /api/device/register                                               │
│     POST /api/device/poll-pairing                                           │
│                                                                              │
│   User endpoints (frontend-facing, Clerk-authed):                            │
│     GET  /api/pairing-info/{code}                                           │
│     POST /api/device/complete-pairing                                        │
│     GET  /api/devices                                                        │
│     POST /api/device/{id}/unlink                                            │
│     POST /api/device/{id}/rename                                            │
│                                                                              │
│   Webhook (Clerk → backend):                                                 │
│     POST /api/clerk/webhook    (user.created, user.deleted, etc.)            │
│                                                                              │
│   WebSocket gateway (lamp-facing, device_jwt-authed):                       │
│     wss://.../lamp/ws                                                        │
│                                                                              │
│   verifies Clerk tokens      mints / verifies device_jwt   storage          │
│   ┌─────────────────────┐   ┌────────────────────────┐   ┌──────────────┐  │
│   │ Clerk Python SDK    │   │ jose / PyJWT HS256     │   │ Postgres     │  │
│   │ (JWKS, session)     │   │ DEVICE_JWT_SECRET      │   │  devices     │  │
│   │ NEVER given to lamp │   │ (own secret, not Clerk)│   │  pairing     │  │
│   └─────────────────────┘   └────────────────────────┘   │ Redis (rate) │  │
│                                                          └──────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
                  ▲
                  │ HTTPS for pairing  (only sees device_secret + device_jwt)
                  │ WSS for live ops   (only sees device_jwt)
                  │
┌─────────────────┴──────────────────────────────────────────────────────────┐
│ Lamp (ESP32-S3)                                                             │
│   provisioning.{h,cpp}                                                      │
│     • device_id / device_secret in NVS                                      │
│     • POST /register → QR on TFT → POST /poll-pairing → save device_jwt     │
│   net_ws.{h,cpp}                                                            │
│     • wss connect with Authorization: Bearer <device_jwt>                   │
│   Lamp has ZERO knowledge of Clerk.                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

The three sides exchange data via:

| Channel | Used for | Auth | Spec |
|---|---|---|---|
| Browser ⇄ Clerk | signup/login/OAuth/session | Clerk-internal | Clerk docs |
| Browser ⇄ Python backend | pairing confirmation, device list, rename, unlink | Clerk session token (Bearer) | §6, §7 |
| Clerk → Python backend | user lifecycle events (created, deleted) | Svix signature | §6.8 |
| Lamp → Python backend (HTTPS) | register, poll for pairing | `device_secret` in body | §6, §8 |
| Lamp ⇄ Python backend (WSS) | post-pairing live traffic | `device_jwt` Bearer | `IMPLEMENTATION_WEBSOCKET.md` |

---

## 4. Identities and secrets

Six distinct pieces of identity material. **Do not conflate them.**

| Name | Stored where | Lifetime | Who knows it | Purpose |
|---|---|---|---|---|
| `device_id` | Lamp NVS + Postgres `devices.device_id` | forever | Lamp, backend, the linked user (visible) | Stable name. Derived from MAC, e.g. `lamp-7C9EB42F`. |
| `device_secret` | Lamp NVS + Postgres `devices.device_secret_hash` (hashed) | forever (rotatable) | Lamp + backend only | Proves "I am this lamp." Never in QR, never shown to user, never seen by Clerk. |
| `pairing_code` | Postgres `pairing_codes` | 5 minutes | Lamp, backend, briefly the user (in URL) | Bridges "this lamp" ↔ "this logged-in user". |
| **Clerk user record** | Clerk's servers | account lifetime | Clerk, browser, backend (via API) | The human identity. Username, email, password hash, OAuth links — all owned by Clerk. |
| **Clerk session token** | Browser (cookie / `getToken()`) | rolling refresh (≤ 60 s for short tokens) | Browser + backend (when verifying) | Proves "this browser is a logged-in user." Sent to the Python backend as `Authorization: Bearer <token>` on frontend → backend calls. **Never goes anywhere near the lamp.** |
| `device_jwt` | Lamp NVS + (revocation in `devices.revoked_at`) | indefinite (revocable) | Lamp + Python backend | Lamp's WebSocket bearer token. Signed by the Python backend's own secret — has nothing to do with Clerk. |

### 4.1 How the secrets are generated

- `device_id`: derived once on first boot from the ESP32 MAC: `"lamp-" + last 6 hex chars`. Stored in NVS, never regenerated unless factory reset.
- `device_secret`: 32 random bytes from `esp_random()` on first boot. Stored in NVS. Sent **once** to the backend on `/api/device/register`; backend stores `argon2id(secret)` hash. The raw secret never re-leaves the lamp.
- `pairing_code`: backend generates a 6-character `[A-Z0-9]` code, e.g. `ABC123`, displayed as `ABC-123` for readability. Single-use, expires in 5 min.
- **Clerk user record**: created by Clerk when the user signs up. Backend learns of the user via either (a) verifying a session token the frontend sends, or (b) the `user.created` webhook from Clerk. We do **not** mirror the password or OAuth secrets — only the Clerk user ID (`user_2abc…`) is stored in our DB (in `devices.user_id`).
- **Clerk session token**: minted by Clerk inside the user's browser via the Clerk SDK. The frontend calls `getToken()` from `@clerk/nextjs` and passes the result on every API call to the Python backend. Verified server-side via the Clerk Python SDK (or by hitting Clerk's JWKS endpoint).
- `device_jwt`: minted by the Python backend at pairing completion. HS256-signed with `DEVICE_JWT_SECRET` (a backend env var that Clerk knows nothing about). Claims in §6.3.

### 4.2 Trust assumptions

- Anyone who has the lamp physically can read its NVS via JTAG — accept this. Mitigation: device_jwt is per-user and revocable; a thief gains nothing useful without the owner's password.
- The QR URL is **not** secret. The pairing_code in it is single-use, time-bounded, and useless without the user logging in. Leaking the QR in a YouTube video is fine; the lamp's owner sees the URL only for ~5 min.
- The `device_secret` is the only thing that *must* stay private. Treat it like a password — never log, never print to serial above DEBUG level, never include in error responses.

---

## 5. End-to-end sequence diagrams

### 5.1 First-time pairing

```
Lamp           Py backend         Frontend          Clerk           User
────           ──────────         ────────          ─────           ────

boot
 │ no device_jwt
 │
 │ POST /api/device/register
 │ {device_id, device_secret}
 ├──────────────►│
 │               │ argon2id verify or upsert
 │               │ generate pairing_code (5 min TTL)
 │ {pairing_code,│
 │  pairing_url, │
 │  ttl: 300 }   │
 │◄──────────────┤
 │
 │ render QR of pairing_url on TFT
 │
 │ every 3s:
 │   POST /api/device/poll-pairing
 │   {device_id, device_secret, pairing_code}
 ├──────────────►│
 │ {status:"pending"}
 │◄──────────────┤
 │  (loop)       │
 │                                                                   │ scan QR
 │                                  │◄──────────────────────────────┤
 │                                  │ open /pair/[code]              │
 │                                  │
 │                                  │ Clerk SDK checks auth          │
 │                                  ├─────────────────►│             │
 │                                  │  session?         │            │
 │                                  │◄─────────────────┤             │
 │                                  │  if NOT signed in:             │
 │                                  │   redirect <SignIn> →─────────►│
 │                                  │                                │ enter creds /
 │                                  │                                │ OAuth flow
 │                                  │◄───────────── session ◀────────┤
 │                                  │ (Clerk gives session token)
 │                                  │
 │                                  │ GET /api/pairing-info/:code
 │                                  │ Authorization: Bearer <Clerk session token>
 │               │◄────────────────┤
 │               │ verify Clerk session via Clerk SDK
 │               │   ── if invalid → 401
 │               │ load pairing_codes row by code
 │               │ {device_id, friendly_name, expires_at}
 │               ├────────────────►│
 │                                  │ render "Link this lamp" card
 │                                  │                                │ click "Link"
 │                                  │◄───────────────────────────────┤
 │                                  │ POST /api/device/complete-pairing
 │                                  │ Authorization: Bearer <Clerk session token>
 │                                  │ {pairing_code}
 │               │◄────────────────┤
 │               │ verify Clerk session → get clerk_user_id (e.g. "user_2abc…")
 │               │ TX:
 │               │   pairing_codes row lock
 │               │   devices.user_id = clerk_user_id
 │               │   devices.paired_at = now()
 │               │   mint device_jwt
 │               │     sub = device_id
 │               │     uid = clerk_user_id
 │               │     signed with DEVICE_JWT_SECRET (NOT Clerk's secret)
 │               │   pairing_codes.status = "paired"
 │               │   pairing_codes.device_jwt = <jwt>
 │               │ 200 OK {device_id, friendly_name}
 │               ├────────────────►│
 │                                  │ confetti + redirect /devices
 │
 │ POST /api/device/poll-pairing   (next 3s tick)
 ├──────────────►│
 │ {status:"paired", device_jwt:"eyJ…"}
 │◄──────────────┤
 │ pairing_codes row deleted
 │
 │ NVS save device_jwt
 │ clear QR from TFT
 │ provisioning::ensure_paired() returns true
 │
 │ proceed to net_ws::connect() ── see IMPLEMENTATION_WEBSOCKET.md
 │ (Lamp NEVER spoke to Clerk during any of the above.)
```

### 5.2 Re-pairing (lamp had a JWT but it was revoked)

```
Lamp                    Backend                        Frontend          User
────                    ───────                        ────────          ────

boot
  │ NVS has device_jwt
  │ connect WSS with Bearer device_jwt
  ├──────────────────────►│
  │                       │ devices.revoked_at IS NOT NULL
  │ close 4402            │
  │◄──────────────────────┤
  │
  │ NVS erase device_jwt
  │ fall back to provisioning flow (same as 5.1 from "POST /register")
```

### 5.3 User unlinks a lamp

```
Lamp                    Backend                        Frontend          User
────                    ───────                        ────────          ────

(lamp is on WSS, all good)
                                                       │ /devices page
                                                       │ click "Unlink"
                                                       ├─────────────►
                                                       │ confirm dialog
                                                       │◄────────────  click
                        ◄──────────────────────────────┤ POST /api/device/:id/unlink
                        │ cookie: user_jwt
                        │ devices.revoked_at = now()
                        │ revoke device_jwt
                        │ 204 No Content
                        ├─────────────────────────────►│
                                                       │ row gone from /devices
  ◄ existing WSS gets close 4402 from gateway
  │  (gateway watches devices.revoked_at)
  │ NVS erase device_jwt
  │ enter pairing mode (show QR)
```

---

## 6. Backend specification

> **Stack:** Python + **FastAPI** + uvicorn. SQLAlchemy 2.x async (or asyncpg
> raw) on Postgres. `clerk-backend-sdk` for Clerk session verification.
> `python-jose[cryptography]` for minting/verifying `device_jwt`.
> `argon2-cffi` for hashing `device_secret`. Redis (Upstash) for rate
> limiting. All endpoints in one FastAPI app; the WebSocket gateway is
> exposed by the same app via `@app.websocket("/lamp/ws")`.

### 6.1 API endpoints

All endpoints are HTTPS. JSON request/response bodies. Errors return
`{ "error": str, "code": str }` with the relevant HTTP status.

**Two distinct auth modes** appear below:

| Auth mode | Header | Verified by | Used by which endpoints |
|---|---|---|---|
| **Device auth** | request body fields `device_id` + `device_secret` | argon2id verify against `devices.device_secret_hash` | `/register`, `/poll-pairing` (lamp-facing) |
| **Clerk session auth** | `Authorization: Bearer <Clerk session token>` | Clerk Python SDK (JWKS verification) | `/pairing-info/{code}`, `/complete-pairing`, `/devices`, `/device/{id}/unlink`, `/device/{id}/rename` (frontend-facing) |
| **Webhook auth** | `svix-id`, `svix-timestamp`, `svix-signature` headers | `svix` Python lib | `/clerk/webhook` (Clerk-facing) |

#### 6.1.1 `POST /api/device/register`

Called by: **lamp**. Public (no user_jwt). Idempotent — safe to call multiple times.

```ts
// Request
{
  device_id:     string;   // "lamp-7C9EB42F"
  device_secret: string;   // 64-hex-char string (32 bytes hex-encoded)
}

// Response 200
{
  pairing_code: string;    // "ABC123"
  pairing_url:  string;    // "https://app.example.com/pair/ABC123"
  expires_in:   number;    // 300 (seconds)
}

// Errors
401 { error: "invalid device credentials", code: "DEV_AUTH_FAIL" }
429 { error: "too many registration attempts", code: "RATE_LIMIT" }
```

**Behaviour**:
1. Look up `device_id` in `devices` table.
2. If not found → create row with `device_secret_hash = argon2(device_secret)`, no `user_id`. (First-boot enrollment.)
3. If found → verify `argon2_verify(device_secret_hash, device_secret)`. On mismatch → 401.
4. If `devices.user_id IS NOT NULL` and `revoked_at IS NULL` → device is already paired. Return 409 with `{ error: "already paired", code: "ALREADY_PAIRED" }` so the lamp can stop showing the QR. (However: usually the lamp wouldn't call /register if it had a valid JWT; this branch is a recovery path.)
5. Generate a pairing_code (6 chars, `[A-Z0-9]`, collision-checked).
6. Insert into `pairing_codes` with `status='pending'`, `expires_at = now() + 5 min`.
7. Return code + URL.

Rate limit: 10 calls / hour per `device_id`.

#### 6.1.2 `POST /api/device/poll-pairing`

Called by: **lamp**, every 3 s during pairing. Public (no user_jwt).

```ts
// Request
{
  device_id:     string;
  device_secret: string;
  pairing_code:  string;
}

// Response 200
{ status: "pending" }
// or
{ status: "paired",  device_jwt: string }   // jwt is a signed JWT string
// or
{ status: "expired" }                       // code expired or unknown

// Errors
401 { error: "invalid device credentials", code: "DEV_AUTH_FAIL" }
404 { error: "unknown pairing code", code: "CODE_NOT_FOUND" }
```

**Behaviour**:
1. Verify device_secret as in §6.1.1.
2. Look up pairing_codes row by `pairing_code`. If absent → 404.
3. If `device_id` on the row doesn't match the requester's → 404 (don't leak existence).
4. If `expires_at < now()` → return `{ status: "expired" }`. The row may be deleted lazily.
5. If `status == 'pending'` → return `{ status: "pending" }`.
6. If `status == 'paired'` → return `{ status: "paired", device_jwt: <stored> }`. **Then delete the pairing_codes row** (single-use; subsequent polls would 404).

Rate limit: 60 calls / 5 min per `device_id` (one poll every 3 s, with headroom).

#### 6.1.3 `GET /api/pairing-info/:code`

Called by: **frontend**, when rendering the `/pair/[code]` page. Public (no user_jwt required — the page itself enforces login).

```ts
// Response 200
{
  device_id:     string;     // "lamp-7C9EB42F"
  friendly_name: string;     // "Tutor Lamp" (default; user can rename later)
  expires_at:    string;     // ISO timestamp
}

// Errors
404 { error: "unknown pairing code", code: "CODE_NOT_FOUND" }
410 { error: "pairing code expired", code: "CODE_EXPIRED" }
409 { error: "lamp already linked",   code: "ALREADY_PAIRED" }
```

**Behaviour**:
1. Look up `pairing_codes` by code.
2. If absent → 404; if expired → 410; if already paired → 409.
3. Otherwise return device_id + friendly_name + expires_at.

#### 6.1.4 `POST /api/device/complete-pairing`

Called by: **frontend**, after the user clicks "Link this lamp". Requires a
valid **Clerk session token** in `Authorization: Bearer <token>` (obtained
by the frontend via `getToken()` from `@clerk/nextjs`).

```ts
// Request
{
  pairing_code: string;
}

// Response 200
{
  device_id:     string;
  friendly_name: string;
}

// Errors
401 { error: "not logged in", code: "USER_AUTH_FAIL" }
404 { error: "unknown pairing code", code: "CODE_NOT_FOUND" }
410 { error: "pairing code expired", code: "CODE_EXPIRED" }
409 { error: "lamp already linked", code: "ALREADY_PAIRED" }
```

**Behaviour** (inside one DB transaction):
1. **Verify the Clerk session token via the Clerk Python SDK.** Extract
   `clerk_user_id = state.payload["sub"]` (e.g. `"user_2abcDEF…"`).
   On invalid/expired token → 401.
2. Look up `pairing_codes` row by `pairing_code`. If absent → 404; expired → 410.
3. `SELECT … FOR UPDATE` on `devices` by `device_id` from that row.
4. If `devices.user_id IS NOT NULL` and `revoked_at IS NULL` → 409.
5. Set `devices.user_id = clerk_user_id`, `devices.paired_at = now()`,
   `devices.revoked_at = NULL`.
6. Mint `device_jwt` with claims (§6.3) — **signed with the backend's own
   `DEVICE_JWT_SECRET`, NOT any Clerk secret**.
7. Update `pairing_codes`: `status='paired'`, `device_jwt=<jwt>`.
8. Commit. Return 200.

#### 6.1.5 `GET /api/devices`

Called by: **frontend**, on the `/devices` page. Requires a Clerk session
token in `Authorization: Bearer`. Filters by `devices.user_id = clerk_user_id`.

```ts
// Response 200
{
  devices: Array<{
    device_id:     string;
    friendly_name: string;
    paired_at:     string;          // ISO
    last_seen_at:  string | null;   // ISO, updated by WS gateway
    online:        boolean;         // last_seen_at within 60 s
  }>
}
```

#### 6.1.6 `POST /api/device/{device_id}/unlink`

Called by: **frontend**. Requires Clerk session token and ownership.

```ts
// Response 204 No Content

// Errors
401 USER_AUTH_FAIL
403 NOT_OWNER
404 NOT_FOUND
```

**Behaviour**:
1. Verify Clerk session → get `clerk_user_id`.
2. Load `devices` row by id. 404 if missing.
3. If `devices.user_id != clerk_user_id` → 403.
4. Set `devices.revoked_at = now()`, `devices.user_id = NULL`.
5. `redis.publish("device:revoked:" + device_id, "1")` so the WS gateway
   closes the live socket immediately with code **4402**.

#### 6.1.7 `POST /api/device/{device_id}/rename`

Called by: **frontend**. Requires Clerk session token and ownership.

```ts
// Request
{ friendly_name: string }  // 1–60 chars

// Response 200
{ device_id: string, friendly_name: string }
```

#### 6.1.8 User auth — handled by Clerk

**There are NO custom auth endpoints in the Python backend.** All of these
live on Clerk's infrastructure and are reached through the Clerk SDK on the
frontend:

| Function | Where |
|---|---|
| Signup / Login | Clerk-hosted UI or `<SignIn>` / `<SignUp>` components in Next.js |
| OAuth (Google, GitHub, etc.) | Clerk dashboard config + `<SignIn>` |
| Logout | `<UserButton>` → "Sign out", or `signOut()` from `@clerk/nextjs` |
| Password reset | Clerk-hosted flow, triggered from `<SignIn>` |
| Email verification | Clerk-hosted, automatic on signup |
| Session refresh | Automatic in Clerk SDK |
| "Who is the current user?" | `useUser()` / `currentUser()` from `@clerk/nextjs` (frontend), or session token verification (backend) |

The Python backend only needs to **verify** Clerk session tokens, never
mint them. The lamp is completely unaware that Clerk exists.

#### 6.1.9 `POST /api/clerk/webhook` — Clerk → backend lifecycle events

Called by: **Clerk** (configure the webhook URL in the Clerk dashboard).
Signed by Clerk via **Svix**.

Subscribe to these event types in the Clerk dashboard:

| Event | Backend reaction |
|---|---|
| `user.created` | Optional: no-op for v1 (we don't mirror a users table). |
| `user.deleted` | `UPDATE devices SET revoked_at=now(), user_id=NULL WHERE user_id = $clerk_user_id; redis.publish each as device:revoked`. The user's lamps drop their WS, wipe JWTs on close 4402, and re-enter pairing mode. |
| `user.updated` | Optional: no-op for v1. |

**Behaviour**:
1. Read `svix-id`, `svix-timestamp`, `svix-signature` headers.
2. Verify with `Webhook(CLERK_WEBHOOK_SECRET).verify(payload, headers)`.
3. On `user.deleted`: cascade-revoke as above. Return 200.
4. On any unrecognized event: return 200 (don't bounce Clerk; it'll just retry).

### 6.2 Database schema (Postgres)

**No `users` table** — Clerk owns the user records. We store the Clerk user
ID directly in `devices.user_id` as text. To list a user's devices we just
`WHERE user_id = $clerk_user_id`. To handle account deletion we react to the
`user.deleted` webhook (§6.1.9).

```sql
CREATE TABLE devices (
    device_id           text PRIMARY KEY,             -- "lamp-7C9EB42F"
    device_secret_hash  text NOT NULL,                -- argon2id of device_secret
    user_id             text,                         -- Clerk user ID, e.g. "user_2abc…" or NULL
    friendly_name       text NOT NULL DEFAULT 'Tutor Lamp',
    paired_at           timestamptz,
    last_seen_at        timestamptz,
    revoked_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_idx ON devices(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE pairing_codes (
    code            text PRIMARY KEY,                 -- "ABC123"
    device_id       text NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    user_id         text,                             -- Clerk user ID, nullable until complete
    status          text NOT NULL CHECK (status IN ('pending','paired','expired')),
    device_jwt      text,                             -- minted on status='paired'
    expires_at      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pairing_codes_device_idx ON pairing_codes(device_id);
```

Background job (cron / APScheduler): every minute, delete `pairing_codes`
rows with `expires_at < now() - interval '1 hour'`.

### 6.3 JWT shape (device_jwt)

Header:
```json
{ "alg": "HS256", "typ": "JWT" }
```

Payload (claims):
```json
{
  "sub": "lamp-7C9EB42F",         // device_id
  "uid": "user_2abcDEF123…",       // Clerk user ID (kept as-is; no translation)
  "iat": 1700000000,
  "iss": "lumos-auth",
  "ver": 1                         // protocol version
}
```

Notes:
- **Signed with `DEVICE_JWT_SECRET`** — a Python-backend-owned env var.
  **NOT Clerk's secret.** Clerk has no idea this JWT exists.
- **No `exp` claim** — the WS gateway checks `devices.revoked_at` on each
  connect; revocation is the canonical signal. The lamp never needs to
  refresh.
- HS256 with a server-side secret (rotate annually). Migrate to RS256 if
  you ever want a separate microservice to verify JWTs without sharing the
  secret.
- `ver` lets you reject old tokens after a breaking protocol change. Bump
  it and revoke all old tokens together.
- `uid` stores the raw Clerk user ID (string `"user_2…"`). When the WS
  gateway gets a new connection, it just checks
  `devices.user_id == jwt.uid` — no Clerk call needed at WS-connect time.

### 6.4 Server-side device_jwt verification (WS gateway)

On every WebSocket upgrade attempt (FastAPI `@app.websocket("/lamp/ws")`):

1. Parse `Authorization: Bearer <jwt>` from the headers.
2. Verify signature with `DEVICE_JWT_SECRET` via `jose.jwt.decode`.
   On failure → `await ws.close(code=4401)`.
3. Reject expired tokens (none today — but guard for future schema changes).
4. `SELECT user_id, revoked_at FROM devices WHERE device_id = $jwt.sub`.
5. If `user_id IS NULL` or `revoked_at IS NOT NULL` or `user_id != jwt.uid`
   → `await ws.close(code=4402)`.
6. Otherwise accept. Periodically (every 30 s) `UPDATE devices SET last_seen_at = now()`.

The WS gateway also subscribes to Redis pub/sub `device:revoked:*` so it
can close any live socket immediately when the user clicks "Unlink" in the
frontend (§6.1.6).

**Critically**, the WS gateway makes **no Clerk calls** — `device_jwt`
self-contains everything we need. Clerk session tokens are only ever seen
by the HTTPS frontend-facing endpoints, never by the WebSocket.

### 6.5 Rate limiting

| Endpoint | Limit |
|---|---|
| `/api/device/register` | 10 req / hour per device_id |
| `/api/device/poll-pairing` | 60 req / 5 min per device_id |
| `/api/device/complete-pairing` | 30 req / hour per clerk_user_id |
| `/api/devices`, `/rename`, `/unlink` | 60 req / min per clerk_user_id |
| `/api/clerk/webhook` | no limit (signature-verified) |
| Login / signup | **handled by Clerk**, not us |

Implement via `slowapi` or a hand-rolled Redis token bucket. Return 429
with a `Retry-After` header.

### 6.6 Recommended stack (Python)

```
fastapi              0.110+     — web framework, also serves the WebSocket
uvicorn[standard]    0.27+      — ASGI server
sqlalchemy[asyncio]  2.0+       — ORM, async mode  (or asyncpg directly)
asyncpg              0.29+      — Postgres driver
alembic              1.13+      — migrations
clerk-backend-sdk    1.x        — Clerk session verification + JWKS
svix                 1.x        — webhook signature verification (Clerk uses Svix)
python-jose[cryptography] 3.x   — device_jwt sign / verify (HS256)
argon2-cffi          23.x       — device_secret hashing
redis[hiredis]       5.x        — rate limiting + revocation pub/sub
slowapi              0.1.9+     — FastAPI rate-limit decorators
nanoid               2.x        — short pairing codes
pydantic             2.x        — request/response models (comes with FastAPI)
python-dotenv        1.x        — .env loader (dev only)
```

**Postgres host:** Neon, Supabase, RDS — anything that speaks Postgres ≥ 14.
**Redis host:** Upstash (free tier ample), or self-hosted.
**Deploy targets:** Render, Railway, Fly.io, Google Cloud Run, AWS ECS —
  anything that runs a `uvicorn` process and lets you set env vars.

---

## 7. Frontend specification (Next.js + Clerk team)

This section is self-contained for the frontend team. Everything you need
to build the UI is here.

> **Stack:** Next.js 14 App Router + Clerk for ALL human auth. The
> frontend talks to two backends:
> - **Clerk** (via `@clerk/nextjs` SDK) — signup, login, OAuth, password
>   reset, email verification, session management.
> - **Python backend** (via `fetch` with `Authorization: Bearer <Clerk
>   session token>`) — device pairing, listing, renaming, unlinking.
>
> **You never talk to the lamp directly.** The lamp opens its own
> WebSocket to the Python backend; the frontend has no role in that.

### 7.1 Pages

| Route | Purpose | Auth required? |
|---|---|---|
| `/` | Marketing landing. Renders `<SignedOut>` "Sign up / Log in" buttons or `<SignedIn>` "Go to your lamps" link via Clerk components. | no |
| `/sign-in/[[...rest]]` | Clerk-hosted `<SignIn />` component (catch-all route). | no |
| `/sign-up/[[...rest]]` | Clerk-hosted `<SignUp />` component. | no |
| **`/pair/[code]`** | **The QR landing page. Critical.** See §7.2. | yes — Clerk middleware redirects to `/sign-in?redirect_url=/pair/[code]` if not signed in |
| `/devices` | List of paired lamps, rename, unlink. | yes |
| `/account` | Clerk's `<UserProfile />` component (handles email change, password change, OAuth links, delete account). | yes |

Sign-out: the standard Clerk `<UserButton />` in the header dropdown — no
custom `/logout` route needed.

### 7.2 `/pair/[code]` — the critical page

Wireframe:

```
┌───────────────────────────────────────────────────────┐
│ 💡 Lumos Tutor                              ayush@…   │
├───────────────────────────────────────────────────────┤
│                                                       │
│   You're about to link this lamp to your account.    │
│                                                       │
│   ┌─────────────────────────────────────┐            │
│   │  Lamp name   Tutor Lamp             │            │
│   │  Device ID   lamp-7C9EB42F          │            │
│   │  Code        ABC-123                │            │
│   │  Expires     in 4 minutes           │            │
│   └─────────────────────────────────────┘            │
│                                                       │
│       [ Link this lamp to my account ]                │
│                                                       │
│              Not your lamp?  Cancel.                  │
│                                                       │
└───────────────────────────────────────────────────────┘
```

Behaviour:

1. **Auth gate** (handled by Clerk middleware) — if `!auth().userId`,
   redirect to `/sign-in?redirect_url=/pair/[code]`. After login, Clerk
   bounces back here automatically.
2. On mount: extract `code` from URL params.
3. Fetch `GET /api/pairing-info/[code]` on the Python backend with
   `Authorization: Bearer <Clerk session token>` (use `getToken()` from
   `@clerk/nextjs`).
   - **200** → render the card. Start a countdown to `expires_at`.
   - **404** → `<ErrorPanel>` "We couldn't find that lamp. Please restart your lamp and try again."
   - **410** → `<ErrorPanel>` "This pairing code expired. Restart your lamp to get a new one."
   - **409** → `<ErrorPanel>` "This lamp is already linked to another account."
4. On "Link this lamp" click:
   - Disable the button, show spinner.
   - `POST /api/device/complete-pairing { pairing_code: code }`
     with `Authorization: Bearer <Clerk session token>`.
   - **200** → success state: confetti, "Done! Your lamp is ready." then
     `router.push("/devices")` after 1.5 s.
   - **4xx** → toast + revert to the error panel.
5. On "Cancel": `router.push("/")`.
6. Auto-refresh countdown every second. When it hits 0, switch to the 410
   error panel.

### 7.3 `/devices`

```
┌───────────────────────────────────────────────────────┐
│ 💡 Your Lamps                               ayush@…   │
├───────────────────────────────────────────────────────┤
│                                                       │
│   ┌───────────────────────────────────────────────┐  │
│   │ 🟢 Tutor Lamp                  [Rename][Unlink]│ │
│   │    lamp-7C9EB42F · last seen 12 s ago         │  │
│   └───────────────────────────────────────────────┘  │
│                                                       │
│   ┌───────────────────────────────────────────────┐  │
│   │ ⚪ Living Room Lamp             [Rename][Unlink]│ │
│   │    lamp-A1B2C3D4 · offline (last seen 3 d ago)│ │
│   └───────────────────────────────────────────────┘  │
│                                                       │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│   ➕ Add a new lamp                                   │
│      1. Plug in your lamp.                            │
│      2. When the screen shows a QR, scan it with     │
│         your phone.                                   │
│      3. Tap "Link" in the page that opens.            │
│                                                       │
└───────────────────────────────────────────────────────┘
```

Behaviour:

- Fetch `GET /api/devices` on mount. Poll every 30 s (or use SWR's `refreshInterval`).
- Online: green dot + `last_seen_at` < 60 s ago.
- Rename: inline edit → `POST /api/device/:id/rename`.
- Unlink: confirm dialog → `POST /api/device/:id/unlink` → optimistic remove from list.

### 7.4 API client + Clerk session token

Every call from the frontend to the Python backend must carry the user's
Clerk session token as a Bearer header:

```ts
// lib/api.ts
"use client";
import { useAuth } from "@clerk/nextjs";

export function useApi() {
  const { getToken } = useAuth();

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getToken();             // short-lived Clerk JWT
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json");
    const r = await fetch(`${BACKEND}${path}`, { ...init, headers });
    if (!r.ok) throw await r.json().catch(() => ({ code: "UNKNOWN" }));
    return r.status === 204 ? (undefined as T) : r.json();
  }
  return { call };
}
```

Combine with React Query as before:

```ts
export function usePairingInfo(code: string) {
  const { call } = useApi();
  return useQuery({
    queryKey: ["pairing-info", code],
    queryFn: () => call<PairingInfo>(`/api/pairing-info/${code}`),
    retry: false,
  });
}

export function useCompletePairing() {
  const { call } = useApi();
  return useMutation({
    mutationFn: (code: string) =>
      call<{ device_id: string; friendly_name: string }>(
        "/api/device/complete-pairing",
        { method: "POST", body: JSON.stringify({ pairing_code: code }) }),
  });
}

export function useDevices() {
  const { call } = useApi();
  return useQuery({
    queryKey: ["devices"],
    queryFn: () => call<{ devices: Device[] }>("/api/devices"),
    refetchInterval: 30_000,
  });
}
```

The Python backend will verify the token via the Clerk SDK on every call.

### 7.5 Error UX guide

| Error code | User message | Action shown |
|---|---|---|
| `CODE_NOT_FOUND` | "We couldn't find that lamp." | "Restart your lamp" |
| `CODE_EXPIRED` | "This pairing code expired." | "Restart your lamp" |
| `ALREADY_PAIRED` | "This lamp is already linked to another account." | "Contact support" |
| `USER_AUTH_FAIL` | Clerk middleware auto-redirects to `/sign-in?redirect_url=…` | — |
| `RATE_LIMIT` | "Too many tries. Please wait a minute." | (countdown) |
| network / 5xx | "Couldn't reach the server." | "Try again" button |

### 7.6 Recommended frontend stack

```
next            14+        — App Router
@clerk/nextjs   5+         — auth: SDK, middleware, <SignIn>/<SignUp>/<UserButton>/<UserProfile>
@tanstack/react-query 5+   — server-state caching
tailwindcss     3+         — styling
shadcn/ui                  — Card / Button / AlertDialog etc.
react-confetti             — success animation (optional)
zod                        — request body validation (optional)
```

You do **not** need:
- `next-auth` / Auth.js — Clerk replaces it entirely.
- `react-qr-code` — the lamp renders the QR; the frontend just opens a URL.
- Any direct DB / Postgres client — all reads/writes go through the Python backend API.

### 7.7 Clerk setup (5-minute checklist)

1. Create a Clerk application at clerk.com → grab `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
2. Set sign-in URL = `/sign-in`, sign-up URL = `/sign-up`, after-sign-in URL = `/devices`, after-sign-up URL = `/devices` in the Clerk dashboard.
3. Enable the OAuth providers you want (Google, GitHub, …) under "User & Authentication → Social connections". Email + password is on by default.
4. Configure a webhook endpoint pointing at `https://your-backend.example.com/api/clerk/webhook`. Subscribe to **`user.deleted`** at minimum. Copy the **signing secret** into the Python backend's `CLERK_WEBHOOK_SECRET` env var.
5. In Next.js:
   ```ts
   // middleware.ts
   import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
   const isProtected = createRouteMatcher(["/devices(.*)", "/pair(.*)", "/account(.*)"]);
   export default clerkMiddleware((auth, req) => {
     if (isProtected(req)) auth().protect();
   });
   export const config = { matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"] };
   ```
   ```tsx
   // app/layout.tsx
   import { ClerkProvider } from "@clerk/nextjs";
   export default function RootLayout({ children }) {
     return <ClerkProvider><html><body>{children}</body></html></ClerkProvider>;
   }
   ```
That's the entire Clerk integration on the frontend side. Everything else
(login UI, OAuth, password reset, etc.) is automatically provided by the
Clerk components.

### 7.8 What the frontend does **not** do

- The frontend never talks to the lamp directly.
- The frontend never sees `device_secret`, `device_jwt`, or `DEVICE_JWT_SECRET`.
- The frontend never opens a WebSocket. (That's the lamp's job.)
- The frontend never manages its own user database, password hashing, or session storage — Clerk owns all of that.

---

## 8. Firmware specification (ESP32)

> **Implementation status (current repo state):** all firmware-side modules
> for pairing AND the WebSocket are already in `tutor_lamp/`. The `.ino` is
> integrated. §8 below remains as the reference spec; §18.3 has the
> shipped-state table and remaining hardening tasks.
>
> | File | Status |
> |---|---|
> | `tutor_lamp/provisioning.h` / `.cpp` | ✅ |
> | `tutor_lamp/tft_qr.h` / `.cpp` | ✅ |
> | `tutor_lamp/net_ws.h` / `.cpp` | ✅ |
> | `tutor_lamp/tutor_lamp.ino` (calls `ensure_paired()`, `net::begin()`, streams AUDIO_CHUNK, handles STATE 0x05) | ✅ |
>
> **The lamp imports zero Clerk-related code.** Clerk URLs, SDKs, or
> session tokens never appear in firmware — only `device_id`,
> `device_secret`, and `device_jwt` do.

### 8.1 Module surface (`provisioning.h`)

```cpp
#pragma once
#include <stdint.h>

namespace provisioning {

// Run the full pairing flow if needed. Blocks (but with delays, not busy
// loops) until the lamp has a valid device_jwt in NVS or pairing fails.
// Returns true on success.
//
// Side effects:
//   • Loads or creates device_id and device_secret in NVS.
//   • May render QR + status on the TFT (via tft_qr module).
//   • On failure: leaves the TFT showing an error and returns false.
//
// Call from setup() before net::connect().
bool ensure_paired();

// Read accessors (cached; safe to call repeatedly).
const char* device_id();
const char* device_jwt();   // empty string if unpaired

// Wipe the device_jwt and re-enter pairing mode on next call to
// ensure_paired(). Does NOT wipe device_secret. Call from button long-press
// or on receipt of WS close code 4401 / 4402.
void clear_jwt();

// Factory reset — wipe device_id, device_secret, device_jwt. Used only by
// explicit recovery action. Lamp will generate fresh credentials next boot.
void factory_reset();

}  // namespace provisioning
```

### 8.2 NVS layout

Namespace: `"lamp"`. Keys:

| Key | Type | Set when | Cleared when |
|---|---|---|---|
| `device_id` | string (16 chars) | first boot | factory_reset() |
| `device_secret` | blob (32 bytes) | first boot | factory_reset() |
| `device_jwt` | string (~256 chars) | pairing complete | clear_jwt() |
| `wifi_ssid` | string | WiFi provisioning | factory_reset() |
| `wifi_pass` | string | WiFi provisioning | factory_reset() |

### 8.3 Boot flow (in `setup()`)

```cpp
void setup() {
    Serial.begin(115200);
    led::begin();
    image_viewer::begin();        // or tft_display::begin() once it exists

    if (!wifi::ensure_connected()) {        // soft-AP or stored creds
        led::set(STATE_ERROR);
        return;
    }

    if (!provisioning::ensure_paired()) {
        led::set(STATE_ERROR);
        return;
    }

    // From here, the lamp has a device_jwt and is online.
    wake::begin();
    audio_post_process_reset();
    mic::set_on_raw_frame(on_raw_frame);
    mic::set_on_cleaned_frame(on_cleaned_frame);
    mic::begin(wake::sample_rate());
    mic::start_task();

    net::begin(WS_URL);
    net::on_frame(handle_server_frame);
    net::connect();

    led::set(STATE_IDLE);
}
```

### 8.4 Inside `ensure_paired()`

```cpp
bool ensure_paired() {
    load_or_generate_device_id_and_secret();
    if (nvs_has("device_jwt")) {
        s_jwt = nvs_get("device_jwt");
        return true;
    }

    // No JWT — full pairing flow.
    Serial.println("[pair] no device_jwt, beginning pairing flow");

    PairingInitResp init;
    if (!http::post_register(s_device_id, s_device_secret, &init)) {
        tft_status("Register failed");
        return false;
    }

    tft_qr::show(init.pairing_url.c_str(), init.pairing_code.c_str());

    uint32_t deadline = millis() + init.expires_in * 1000;
    while (millis() < deadline) {
        delay(3000);
        PollResp p;
        if (!http::post_poll(s_device_id, s_device_secret,
                             init.pairing_code, &p)) continue;
        if (p.status == "paired") {
            nvs_set("device_jwt", p.device_jwt);
            s_jwt = p.device_jwt;
            tft_qr::clear();
            Serial.println("[pair] success");
            return true;
        }
        if (p.status == "expired") break;
        // "pending" — keep polling
    }

    tft_status("Pairing expired. Reboot to retry.");
    return false;
}
```

### 8.5 HTTP client

Use Arduino `HTTPClient` + `WiFiClientSecure`:

```cpp
namespace http {

WiFiClientSecure tls;
HTTPClient client;

bool post_register(const String& id, const String& sec, PairingInitResp* out) {
    tls.setCACertBundle(rootca_crt_bundle_start);
    client.begin(tls, BACKEND_URL "/api/device/register");
    client.addHeader("Content-Type", "application/json");

    StaticJsonDocument<256> req;
    req["device_id"]     = id;
    req["device_secret"] = sec;
    String body;
    serializeJson(req, body);

    int code = client.POST(body);
    if (code != 200) { client.end(); return false; }

    StaticJsonDocument<512> resp;
    deserializeJson(resp, client.getString());
    out->pairing_code = resp["pairing_code"].as<String>();
    out->pairing_url  = resp["pairing_url"].as<String>();
    out->expires_in   = resp["expires_in"].as<int>();
    client.end();
    return true;
}
// post_poll is analogous

}  // namespace http
```

### 8.6 QR rendering (`tft_qr` module)

Use the **QRCode library by Richard Moore** (`qrcode` in Arduino library manager). Renders to a 2D array; you paint it onto the TFT as black/white blocks.

Minimum API:

```cpp
namespace tft_qr {
void show(const char* url, const char* caption);  // url ≤ ~120 chars fits version 7 with ECC L
void clear();
}
```

Implementation sketch:

```cpp
#include <qrcode.h>

void show(const char* url, const char* caption) {
    QRCode qr;
    uint8_t qrData[qrcode_getBufferSize(7)];     // version 7 = up to 154 chars at ECC L
    qrcode_initText(&qr, qrData, 7, ECC_LOW, url);

    const int scale = min(tft.width(), tft.height() - 50) / qr.size;
    const int off_x = (tft.width()  - qr.size * scale) / 2;
    const int off_y = 10;

    tft.fillScreen(TFT_WHITE);
    for (int y = 0; y < qr.size; y++) {
      for (int x = 0; x < qr.size; x++) {
        uint16_t c = qrcode_getModule(&qr, x, y) ? TFT_BLACK : TFT_WHITE;
        tft.fillRect(off_x + x*scale, off_y + y*scale, scale, scale, c);
      }
    }

    // Caption below the QR
    tft.setTextColor(TFT_BLACK, TFT_WHITE);
    tft.setTextSize(2);
    tft.setCursor(20, off_y + qr.size * scale + 8);
    tft.print("Scan + enter ");
    tft.print(caption);
}
```

### 8.7 Boot timing budget

| Step | Duration |
|---|---|
| WiFi associate | 0.5–2 s |
| First `/register` HTTP round-trip | ~300 ms |
| QR render on TFT | ~150 ms |
| User scan + log in + click | minutes (human-paced) |
| `/poll-pairing` round-trip | ~150 ms × N polls |
| First WS upgrade | ~200 ms |

Pairing should fit comfortably within the 5-minute code TTL.

### 8.8 Re-pairing trigger from WebSocket close

Inside the WS module's close handler (see `IMPLEMENTATION_WEBSOCKET.md` §4.7):

```cpp
case 4401:  // bad/expired JWT
case 4402:  // device unlinked
    provisioning::clear_jwt();
    ESP.restart();          // simplest path: reboot into pairing mode
    break;
```

(Reboot is fine because a paired session is interactive; the user has to come back anyway.)

---

## 9. Security requirements

All of these are **must-do**, not "nice to have":

| # | Requirement | Rationale |
|---|---|---|
| S1 | All backend endpoints are HTTPS. Lamp uses `WiFiClientSecure` with the bundled CA store. | Prevent MITM and JWT theft. |
| S2 | WebSocket is `wss://` only. | Same. |
| S3 | `device_secret` is hashed at rest (`argon2id`) on the backend. | Database leak doesn't compromise device auth. |
| S4 | `device_secret` is never returned in any API response and never logged. | Prevent accidental exposure. |
| S5 | Pairing codes are single-use and time-bound (5 min). | Limits the attacker's window. |
| S6 | JWTs are signed with HS256 or RS256 using a key in env / secret manager. | Tamper protection. |
| S7 | Revocation list (`devices.revoked_at`) is checked on every WS connect, not cached longer than 60 s. | Unlink takes effect promptly. |
| S8 | Rate limits on `/register`, `/poll-pairing`, `/login`, `/complete-pairing`. | Prevent brute force and DoS. |
| S9 | The `pair/[code]` page requires login before rendering anything device-specific. | Prevents an attacker who guesses a code from learning device metadata. |
| S10 | User passwords stored as `argon2id`. Never plaintext. | Standard. |
| S11 | Sessions use HttpOnly, Secure, SameSite=Lax cookies. | Mitigate XSS / CSRF. |
| S12 | CSRF tokens on state-changing POSTs from the frontend (built into NextAuth / Auth.js by default). | Standard. |
| S13 | Logs scrub `device_secret`, `device_jwt`, `password`, `pairing_code`. | Prevent leak into log aggregation. |

---

## 10. Edge cases and failure modes

| # | Scenario | System behaviour |
|---|---|---|
| 1 | User scans QR but never logs in | Code expires after 5 min. Lamp shows "Pairing expired, reboot to retry." User can reboot lamp to get a new code. |
| 2 | Two users scan the same QR at the same time | The first `POST /complete-pairing` wins (DB unique check on `pairing_codes.status` change inside a transaction). The second gets 409. |
| 3 | User pairs lamp, then gives lamp to a friend | Original user must `/devices` → Unlink before friend can pair. If not, friend's `/register` returns 409 and lamp shows "already linked, ask the previous owner to unlink." |
| 4 | Two lamps with the same `device_id` (cloning attack) | Backend rejects `/register` because `device_secret` doesn't match the stored hash. Lamp gets 401 and halts with "device credentials invalid." |
| 5 | Lamp lost WiFi during pairing | HTTP calls fail. Lamp retries `/register` after WiFi reconnects, gets a fresh pairing code, re-displays QR. |
| 6 | Lamp lost WiFi after pairing | `device_jwt` still in NVS. Lamp reconnects and resumes WS automatically. |
| 7 | Backend `device_jwt` signing secret rotated | All existing JWTs invalidated. Lamps get 4401 on next WS connect → clear_jwt → re-pair. User experience: "Your lamp needs to be relinked." Painful — only rotate the secret when you have to. |
| 8 | NVS corruption (rare) | Lamp loses everything, generates new device_id + secret on next boot. Old `devices` row remains in DB but unreachable (different secret). Run a periodic cleanup or leave orphans. |
| 9 | Backend database fail mid-`complete-pairing` | Transaction rolls back. Frontend sees 5xx. User retries (code is still valid, lamp is still polling). |
| 10 | User deletes their account in Clerk | Clerk sends `user.deleted` webhook → backend sets `devices.user_id=NULL` and `revoked_at=now()` for every device of that user → Redis pub/sub closes any live WS with 4402 → lamps wipe JWT and re-enter pairing mode. |
| 11 | Clerk is down | Frontend can't sign in (Clerk hosts the auth UI) and can't refresh tokens. Backend-facing API calls returning 401 are correctly surfaced. **Lamps already paired keep working** because the WebSocket only checks `device_jwt`, which is signed by the Python backend, not Clerk. The lamp is unaffected by a Clerk outage as long as the Python backend stays up. |

---

## 11. WebSocket protocol additions

Two and only two changes to `IMPLEMENTATION_WEBSOCKET.md`:

### 11.1 `STATE` enum gains value `0x05`

| Value | Meaning | LED |
|---|---|---|
| `0x05` | unpaired | red strobe |

Sent by backend if it decides mid-session that the device is no longer authorized (e.g. just before closing with 4402). The device reacts the same way as a 4402 close.

### 11.2 Close code `4402` added

| Code | Meaning | Lamp action |
|---|---|---|
| `4402` | Device unlinked | `provisioning::clear_jwt(); ESP.restart();` |

Listed in the close-codes table in WS doc §4.7.

No other protocol changes. The 11 frame types stand as-is.

---

## 12. Test plan

Tests are grouped per-component so each team can verify their own piece.

### 12.1 Backend tests (Python; pytest + httpx + testcontainers-postgres)

| ID | Test | Method |
|---|---|---|
| B1 | `/register` creates device on first call, returns code | unit |
| B2 | `/register` is idempotent on second call with same secret | unit |
| B3 | `/register` 401 on wrong secret | unit |
| B4 | `/register` rate-limited | integration (loop) |
| B5 | `/poll-pairing` returns "pending" before user click | unit |
| B6 | `/poll-pairing` returns "paired" + jwt after user click; row deleted | unit |
| B7 | `/poll-pairing` 401 on wrong secret | unit |
| B8 | `/complete-pairing` requires a valid Clerk session token | integration (mock the Clerk SDK) |
| B9 | `/complete-pairing` 409 if device already linked | unit |
| B10 | `/complete-pairing` writes paired_at and devices.user_id = clerk_user_id | unit |
| B11 | `/devices` returns only the caller's devices (filtered by Clerk user id) | integration |
| B12 | `/unlink` sets revoked_at and publishes `device:revoked:<id>` on Redis | integration |
| B13 | `device_jwt` signed with HS256, verifiable by the WS gateway using `DEVICE_JWT_SECRET` | unit |
| B14 | Revoked device_jwt → WS connect closed with 4402 | integration |
| B15 | `/api/clerk/webhook` with `user.deleted` payload (signed via Svix) → all that user's devices are revoked | integration |
| B16 | `/api/clerk/webhook` with wrong Svix signature → 400 | unit |

### 12.2 Frontend tests (Playwright / Cypress)

| ID | Test |
|---|---|
| F1 | Not signed in → visiting `/pair/ABC123` redirects to `/sign-in?redirect_url=/pair/ABC123` via Clerk middleware |
| F2 | Signed in → `/pair/[code]` renders device info; `Authorization: Bearer <Clerk token>` is sent on the API call |
| F3 | "Link this lamp" button hits `/complete-pairing` and shows success |
| F4 | Expired code shows the CODE_EXPIRED error panel |
| F5 | Already-paired code shows the ALREADY_PAIRED error panel |
| F6 | `/devices` lists the user's lamps with correct online state |
| F7 | Rename inline edit updates the friendly name |
| F8 | Unlink confirm dialog → row removed |
| F9 | Sign-up via Clerk → email verification → land on `/devices` |
| F10 | Google OAuth sign-in via Clerk → land on `/devices` (if enabled in Clerk dashboard) |

### 12.3 Firmware tests

| ID | Test |
|---|---|
| L1 | First boot generates and persists device_id + device_secret in NVS |
| L2 | Second boot reuses the same device_id + device_secret |
| L3 | `ensure_paired()` returns true if device_jwt is present |
| L4 | `ensure_paired()` runs full pairing flow if device_jwt is absent |
| L5 | QR rendered on TFT is scannable (manual visual test) |
| L6 | Pairing code TTL expires → lamp shows error and halts |
| L7 | After pairing, `device_jwt` is in NVS and reused on reboot |
| L8 | WS close 4402 → JWT wiped → next boot enters pairing |
| L9 | `factory_reset()` wipes everything → fresh device_id next boot |

### 12.4 End-to-end happy path (manual)

1. Flash a fresh ESP32. Boot. Verify TFT shows a QR.
2. Open the URL on a phone. Sign up (or log in).
3. Confirm "Link this lamp". Expect confetti + redirect to `/devices`.
4. Phone shows the lamp online.
5. Speak "hey lumos" — verify normal WS turn happens.
6. On `/devices`, click "Unlink". Phone should remove the lamp.
7. Lamp's WS receives 4402, wipes JWT, reboots, shows QR again.

---

## 13. Prerequisite: WiFi provisioning (brief)

Pairing assumes the lamp is on WiFi. The simplest v1 path:

1. On boot, if `wifi_ssid` is absent in NVS → start `WiFiManager` (Arduino library by tzapu).
2. Lamp creates open AP `Lumos-Setup`. TFT shows "Connect to Lumos-Setup WiFi, then visit 192.168.4.1".
3. User joins the AP from their phone, captive portal opens, picks their home WiFi, enters password.
4. Lamp stores SSID+password in NVS, reboots, joins the real WiFi.
5. Pairing flow (§5.1) begins on next boot.

This is a separate, well-trodden problem; `WiFiManager` solves it in ~5 lines. Document it under a separate `IMPLEMENTATION_WIFI_PROVISIONING.md` if you want full spec coverage.

---

## 14. Phasing — what's optional for v1

| Feature | v1 | v2+ |
|---|---|---|
| Email + password signup/login | ✅ | refine |
| OAuth (Google / GitHub) | ✅ recommended | — |
| Pairing via QR | ✅ | — |
| 6-character manual fallback code | ✅ (cheap to add) | — |
| Lamp friendly-name rename | ✅ | — |
| Unlink | ✅ | — |
| `/devices` page | ✅ | — |
| Password reset email | nice to have | ✅ |
| 2FA | ❌ | optional |
| Multi-user lamp / family sharing | ❌ | possibly |
| Per-feature scopes / permissions | ❌ | possibly |
| Audit log of pairing events | ❌ | useful for support |

---

## 15. Open questions and future work

1. **OAuth providers**: which to support first? Google has the broadest reach for a tutor product (parents) but Clerk/Auth.js make it equally easy.
2. **Email verification**: gate full account access on verified email? Probably yes for a paid product. Out of scope for v1.
3. **Password reset**: needs email-sending infra (Resend, SendGrid). Decide before launch.
4. **Hardware secure storage**: ESP32-S3 supports flash encryption + secure boot. Worth enabling for production hardware so NVS contents (including `device_secret` and `device_jwt`) can't be dumped via JTAG. Adds factory-provisioning complexity.
5. **Self-generated device_secret vs factory-burned**: v1 uses self-generated (simpler). Hardened production should burn unique secrets per device at manufacturing time and pre-populate the `devices` table. Out of scope here.
6. **Multi-user lamp**: e.g. parent + child both authorized. Solvable with an `authorizations` join table; not v1.
7. **Audit log**: pairing events, unlinks, login attempts — needed once you have real users for support. Add a generic `events` table later.

---

## 16. Glossary

| Term | Meaning |
|---|---|
| `device_id` | Stable lamp identifier, derived from MAC. e.g. `lamp-7C9EB42F`. |
| `device_secret` | 32-byte random secret known only to the lamp and the Python backend. |
| `pairing_code` | Short, single-use, 5-minute code bridging a lamp and a user during pairing. |
| `device_jwt` | Long-lived, **Python-backend**-signed JWT the lamp sends to the WebSocket. Has nothing to do with Clerk. |
| **Clerk session token** | Short-lived JWT minted by Clerk in the user's browser. Sent by the **frontend** to the **Python backend** as `Authorization: Bearer`. Verified server-side via the Clerk SDK. Never seen by the lamp. |
| **Clerk user ID** | String identifier like `user_2abc…` that Clerk assigns to each account. Stored verbatim in `devices.user_id` as the canonical owner reference. |
| **Clerk webhook** | Svix-signed POST from Clerk to the Python backend (`/api/clerk/webhook`). Carries `user.created` / `user.deleted` / `user.updated` events. |
| NVS | Non-volatile storage on the ESP32 (key-value flash partition). |
| Pairing | The one-time act of binding a physical lamp to a Clerk user account. |
| Unlink | Reverse of pairing. Lamp loses its device_jwt and re-enters pairing. |
| Factory reset | Wipe device_id + device_secret + device_jwt; generate fresh ones on next boot. |
| WS | WebSocket. See `IMPLEMENTATION_WEBSOCKET.md`. |

---

## 17. Quick reference — endpoint cheat sheet

```
Python backend endpoints
                              auth                  caller     success
─────────────────────────────────────────────────────────────────────────────
POST /api/device/register     device_secret in body lamp       200 {pairing_code, url, ttl}
POST /api/device/poll-pairing device_secret in body lamp       200 {status} or {status, jwt}
GET  /api/pairing-info/{code} Clerk session Bearer  frontend   200 {device_id, name, exp}
POST /api/device/complete-    Clerk session Bearer  frontend   200 {device_id, name}
       pairing
GET  /api/devices             Clerk session Bearer  frontend   200 {devices: [...]}
POST /api/device/{id}/unlink  Clerk session Bearer  frontend   204
POST /api/device/{id}/rename  Clerk session Bearer  frontend   200 {device_id, name}
POST /api/clerk/webhook       Svix signature        Clerk      200 (no body)
WSS  /lamp/ws                 device_jwt Bearer     lamp       101 Switching Protocols

Clerk-hosted (NOT in our backend)
─────────────────────────────────────────────────────────────────────────────
signup / login / OAuth / password reset / email verification / logout / session
  → handled by <SignIn>, <SignUp>, <UserButton>, <UserProfile> components
  → no Python endpoint needed
```

```
WebSocket changes:
  STATE enum:  0x05 = unpaired  (new)
  Close code:  4402 = device unlinked  (new)
  Everything else: unchanged from IMPLEMENTATION_WEBSOCKET.md
```

---

## 18. Integration Playbooks

The reference sections above (§6 backend, §7 frontend, §8 firmware) define
the **contract**. The three subsections below are the **build order** for
each team — opinionated, concrete, and meant to be runnable top-to-bottom.
Each step ends with a verification cue.

> Backend team → §18.1.  Frontend team → §18.2.  Firmware team → §18.3.
> Each subsection is self-contained: you can hand only that subsection to
> the team that owns it.

---

### 18.1 Backend integration playbook (Python + FastAPI + Clerk)

**Goal:** a deployed Python backend that satisfies §6 (endpoints, schema,
`device_jwt`, rate limits, Clerk webhook) and §11 (WS protocol additions).

**Stack:** FastAPI + uvicorn + SQLAlchemy async + Postgres (Neon/Supabase) +
Upstash Redis + Clerk Python SDK + Svix + `python-jose` + `argon2-cffi`.

**The lamp NEVER touches Clerk.** This backend is the only thing that
verifies Clerk tokens; the lamp only ever sees the `device_jwt` we mint.

#### B1. Project layout
```
lumos-backend/
  app/
    main.py                  # FastAPI app + routes registration
    config.py                # env vars (pydantic-settings)
    db.py                    # SQLAlchemy engine, session dep
    models.py                # Device, PairingCode SQLAlchemy models
    schemas.py               # Pydantic request/response models
    deps/
      clerk.py               # Clerk session verifier dependency
      device.py              # device_secret verifier dependency
      ratelimit.py           # slowapi limiter
    routes/
      device_lamp.py         # /register, /poll-pairing (device-auth)
      device_user.py         # /devices, /complete-pairing, /unlink, /rename
      pairing_info.py        # /pairing-info/{code}
      clerk_webhook.py       # /clerk/webhook
      ws.py                  # WebSocket /lamp/ws
    services/
      device_jwt.py          # mint + verify device_jwt
      pairing.py             # business logic for pair flow
      revocation.py          # publish/subscribe device:revoked:*
  alembic/                   # migrations
  tests/
  pyproject.toml
  .env.example
```

#### B2. Dependencies + project init
```bash
poetry init -n          # or pip + requirements.txt; we'll show pip
python -m venv .venv && source .venv/bin/activate
pip install fastapi "uvicorn[standard]" sqlalchemy[asyncio] asyncpg alembic \
            clerk-backend-sdk svix python-jose[cryptography] argon2-cffi \
            "redis[hiredis]" slowapi nanoid pydantic-settings python-dotenv
```

**Verify:** `uvicorn app.main:app --reload` boots an empty FastAPI app on
:8000 and `/docs` shows Swagger UI.

#### B3. Env vars (`.env`)
```
DATABASE_URL=postgresql+asyncpg://user:pass@host/db
REDIS_URL=rediss://default:pass@host:6379

CLERK_SECRET_KEY=sk_test_…              # from Clerk dashboard → API Keys
CLERK_WEBHOOK_SECRET=whsec_…             # from Clerk dashboard → Webhooks → Signing secret

DEVICE_JWT_SECRET=<openssl rand -base64 64>     # OUR secret, not Clerk's
DEVICE_JWT_ISS=lumos-auth
FRONTEND_BASE_URL=https://app.example.com       # used to build pairing_url
PAIRING_CODE_TTL_SEC=300
```
**Verify:** `python -c "from app.config import settings; print(settings)"`
loads all values from `.env`.

#### B4. Database
- Create a Postgres database (Neon or Supabase).
- Initialise Alembic: `alembic init alembic`.
- Define `Device` and `PairingCode` SQLAlchemy models matching §6.2.
- Generate + apply migration:
  `alembic revision --autogenerate -m "init" && alembic upgrade head`.

**Verify:** psql `\d devices` shows the columns from §6.2.

#### B5. `device_jwt` signer
`app/services/device_jwt.py`:
```python
from jose import jwt
from app.config import settings
import time

ALG = "HS256"

def sign_device_jwt(device_id: str, clerk_user_id: str) -> str:
    payload = {
        "sub": device_id,
        "uid": clerk_user_id,
        "iat": int(time.time()),
        "iss": settings.DEVICE_JWT_ISS,
        "ver": 1,
    }
    return jwt.encode(payload, settings.DEVICE_JWT_SECRET, algorithm=ALG)

def verify_device_jwt(token: str) -> dict:
    return jwt.decode(token, settings.DEVICE_JWT_SECRET,
                      algorithms=[ALG], issuer=settings.DEVICE_JWT_ISS)
```

**Verify:** unit test mints then verifies a JWT and asserts the claims.

#### B6. Clerk session verifier dependency
`app/deps/clerk.py`:
```python
from fastapi import Depends, HTTPException, Request
from clerk_backend_api import Clerk
from clerk_backend_api.jwks_helpers import (
    authenticate_request, AuthenticateRequestOptions
)
from app.config import settings

clerk = Clerk(bearer_auth=settings.CLERK_SECRET_KEY)

async def current_clerk_user(request: Request) -> str:
    state = clerk.authenticate_request(
        request,
        AuthenticateRequestOptions(
            authorized_parties=[settings.FRONTEND_BASE_URL],
        ),
    )
    if not state.is_signed_in:
        raise HTTPException(status_code=401, detail={
            "error": "not logged in", "code": "USER_AUTH_FAIL"
        })
    return state.payload["sub"]            # Clerk user ID, e.g. "user_2abc…"
```

Use as: `clerk_user_id: str = Depends(current_clerk_user)` on every
frontend-facing route.

**Verify:** unit test with a known-good Clerk JWT (use a test instance) →
returns the user ID. Bad/missing token → 401.

#### B7. Device-auth dependency
`app/deps/device.py`:
```python
from fastapi import HTTPException
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

ph = PasswordHasher()

async def verify_device(db, device_id: str, device_secret: str) -> bool:
    row = await db.get(Device, device_id)
    if row is None:
        return False     # caller handles 401 OR creates on first /register
    try:
        ph.verify(row.device_secret_hash, device_secret)
        return True
    except VerifyMismatchError:
        return False
```

Used inline by `/register` and `/poll-pairing`. Not a FastAPI `Depends`
because both endpoints receive the secret in the JSON body, not a header.

#### B8. Lamp-facing endpoints (`device_lamp.py`)
Implement per §6.1.1 and §6.1.2:

- `POST /api/device/register`: argon2-hash the secret on first contact,
  upsert `devices`, generate a 6-char pairing code with
  `nanoid.generate("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 6)`, insert
  `pairing_codes` with `expires_at = now() + 5 min`. Return code + URL.
- `POST /api/device/poll-pairing`: verify secret, SELECT pairing_codes by
  code, branch on `status`. Delete the row right after returning `paired`.

Wire `slowapi` rate limits per §6.5.

**Verify:** the mock-lamp script (B12) gets a code on `/register` and
sees `{status: "pending"}` on subsequent polls.

#### B9. Frontend-facing endpoints (`device_user.py`, `pairing_info.py`)
Each route depends on `current_clerk_user`:

- `GET /api/pairing-info/{code}` → §6.1.3
- `POST /api/device/complete-pairing` → §6.1.4. Wrap in `async with db.begin():` for transactional safety; use `SELECT ... FOR UPDATE` on the pairing_codes row.
- `GET /api/devices` → §6.1.5, `WHERE user_id = clerk_user_id`.
- `POST /api/device/{device_id}/unlink` → §6.1.6. After UPDATE, `await redis.publish("device:revoked:" + device_id, "1")`.
- `POST /api/device/{device_id}/rename` → §6.1.7.

**Verify:** frontend tests F1–F8 (§12.2) pass against this backend.

#### B10. Clerk webhook (`clerk_webhook.py`)
```python
from fastapi import APIRouter, Request, HTTPException
from svix.webhooks import Webhook, WebhookVerificationError
from app.config import settings

router = APIRouter()

@router.post("/api/clerk/webhook")
async def clerk_webhook(request: Request, db = Depends(get_db),
                        redis = Depends(get_redis)):
    payload = await request.body()
    headers = {
        "svix-id":        request.headers["svix-id"],
        "svix-timestamp": request.headers["svix-timestamp"],
        "svix-signature": request.headers["svix-signature"],
    }
    try:
        event = Webhook(settings.CLERK_WEBHOOK_SECRET).verify(payload, headers)
    except WebhookVerificationError:
        raise HTTPException(400)

    if event["type"] == "user.deleted":
        clerk_user_id = event["data"]["id"]
        # revoke all of this user's devices
        rows = await db.execute(
            "UPDATE devices SET revoked_at = now(), user_id = NULL "
            "WHERE user_id = :uid RETURNING device_id",
            {"uid": clerk_user_id})
        for (device_id,) in rows:
            await redis.publish(f"device:revoked:{device_id}", "1")
        await db.commit()

    return {"ok": True}
```
Set the webhook URL in the Clerk dashboard to point at this endpoint and
subscribe to `user.deleted` (at minimum).

**Verify:** test B15 — delete a test user in Clerk dashboard, watch the
backend logs revoke all that user's devices.

#### B11. WebSocket gateway (`ws.py`)
```python
from fastapi import WebSocket, WebSocketDisconnect
from app.services.device_jwt import verify_device_jwt

@app.websocket("/lamp/ws")
async def lamp_ws(ws: WebSocket):
    auth = ws.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        await ws.close(code=4401); return
    try:
        claims = verify_device_jwt(auth[7:])
    except Exception:
        await ws.close(code=4401); return

    row = await db.get(Device, claims["sub"])
    if (row is None or row.revoked_at is not None
            or row.user_id is None or row.user_id != claims["uid"]):
        await ws.close(code=4402); return

    await ws.accept()
    # subscribe to device:revoked:<id> on a side task; close 4402 if it fires
    # (use asyncio.create_task with the redis pubsub client)
    # ... dispatch IMAGE_JPEG / AUDIO_CHUNK / AUDIO_END frames
```

Subscribe to `device:revoked:*` on Redis pub/sub; close any matching open
socket with 4402 the moment the user clicks "Unlink" in the frontend.

**Verify:** test B14 passes (revoked JWT → 4402 within ~1 s of unlink).

#### B12. Local dev harness — `scripts/mock_lamp.py`
```python
import asyncio, httpx, secrets, json

URL = "http://localhost:8000"
ID  = "lamp-MOCKED"
SEC = secrets.token_hex(32)               # 64 hex chars

async def main():
    async with httpx.AsyncClient() as c:
        reg = (await c.post(f"{URL}/api/device/register",
               json={"device_id": ID, "device_secret": SEC})).json()
        print("pair at:", reg["pairing_url"])
        for _ in range(100):
            await asyncio.sleep(3)
            p = (await c.post(f"{URL}/api/device/poll-pairing",
                   json={"device_id": ID, "device_secret": SEC,
                         "pairing_code": reg["pairing_code"]})).json()
            print(p)
            if p.get("status") == "paired":
                print("JWT:", p["device_jwt"]); break

asyncio.run(main())
```
Useful for development without flashing a real lamp.

#### B13. Deploy
- **Backend host:** Render / Railway / Fly.io / Cloud Run. They each
  speak "uvicorn app.main:app --host 0.0.0.0 --port $PORT" out of the box.
- **Postgres:** Neon / Supabase / RDS — set `DATABASE_URL`.
- **Redis:** Upstash — set `REDIS_URL`.
- Env vars: everything from B3.
- Configure Clerk webhook URL to point at production
  `/api/clerk/webhook` and re-paste the signing secret into Clerk dashboard.
- Make sure CORS allows the Next.js production origin (`FRONTEND_BASE_URL`).

**Verify:** `curl https://your-backend.example.com/api/device/register \
  -d '{"device_id":"…","device_secret":"…"}' \
  -H "Content-Type: application/json"` returns a 200 with a pairing code.

#### B14. Acceptance
Run the B-prefixed tests in §12.1 (pytest). All must pass.

---

### 18.2 Frontend integration playbook (Next.js + Clerk)

**Goal:** a deployed Next.js frontend that uses **Clerk** for all human
auth and talks to the **Python backend** (§18.1) for device operations.

The frontend never touches: the lamp directly, the Postgres DB, the
device_jwt. It only ever does (a) Clerk calls via the SDK and (b) authed
`fetch` to the Python backend.

#### F1. Scaffold
```bash
npx create-next-app@latest lumos-frontend --typescript --app --tailwind
cd lumos-frontend
npm i @clerk/nextjs @tanstack/react-query react-confetti zod
npx shadcn-ui@latest init     # optional — the wireframes assume shadcn/ui
```

**Verify:** `npm run dev` serves the default Next page on :3000.

#### F2. Clerk: create app + env vars
1. Go to clerk.com → create a new application.
2. Enable the auth methods you want (Email/Password, Google OAuth, etc.) in
   "User & Authentication → Email, Phone, Username" and "Social connections".
3. Copy the **Publishable key** and **Secret key** from "API Keys".
4. In `.env.local`:
   ```
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…
   CLERK_SECRET_KEY=sk_test_…
   NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8000

   NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
   NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
   NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/devices
   NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/devices
   ```

#### F3. Clerk: middleware + provider + auth pages
Create `middleware.ts`:
```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher([
  "/devices(.*)", "/pair(.*)", "/account(.*)",
]);

export default clerkMiddleware((auth, req) => {
  if (isProtected(req)) auth().protect();
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
```

Wrap the app in `app/layout.tsx`:
```tsx
import { ClerkProvider } from "@clerk/nextjs";

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html><body>{children}</body></html>
    </ClerkProvider>
  );
}
```

Add the catch-all sign-in / sign-up pages:
```tsx
// app/sign-in/[[...sign-in]]/page.tsx
import { SignIn } from "@clerk/nextjs";
export default function Page() { return <SignIn />; }

// app/sign-up/[[...sign-up]]/page.tsx
import { SignUp } from "@clerk/nextjs";
export default function Page() { return <SignUp />; }
```

**Verify:** visiting `/sign-in` shows Clerk's hosted UI; completing signup
lands on `/devices` (which 404s for now — that's expected).

#### F4. API client wrapping the Clerk token
Create `lib/useApi.ts` exactly as §7.4. Every backend call goes through it
so the Clerk session token is always attached.

Create `app/providers.tsx` wrapping `<QueryClientProvider>` and put it
inside `<ClerkProvider>` in the root layout.

**Verify:** a test page that calls `useApi().call("/api/devices")` returns
the devices list when signed in, and 401 when signed out.

#### F5. `/pair/[code]` — the critical page
File: `app/pair/[code]/page.tsx`. Behaviour: §7.2.

Clerk middleware (F3) handles the "not signed in → bounce to /sign-in"
case automatically. All four error states (§7.5) must be implemented:

| Backend response | UI |
|---|---|
| 200 | Card + countdown + "Link" button |
| 404 CODE_NOT_FOUND | "We couldn't find that lamp" |
| 410 CODE_EXPIRED | "This pairing code expired" |
| 409 ALREADY_PAIRED | "This lamp is already linked to another account" |

The countdown timer should client-side flip to the CODE_EXPIRED panel when
it hits 0 (no page reload).

**Verify:** simulate each error state manually (see F7).

#### F6. `/devices` page
File: `app/devices/page.tsx`. Behaviour: §7.3.

- `useDevices()` with `refetchInterval: 30_000`.
- Online = `last_seen_at` within 60 s.
- Inline rename → `POST /api/device/[id]/rename` → optimistic update.
- Unlink → `<AlertDialog>` confirm → mutation → optimistic remove.

Include the empty state: "Add a new lamp — plug in your lamp, scan the QR,
tap Link in the page that opens."

**Verify:** when the lamp is online, the green dot shows; clicking Unlink
removes the row immediately (optimistic) and within ~1 s the lamp's WS
disconnects (close 4402) and re-enters pairing mode.

#### F7. `/account` page
Just embed Clerk's component:
```tsx
import { UserProfile } from "@clerk/nextjs";
export default function Page() { return <UserProfile />; }
```
That covers email change, password change, OAuth account linking, delete
account. Zero custom code.

#### F8. Header + sign-out
Drop `<UserButton afterSignOutUrl="/" />` from `@clerk/nextjs` into the
header of every authed page. It handles the avatar menu and sign-out.

#### F9. Visual QA on `/pair/[code]`
| Case | How to simulate |
|---|---|
| Not signed in | Open `/pair/AAA111` in an incognito window — should land on Clerk sign-in with redirect_url back |
| Code not found | Visit `/pair/ZZZ999` (a code never issued) |
| Code expired | Run `mock_lamp.py`, copy the URL, wait > 5 minutes, click |
| Already paired | Pair a lamp once, then open the same code again |
| Success | Run the full happy path and watch the confetti + redirect |

#### F10. Configure Clerk for production
- Add your production domain to Clerk dashboard → "Domains".
- Set production env vars in Vercel: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
  `CLERK_SECRET_KEY`, `NEXT_PUBLIC_BACKEND_BASE_URL`, the sign-in/up URLs.
- In the Clerk dashboard → Webhooks, point the webhook at your **Python
  backend's** production URL (`https://api.example.com/api/clerk/webhook`)
  and subscribe to `user.deleted`. Copy the signing secret into the Python
  backend's `CLERK_WEBHOOK_SECRET`.

#### F11. Deploy
- `vercel deploy --prod`.
- Confirm `NEXT_PUBLIC_BACKEND_BASE_URL` points at the production Python
  backend (and CORS on the Python side allows the frontend's domain).
- Confirm lamp firmware's `PROVISIONING_BACKEND_URL` and `NET_WS_URL` point
  at the same Python backend. Reflash lamps if needed.

#### F12. Acceptance
Run all F-prefixed tests in §12.2 (Playwright). All must pass.

---

### 18.3 Firmware integration playbook

**Goal:** the lamp boots, ensures it is paired, and connects to the
Python backend's WebSocket using its `device_jwt`. **All firmware-side
modules are already in place** — the playbook below is for verification,
backend URL configuration, and the remaining hardening tasks (production
TLS, factory-reset button).

> **Clerk reminder:** the firmware does **not** know Clerk exists. There
> is no Clerk URL, no Clerk SDK, no Clerk token anywhere in `tutor_lamp/`.
> All this module knows is the Python backend's HTTPS + WSS URLs and the
> JWT signed by that backend.

#### Current state

| File | Status | What it covers |
|---|---|---|
| `tutor_lamp/provisioning.h` / `.cpp` | ✅ shipped | MAC-derived `device_id`, 32-byte random `device_secret`, NVS storage, HTTPS `/register` + `/poll-pairing`, JWT save, `clear_jwt()`, `factory_reset()` |
| `tutor_lamp/tft_qr.h` / `.cpp` | ✅ shipped | QR + caption rendering on the TFT |
| `tutor_lamp/net_ws.h` / `.cpp` | ✅ shipped | Persistent `wss://` with `Authorization: Bearer <device_jwt>`, 11-frame protocol, FreeRTOS TX queue, exp-backoff reconnect, ping heartbeat |
| `tutor_lamp/tutor_lamp.ino` | ✅ shipped | `setup()` calls `ensure_paired()` then `net::begin/connect`. `on_cleaned_frame` streams `AUDIO_CHUNK`. `MODE_SENDING` sends `AUDIO_END`. Inbound `STATE(0x05)` → `clear_jwt()` + restart. |
| `tutor_lamp/buttons.{h,cpp}` | ⬜ not yet | When created, long-press → `provisioning::factory_reset(); ESP.restart();` |
| Hardware CA bundle for production TLS | ⬜ pending | Currently `PROVISIONING_TLS_INSECURE=1` and `NET_WS_TLS_INSECURE=1` (dev defaults). Flip to 0 + CA bundle before release. |

The lamp already runs the full pairing flow end-to-end against any
properly configured Python backend.

#### L1. Install libraries
Arduino IDE → Sketch → Include Library → Manage Libraries:

- **ArduinoJson** by Benoît Blanchon (v6.x or v7.x; both supported).
- **QRCode** by Richard Moore (the one exposing `qrcode_initText`).
- **ArduinoWebsockets** by Gil Maimon (≥ 0.5.4).
- **TFT_eSPI** by Bodmer — already installed for `image_viewer`.

**Verify:** the sketch compiles. (Headers are already `#include`d in the
shipped files; you just need the libraries available.)

#### L2. Configure the Python-backend URLs
Edit `tutor_lamp/provisioning.h`:

```cpp
#define PROVISIONING_BACKEND_URL "https://api.your-domain.com"
```

Edit `tutor_lamp/net_ws.h`:

```cpp
#define NET_WS_URL "wss://api.your-domain.com/lamp/ws"
```

Both must point at the **same Python backend**. Neither has anything to do
with Clerk. For dev against a self-signed HTTPS server, leave the
`*_TLS_INSECURE` macros at their default `1`.

**Verify:** flash, watch serial — `[prov] connecting api.your-domain.com`
should appear, and a 200 response from `/api/device/register` should
arrive within a second.

#### L3. ino already wired — verify the end-to-end happy path
Nothing to add to `tutor_lamp.ino`. The following is the wiring that
already exists in the shipped file; do NOT add it again:

```cpp
#include "provisioning.h"
#include "net_ws.h"

// in setup() after WiFi.begin():
if (!provisioning::ensure_paired()) { /* halt with red strobe */ }
net::begin(NET_WS_URL, provisioning::device_jwt());
net::on_frame(handle_server_frame);
net::connect();

// in on_cleaned_frame, while pipeline_mode == MODE_COMMAND:
net::send_frame(net::FRAME_AUDIO_CHUNK, (const uint8_t*)samples, n*2);

// in MODE_SENDING:
net::send_frame(net::FRAME_AUDIO_END);

// in handle_server_frame on STATE(0x05):
provisioning::clear_jwt();
ESP.restart();
```

**Verify (end-to-end happy path):**
1. Flash a fresh ESP32. Serial: `[prov] no credentials in NVS — generating new pair`.
2. TFT shows a QR.
3. Scan with your phone → land on `/pair/[code]` (Clerk middleware redirects to `/sign-in` if not authed; sign in via Clerk; bounce back).
4. Click "Link this lamp" → confetti + redirect to `/devices`.
5. Within 3 s the lamp serial shows `[prov] ✓ paired` and `[net] WS opened`.
6. Say "hey lumos" → red breathing LED → `AUDIO_CHUNK` frames stream out (visible in backend logs).
7. Click "Unlink" on the frontend → within ~1 s the lamp serial shows `[net] WS closed` and the QR re-appears.

#### L4. (Already done) JWT is passed to the WebSocket
`net::begin(NET_WS_URL, provisioning::device_jwt())` is already in the
shipped `setup()`. Nothing to add.

#### L5. (Already done) STATE(0x05) → clear_jwt + restart
The shipped `handle_server_frame()` in `tutor_lamp.ino` already does:

```cpp
case net::FRAME_STATE:
    if (payload[0] == 0x05) {
        provisioning::clear_jwt();
        ESP.restart();
    }
    break;
```

**Verify:** click "Unlink" in the frontend → backend publishes
`device:revoked:<id>` → WS gateway closes the live socket → backend can
optionally send `STATE(0x05)` before closing → lamp wipes JWT and reboots
back into pairing mode.

#### L6. (Pending) handle pure WS close code 4401/4402 without a preceding STATE
Today, if the backend closes with code 4401/4402 *without* first sending a
`STATE(0x05)` frame, the lamp will simply reconnect with the same (bad)
JWT and loop in BACKOFF. There are two ways to fix this — pick one when
the close-code path is needed:

A) **Backend convention** — always send `STATE(0x05)` before closing on
   auth/unlink. Easy to enforce server-side.
B) **Firmware extension** — extend `net_ws.cpp` `on_ws_event` to parse the
   close code from the library's reason string and call
   `provisioning::clear_jwt(); ESP.restart();` on 4401/4402.

For v1, (A) is sufficient because `/api/device/{id}/unlink` is the only
path that revokes JWTs and the backend controls the close sequence.

#### L7. (Pending) factory-reset long-press
When a `buttons.{h,cpp}` module lands, wire a 10-second long-press to:

```cpp
provisioning::factory_reset();
ESP.restart();
```

This wipes `device_id`, `device_secret`, AND `device_jwt`. Use it when a
user gives the lamp to someone else without going through the frontend
"Unlink" flow.

#### L8. Production hardening (before shipping real hardware)
- Set `PROVISIONING_TLS_INSECURE = 0` in `provisioning.h` AND
  `NET_WS_TLS_INSECURE = 0` in `net_ws.h`.
- Supply the Arduino-ESP32 root CA bundle. Uncomment
  `setCACertBundle(...)` in `provisioning.cpp`; do the equivalent in
  `net_ws.cpp` (use `setCACertBundle` on the underlying
  `WiFiClientSecure` if the library exposes it, or set the CA per host).
- Enable ESP32-S3 **flash encryption** + **secure boot** so NVS contents
  (`device_secret`, `device_jwt`) can't be dumped via JTAG.
- Consider migrating from self-generated `device_secret` to factory-burned
  per §15 — adds a factory step but defeats cloning.

#### L9. Acceptance
Run all L-prefixed tests in §12.3 and the manual end-to-end happy path
in §12.4. All must pass.

If the QR is too small to scan reliably on your specific TFT panel, tweak
`QR_VERSION` (try `5` for shorter URLs) and `TFT_ROT` constants at the top
of `tft_qr.cpp` until it scans on the first try from arm's length.

---

### 18.4 Cross-team integration checklist

Once all three teams have completed their playbooks, verify the seams:

| # | Check | How |
|---|---|---|
| X1 | Lamp registers against the Python backend | Watch Python backend logs as a fresh ESP32 boots — should show `POST /api/device/register` returning 200 with a pairing code. |
| X2 | QR opens the correct frontend page | Scan the QR — phone should land on `/pair/[code]` on the production Next.js URL. |
| X3 | Clerk auth gate works on `/pair/[code]` | If not signed in, you land on Clerk's `/sign-in` page; after signing in via Clerk you bounce back to `/pair/[code]`. |
| X4 | Frontend → backend with Clerk session token | Inspect the network tab: `GET /api/pairing-info/...` and `POST /api/device/complete-pairing` carry `Authorization: Bearer <Clerk JWT>`. Python backend logs show `current_clerk_user` returning the right user ID. |
| X5 | Pairing completes end-to-end | After clicking "Link", lamp's serial log shows `[prov] ✓ paired` within one poll interval. |
| X6 | JWT round-trips into the WebSocket | Lamp's serial shows `[net] WS opened`; backend WS gateway logs the connection with the correct `device_id` and Clerk user ID. |
| X7 | Live audio frames flow | Say "hey lumos" → backend logs receive `AUDIO_CHUNK` frames during MODE_COMMAND and an `AUDIO_END` at EOS. |
| X8 | Unlink propagates from frontend to lamp | Click "Unlink" in `/devices` → backend logs `device:revoked:<id>` published → lamp serial logs the close + reboot → QR re-appears. |
| X9 | `user.deleted` Clerk webhook cascades | Delete a test user in Clerk dashboard → backend webhook fires → all that user's devices are revoked → any live WS closes. |
| X10 | No Clerk secrets in firmware logs | `grep -ri clerk tutor_lamp/` finds zero matches. The lamp truly has no Clerk dependency. |
| X11 | No device secrets in any log | Grep all three sides' logs for the literal `device_secret` value and any 4+ chars from `device_jwt` — should match nothing. |

When all eleven cross-checks pass, the auth + pairing feature is complete.

