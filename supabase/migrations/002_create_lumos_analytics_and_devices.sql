-- ============================================
-- Lumos / ClarityAI Analytics + Device Pairing
-- ============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- Clerk-synced users table used by the existing webhook.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Device identity lives outside Clerk. The lamp never receives Clerk tokens.
CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(clerk_id) ON DELETE SET NULL,
  friendly_name TEXT NOT NULL,
  device_secret_hash TEXT NOT NULL,
  paired_at TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  pairing_code TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paired', 'expired')),
  claimed_user_id TEXT REFERENCES users(clerk_id) ON DELETE SET NULL,
  device_jwt TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_revoked_at ON devices(revoked_at);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_device_id ON pairing_codes(device_id);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires_at ON pairing_codes(expires_at);

-- Topic hierarchy for topic-specific pruning and mastery.
CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  exam_track TEXT NOT NULL DEFAULT 'technical' CHECK (exam_track IN ('technical', 'conceptual')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_mastery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  mastery_score NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (mastery_score >= 0 AND mastery_score <= 100),
  questions_solved INT NOT NULL DEFAULT 0 CHECK (questions_solved >= 0),
  weak_concept BOOLEAN NOT NULL DEFAULT FALSE,
  last_practiced_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, topic_id)
);

CREATE TABLE IF NOT EXISTS user_time_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE CASCADE,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INT NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0)
);

CREATE TABLE IF NOT EXISTS mistake_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE CASCADE,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  mistake_type TEXT NOT NULL CHECK (
    mistake_type IN ('conceptual', 'procedural', 'calculation', 'reading', 'formula', 'other')
  ),
  mistake_text TEXT NOT NULL,
  confidence NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  repeated_count INT NOT NULL DEFAULT 1 CHECK (repeated_count >= 1),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_mastery_user_id ON user_mastery(user_id);
CREATE INDEX IF NOT EXISTS idx_user_mastery_topic_id ON user_mastery(topic_id);
CREATE INDEX IF NOT EXISTS idx_time_tracking_user_topic ON user_time_tracking(user_id, topic_id);
CREATE INDEX IF NOT EXISTS idx_mistake_logs_user_topic ON mistake_logs(user_id, topic_id);
CREATE INDEX IF NOT EXISTS idx_mistake_logs_type ON mistake_logs(mistake_type);
CREATE INDEX IF NOT EXISTS idx_mistake_logs_created_at ON mistake_logs(created_at DESC);

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mistakes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tutor_state JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Hardware turn ledger for the BAO / MSM backend path.
CREATE TABLE IF NOT EXISTS turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(clerk_id) ON DELETE SET NULL,
  device_id TEXT REFERENCES devices(device_id) ON DELETE SET NULL,
  turn_number INT NOT NULL CHECK (turn_number >= 1),
  question_hash TEXT,
  query_type TEXT,
  difficulty TEXT,
  exam_track TEXT CHECK (exam_track IN ('technical', 'conceptual')),
  attempt_count INT NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  nudge_level TEXT,
  model_used TEXT,
  audio_url TEXT,
  image_url TEXT,
  transcript TEXT,
  response_voice TEXT,
  display_kind TEXT CHECK (display_kind IN ('latex', 'text', 'none')),
  display_content TEXT,
  is_confident NUMERIC(4,3) CHECK (is_confident >= 0 AND is_confident <= 1),
  escalated BOOLEAN NOT NULL DEFAULT FALSE,
  validator_flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ttft_ms INT,
  total_ms INT,
  cost_usd NUMERIC(10,6),
  asked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS question_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE CASCADE,
  question_hash TEXT NOT NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  mistake_type TEXT,
  attempt_count INT NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  first_asked_at TIMESTAMPTZ DEFAULT NOW(),
  last_asked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, question_hash)
);

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_turns_user_question ON turns(user_id, question_hash);
CREATE INDEX IF NOT EXISTS idx_turns_device_id ON turns(device_id);
CREATE INDEX IF NOT EXISTS idx_question_attempts_user_hash ON question_attempts(user_id, question_hash);
CREATE INDEX IF NOT EXISTS idx_memories_user_kind ON memories(user_id, kind);
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops);

-- Supabase Storage bucket for chat images captured on hardware/web turns.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat_images',
  'chat_images',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Keep timestamps fresh on new tables.
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_devices_updated_at ON devices;
CREATE TRIGGER update_devices_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_mastery_updated_at ON user_mastery;
CREATE TRIGGER update_user_mastery_updated_at
  BEFORE UPDATE ON user_mastery
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_time_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE mistake_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own devices"
  ON devices FOR SELECT
  USING (user_id = current_setting('app.user_id', true));

CREATE POLICY "Users can view public topics"
  ON topics FOR SELECT
  USING (true);

CREATE POLICY "Users can view own mastery"
  ON user_mastery FOR SELECT
  USING (user_id = current_setting('app.user_id', true));

CREATE POLICY "Users can view own time tracking"
  ON user_time_tracking FOR SELECT
  USING (user_id = current_setting('app.user_id', true));

CREATE POLICY "Users can view own mistake logs"
  ON mistake_logs FOR SELECT
  USING (user_id = current_setting('app.user_id', true));

CREATE POLICY "Users can view own turns"
  ON turns FOR SELECT
  USING (user_id = current_setting('app.user_id', true));

CREATE POLICY "Users can view own attempts"
  ON question_attempts FOR SELECT
  USING (user_id = current_setting('app.user_id', true));

CREATE POLICY "Users can view own memories"
  ON memories FOR SELECT
  USING (user_id = current_setting('app.user_id', true));
