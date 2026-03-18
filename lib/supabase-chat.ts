import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let _supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!_supabaseClient) {
    _supabaseClient = createClient(
      requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    );
  }
  return _supabaseClient;
}

export function createSupabaseClient(): SupabaseClient {
  return getSupabaseClient();
}

// ============================================
// Types
// ============================================

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  mode: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// ============================================
// Chat Sessions
// ============================================

export async function createChatSession(
  userId: string,
  mode: string = "live_ocr"
): Promise<ChatSession | null> {
  try {
    const client = getSupabaseClient();
    
    // Set the user_id for RLS
    client.auth.setSession({
      access_token: "",
      refresh_token: ""
    });

    const { data, error } = await client
      .from("chat_sessions")
      .insert({
        user_id: userId,
        mode,
        title: "New Chat"
      })
      .select()
      .single();

    if (error) {
      console.error("[ChatSession] Create error:", error);
      return null;
    }

    return data as ChatSession;
  } catch (error) {
    console.error("[ChatSession] Create failed:", error);
    return null;
  }
}

export async function getUserSessions(userId: string): Promise<ChatSession[]> {
  try {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from("chat_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[ChatSession] Fetch error:", error);
      return [];
    }

    return (data as ChatSession[]) || [];
  } catch (error) {
    console.error("[ChatSession] Fetch failed:", error);
    return [];
  }
}

export async function getSessionById(sessionId: string): Promise<ChatSession | null> {
  try {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from("chat_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (error) {
      console.error("[ChatSession] GetById error:", error);
      return null;
    }

    return data as ChatSession;
  } catch (error) {
    console.error("[ChatSession] GetById failed:", error);
    return null;
  }
}

export async function updateSessionTitle(
  sessionId: string,
  title: string
): Promise<boolean> {
  try {
    const client = getSupabaseClient();

    const { error } = await client
      .from("chat_sessions")
      .update({ title })
      .eq("id", sessionId);

    if (error) {
      console.error("[ChatSession] Update title error:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[ChatSession] Update title failed:", error);
    return false;
  }
}

export async function deleteChatSession(sessionId: string): Promise<boolean> {
  try {
    const client = getSupabaseClient();

    const { error } = await client
      .from("chat_sessions")
      .delete()
      .eq("id", sessionId);

    if (error) {
      console.error("[ChatSession] Delete error:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[ChatSession] Delete failed:", error);
    return false;
  }
}

// ============================================
// Chat Messages
// ============================================

export async function getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  try {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[ChatMessage] Fetch error:", error);
      return [];
    }

    return (data as ChatMessage[]) || [];
  } catch (error) {
    console.error("[ChatMessage] Fetch failed:", error);
    return [];
  }
}

export async function saveChatMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string
): Promise<ChatMessage | null> {
  try {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from("chat_messages")
      .insert({
        session_id: sessionId,
        role,
        content
      })
      .select()
      .single();

    if (error) {
      console.error("[ChatMessage] Save error:", error);
      return null;
    }

    return data as ChatMessage;
  } catch (error) {
    console.error("[ChatMessage] Save failed:", error);
    return null;
  }
}

export async function deleteSessionMessages(sessionId: string): Promise<boolean> {
  try {
    const client = getSupabaseClient();

    const { error } = await client
      .from("chat_messages")
      .delete()
      .eq("session_id", sessionId);

    if (error) {
      console.error("[ChatMessage] Delete error:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[ChatMessage] Delete failed:", error);
    return false;
  }
}
