# System Architecture

> **Scope Legend**
> - 🟢 **Prototype** — Current architecture (Software + Stateful Python Backend)
> - 🟡 **Launch** — Upgrade path (Adding ESP32-CAM Hardware)

---

## Overview — Hybrid Tiered System

```
[Student's Laptop/Phone]          [Python FastAPI Backend]           [Supabase Cloud]
        │                               │                                 │
  Browser (Next.js)                Stateful Serverless               PostgreSQL + pgvector
  ┌─────────────────┐              ┌──────────────────┐              ┌─────────────────┐
  │ Web Speech API  │──── voice ──▶│ WebSocket Server │──── RAG ───▶│ Embeddings      │
  │ SpeechSynthesis │              │                  │◀── hints ───│ (🟡 Launch)     │
  │ useCamera hook  │── frames ───▶│ /ws/client/{id}  │              └─────────────────┘
  │ messages[] state│              │                  │──── Gemini API ──▶ gemini-2.0-flash
  └─────────────────┘              └──────────────────┘
        │                                ▲
  [🟡 Launch: ESP32 Lamp]                │
  Streams video JPEG over ───────────────┘
  local WebSocket to Python Backend
```

---

## 1. Architecture Components

### Frontend (Next.js)
- **Camera/Input:** Browser webcam via `getUserMedia()` OR WebSocket feed from Python backend.
- **Voice:** Browser `Web Speech API` — mic button triggers recording.
- **WebSocket Client:** Connects to Python FastAPI backend (`/ws/client/{session_id}`) to stream UI updates, chat responses, and voice transcription tokens.

### Middleware Backend (Python FastAPI)
- **Computer Vision Pipeline:** Processes incoming JPEG frames (warping, background subtraction, occlusion detection) using OpenCV.
- **Image Compression:** Compresses processed frames into lightweight JPEGs (Quality 60) before API transmission to minimize latency.
- **Gemini Client:** Maintains session context and streams AI multimodal requests to Gemini 2.0 Flash or Flash-Lite.

### ESP32-CAM Hardware (🟡 Launch)
- Connects to local Wi-Fi.
- Streams compressed VGA JPEG frames to the Python backend via WebSockets.
- Includes a physical "WAKE UP" button (Doubt Pin) to trigger backend processing without active polling.

---

## 2. Conversational Flow

```
1. Student asks a question (Voice or Text) + Video Frame captured
   └─→ Next.js sends data over WebSocket to FastAPI backend

2. FastAPI Backend Process:
   ├─→ Run Computer Vision pipeline (Background subtraction, CLAHE, Warping)
   ├─→ Compress image to ~30KB JPEG
   ├─→ Construct Gemini multimodal prompt with Socratic instructions
   └─→ Call Gemini API

3. Gemini gemini-2.0-flash streams response tokens
   └─→ FastAPI relays tokens via WebSocket to Next.js
   └─→ Next.js pushes text to UI and triggers Web Speech API
```

---

## 3. Communication Contracts

### Next.js ↔ Python FastAPI (`ws://localhost:8000/ws/client/{session_id}`)
- **Client to Server:** `{"type": "chat_message", "content": "What is this?"}`
- **Server to Client:** `{"type": "chat_token", "content": "Look "}`

### ESP32-CAM ↔ Python FastAPI (`ws://localhost:8000/ws/hardware/{session_id}`)
- **Hardware to Server:** Raw Binary JPEG Frames, or `{"type": "hardware_trigger", "action": "button_pressed"}`

---

## 4. Supabase Schema (Prototype)

```sql
-- Users table (synced from Clerk via webhook)
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id    TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own row"
  ON users FOR SELECT
  USING (clerk_id = auth.uid()::text);
```
