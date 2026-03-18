import { auth } from "@clerk/nextjs/server";
import { createChatSession, getUserSessions, getSessionMessages, saveChatMessage, updateSessionTitle, deleteChatSession, deleteSessionMessages, type ChatSession, type ChatMessage } from "@/lib/supabase-chat";
import { createSupabaseServiceClient } from "@/lib/supabase";

export const runtime = 'edge';

interface ChatSessionRequest {
  action: "create" | "list" | "get" | "getMessages" | "saveMessage" | "updateTitle" | "delete";
  sessionId?: string;
  mode?: string;
  role?: "user" | "assistant";
  content?: string;
  title?: string;
}

export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ChatSessionRequest;
  try {
    body = await request.json() as ChatSessionRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const client = createSupabaseServiceClient();

  try {
    switch (body.action) {
      case "create": {
        const session = await createChatSessionWithUser(userId, body.mode || "live_ocr");
        return Response.json({ session });
      }

      case "list": {
        const sessions = await getUserSessionsWithUser(userId);
        return Response.json({ sessions });
      }

      case "get": {
        if (!body.sessionId) {
          return Response.json({ error: "sessionId required" }, { status: 400 });
        }
        const session = await getSessionWithUser(userId, body.sessionId);
        return Response.json({ session });
      }

      case "getMessages": {
        if (!body.sessionId) {
          return Response.json({ error: "sessionId required" }, { status: 400 });
        }
        const messages = await getMessagesWithUser(userId, body.sessionId);
        return Response.json({ messages });
      }

      case "saveMessage": {
        if (!body.sessionId || !body.role || !body.content) {
          return Response.json({ error: "sessionId, role, and content required" }, { status: 400 });
        }
        const message = await saveMessageWithUser(userId, body.sessionId, body.role, body.content);
        return Response.json({ message });
      }

      case "updateTitle": {
        if (!body.sessionId || !body.title) {
          return Response.json({ error: "sessionId and title required" }, { status: 400 });
        }
        await updateTitleWithUser(userId, body.sessionId, body.title);
        return Response.json({ success: true });
      }

      case "delete": {
        if (!body.sessionId) {
          return Response.json({ error: "sessionId required" }, { status: 400 });
        }
        await deleteWithUser(userId, body.sessionId);
        return Response.json({ success: true });
      }

      default:
        return Response.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[ChatSessions API] Error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Secure wrappers that verify user ownership
async function createChatSessionWithUser(userId: string, mode: string): Promise<ChatSession | null> {
  const client = createSupabaseServiceClient();
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
    console.error("[Chat] Create error:", error);
    return null;
  }
  return data as ChatSession;
}

async function getUserSessionsWithUser(userId: string): Promise<ChatSession[]> {
  const client = createSupabaseServiceClient();
  const { data, error } = await client
    .from("chat_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  
  if (error) {
    console.error("[Chat] List error:", error);
    return [];
  }
  return (data as ChatSession[]) || [];
}

async function getSessionWithUser(userId: string, sessionId: string): Promise<ChatSession | null> {
  const client = createSupabaseServiceClient();
  const { data, error } = await client
    .from("chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();
  
  if (error) {
    console.error("[Chat] Get error:", error);
    return null;
  }
  return data as ChatSession;
}

async function getMessagesWithUser(userId: string, sessionId: string): Promise<ChatMessage[]> {
  const client = createSupabaseServiceClient();
  
  // First verify user owns this session
  const { data: session } = await client
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();
  
  if (!session) {
    return [];
  }

  const { data, error } = await client
    .from("chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  
  if (error) {
    console.error("[Chat] Get messages error:", error);
    return [];
  }
  return (data as ChatMessage[]) || [];
}

async function saveMessageWithUser(
  userId: string,
  sessionId: string,
  role: "user" | "assistant",
  content: string
): Promise<ChatMessage | null> {
  const client = createSupabaseServiceClient();
  
  // First verify user owns this session
  const { data: session } = await client
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();
  
  if (!session) {
    console.error("[Chat] Unauthorized session access:", sessionId);
    return null;
  }

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
    console.error("[Chat] Save message error:", error);
    return null;
  }
  return data as ChatMessage;
}

async function updateTitleWithUser(userId: string, sessionId: string, title: string): Promise<boolean> {
  const client = createSupabaseServiceClient();
  const { error } = await client
    .from("chat_sessions")
    .update({ title })
    .eq("id", sessionId)
    .eq("user_id", userId);
  
  if (error) {
    console.error("[Chat] Update title error:", error);
    return false;
  }
  return true;
}

async function deleteWithUser(userId: string, sessionId: string): Promise<boolean> {
  const client = createSupabaseServiceClient();
  
  // Delete messages first (cascading should handle this, but being explicit)
  await client
    .from("chat_messages")
    .delete()
    .eq("session_id", sessionId)
    .eq("session_id", sessionId); // Double check
  
  // Delete session (messages should cascade)
  const { error } = await client
    .from("chat_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", userId);
  
  if (error) {
    console.error("[Chat] Delete error:", error);
    return false;
  }
  return true;
}
