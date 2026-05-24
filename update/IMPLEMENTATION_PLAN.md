# Backend & Analytics Database Implementation Plan
<!-- Living document detailing the transition from local Python middleware to a Supabase-backed analytics engine -->

After reviewing the current folder structure, the `backend/` Python middleware, and the `supabase/migrations/`, we have established a sophisticated foundation bridging hardware and web environments.

## 1. What We Already Have (Current State)

We have successfully unified the hardware and web workflows far beyond the initial prototype.

### The Local Python Middleware (`backend/`)
- **FastAPI Orchestrator (`main.py`):** We have consolidated the architecture into a single FastAPI app managing duplex WebSockets for both the client (`/ws/client`) and hardware (`/ws/hardware`). 
- **OCR Debouncing:** We have successfully implemented the `Levenshtein` distance algorithm (firing every 5 frames) to trigger `page_turned` hardware events, preventing unnecessary API spam.
- **Advanced Gemini Client (`gemini_client.py`):** This is highly advanced. We are already extracting real-time student state (`SessionState` with `mistakes_made` and `stuck_count`), using adaptive Socratic scaffolding prompts (Micro-Nudge vs Step Unlock), and enforcing a strict double-pass LLM guardrail.

### The Database (`supabase/`)
- **Persistent Chat:** The `001_create_chat_sessions.sql` migration sets up `chat_sessions` and `chat_messages` with strict Row Level Security (RLS).

---

## 2. What Is Missing & Needs to Be Built

While `gemini_client.py` is dynamically extracting the student's `mistakes_made` and `stuck_count` in real-time, **we are currently discarding this data after the chat turn.** It is not being saved to Supabase, which means the frontend has no data to build an analytics dashboard.

Additionally, to store images alongside chat messages for context, we need to integrate Supabase Storage.

### A. The Analytics Database Schema (Supabase)
We need to create a new migration (`002_create_analytics_tables.sql`) to add tables. This schema will power advanced student insights:
- **`topics` Table:** To store subjects and concepts hierarchically (e.g., Physics > Kinematics).
- **`user_mastery` Table:** 
  - To track the rolling 0-100 **proficiency score** for a student per subject.
  - To track the **number of questions solved** per topic.
  - To track **weak concepts** based on the proficiency score threshold dropping below a certain level.
- **`user_time_tracking` Table:** To track exactly **how much time was spent on specific topics** during a session.
- **`mistake_logs` Table:** 
  - To store the specific `mistakes_made` extracted by Gemini.
  - To aggregate the **overall mistakes made** and explicitly calculate **what type of mistakes are repeated the most** (e.g., Calculation Error vs. Formula Recall).
- **UPDATE `chat_messages`:** Add an `image_url` column to link uploaded/captured images to specific chat turns.

### B. Image Storage Strategy (Supabase Storage)
To store the images efficiently:
1. **Create a Bucket:** Create a Supabase Storage bucket named `chat_images`.
2. **Python Upload:** When the Python backend (`main.py`) captures a significant frame (or receives an uploaded image), it uses the `supabase-py` client to upload the raw JPEG bytes to this bucket.
3. **Link to Database:** Supabase Storage returns a public URL for the uploaded image. We insert this URL into the `image_url` column of the `chat_messages` table, so the frontend UI can fetch and display the exact image the student was looking at when they asked the question.

### C. Bridging Python Middleware to Supabase
We need to update `backend/main.py` and `backend/gemini_client.py`.
- **Database Connection:** The Python backend needs to connect to Supabase (via the `supabase-py` SDK).
- **Analytics & Image Ingestion:** In `process_chat_turn()`, the Python backend must asynchronously upload the frame to Supabase Storage, `INSERT` the chat message with the new `image_url`, and `INSERT` the extracted analytics (mistakes, time elapsed, questions solved) into the respective tables.

---

## 3. Libraries & Algorithms to Use

- **Database SDK:** `supabase-py` in the Python backend to push analytics and image bytes natively.
- **Analytics Algorithms:** 
  - **Rolling Weighted Average:** Implemented in PostgreSQL to calculate the `proficiency/mastery_score`. For example, if a student makes a "Conceptual Error", the mastery score for that specific topic drops by 5 points.
  - **Mistake Frequency Analysis:** SQL `GROUP BY` and `COUNT` queries to instantly surface what mistake types are repeated the most over a given timeframe.
  - **Session Timer Algorithm:** The Python middleware will track the Delta Time between the first question on a topic and moving to the next, logging the exact time spent per topic to the database.
- **Frontend Charting:** `recharts` for the Next.js React dashboard.

## 4. Pending Decisions
- **Data Flow Decision:** Should the Python backend push the analytics directly to Supabase via the Python SDK, OR should it send the analytics payload over the WebSocket back to the Next.js client, and have Next.js write it to the database? *(Direct to Supabase is currently favored for speed and reliability, pending injection of the Supabase Service Role Key).*
