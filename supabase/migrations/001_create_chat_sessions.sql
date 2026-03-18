-- ============================================
-- Persistent Chat Sessions for ClarityAI
-- ============================================

-- Create chat_sessions table
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT DEFAULT 'New Chat',
  mode TEXT NOT NULL DEFAULT 'live_ocr',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at ASC);

-- ============================================
-- Row Level Security (RLS)
-- ============================================
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for chat_sessions
CREATE POLICY "Users can view own sessions"
  ON chat_sessions FOR SELECT
  USING (user_id = current_setting('app.user_id', true));

CREATE POLICY "Users can insert own sessions"
  ON chat_sessions FOR INSERT
  WITH CHECK (user_id = current_setting('app.user_id', true));

CREATE POLICY "Users can update own sessions"
  ON chat_sessions FOR UPDATE
  USING (user_id = current_setting('app.user_id', true));

CREATE POLICY "Users can delete own sessions"
  ON chat_sessions FOR DELETE
  USING (user_id = current_setting('app.user_id', true));

-- RLS Policies for chat_messages
CREATE POLICY "Users can view messages in own sessions"
  ON chat_messages FOR SELECT
  USING (
    session_id IN (
      SELECT id FROM chat_sessions 
      WHERE user_id = current_setting('app.user_id', true)
    )
  );

CREATE POLICY "Users can insert messages in own sessions"
  ON chat_messages FOR INSERT
  WITH CHECK (
    session_id IN (
      SELECT id FROM chat_sessions 
      WHERE user_id = current_setting('app.user_id', true)
    )
  );

CREATE POLICY "Users can delete messages in own sessions"
  ON chat_messages FOR DELETE
  USING (
    session_id IN (
      SELECT id FROM chat_sessions 
      WHERE user_id = current_setting('app.user_id', true)
    )
  );

-- ============================================
-- Helper function to auto-update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on chat_sessions
DROP TRIGGER IF EXISTS update_chat_sessions_updated_at ON chat_sessions;
CREATE TRIGGER update_chat_sessions_updated_at
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
