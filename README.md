# ClarityAI

ClarityAI is a Next.js study assistant for exam prep. It combines camera-based page understanding, voice interaction, and step-by-step image solving behind authenticated routes.

## Product Modes

- `Live OCR + Voice`
  - Main route: `/live-ocr`
  - Exam-aware tutoring for `CAT`, `GMAT`, `NEET`, `UPSC`, and `JEE`
  - Camera stays on while the student talks or types
  - Optional deep page scan stores OCR memory for the current session
  - Assistant replies stream back token-by-token and can be spoken aloud
- `Send Image`
  - Main route: `/send-image`
  - Upload a question image and receive a full worked solution
  - Follow-up questions continue in a shared conversation panel

## Current Route Map

- `/`
  - Auth-gated landing page with the two primary mode cards
- `/exam-select`
  - Exam picker used before the live tutor flow
- `/live-ocr`
  - Main combined camera, OCR, and voice tutor experience
- `/voice-agent`
  - Compatibility route that now redirects into `/live-ocr`
- `/send-image`
  - Upload-first problem solving flow
- `/sign-in`, `/sign-up`
  - Clerk auth routes

## Stack

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Clerk for authentication
- Supabase for user records and temporary image storage
- Google Gemini via `@google/generative-ai`

## Gemini Integration

The app now uses a live-supported fallback order in [`lib/gemini.ts`](./lib/gemini.ts):

1. `gemini-2.5-flash-lite`
2. `gemini-2.5-flash`
3. `gemini-flash-lite-latest`
4. `gemini-flash-latest`
5. `gemini-2.0-flash-lite`
6. `gemini-2.0-flash`

Important notes:

- The request wrapper now passes `systemInstruction` in the correct Gemini format.
- Older `gemini-1.5-*` fallbacks were removed because they no longer resolve for `generateContent`.
- If you change `GEMINI_API_KEY`, restart the Next.js dev server so the new environment value is picked up.

## Key App Flows

### Live OCR + Voice

1. User signs in.
2. User chooses an exam on `/exam-select`.
3. `/live-ocr?exam=...` opens the camera and the conversation workspace.
4. `useLiveOCRAgent` can:
   - capture the current video frame
   - trigger `/api/ocr` for deep scans
   - send chat turns to `/api/chat` with exam, image, and OCR memory
5. Gemini streams a reply back through SSE.
6. The browser renders the text progressively and reads it aloud when voice output is enabled.

### Send Image

1. User uploads a file on `/send-image`.
2. The image is compressed client-side before upload.
3. `/api/image` validates the file, uploads a temporary copy to Supabase, and streams the first solution.
4. Follow-up turns use `/api/chat` through the shared conversation panel.

## API Routes

- `/api/chat`
  - Auth required
  - Handles `live_ocr`, `live_ocr_agent`, `send_image`, and `voice_agent` modes
  - Validates messages and exam selection
  - Streams Gemini output as SSE
- `/api/ocr`
  - Auth required
  - Accepts a base64 frame
  - Returns extracted page text
  - Distinguishes quota, rate-limit, and configuration failures
- `/api/image`
  - Auth required
  - Accepts multipart image upload
  - Streams the first step-by-step solution
- `/api/webhooks/clerk`
  - Syncs user lifecycle events into Supabase

## Environment Variables

Copy `.env.example` to `.env.local` and set:

```bash
GEMINI_API_KEY=

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Recommended checks:

```bash
npm run typecheck
npm run build
```

## Supabase Minimum Setup

Create the `users` table:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Create a Storage bucket named `images`.

## Behavior Rules

- `Live OCR` and `Live OCR + Voice` should guide, not hand over direct answers.
- `Send Image` should produce complete step-by-step solutions.
- API routes require authenticated user context.
- Image and chat payloads should not be logged.
- Session chat history remains in memory for the prototype.

## Verification Snapshot

Recently verified in this repo:

- TypeScript check passes
- Production build passes
- `gemini-2.5-flash-lite` works with both text and image input
- Current Gemini error handling separates:
  - quota exhaustion
  - transient rate limiting
  - invalid request or key configuration

## Related Docs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`desgin.md`](./desgin.md)
- [`PRD.md`](./PRD.md)
- [`TASKS.md`](./TASKS.md)
- [`RULES.md`](./RULES.md)
- [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md)
# iim-edtech-doubt-clear
