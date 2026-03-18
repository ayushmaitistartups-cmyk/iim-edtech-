"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { consumeSSE } from "@/lib/sse-client";
import type { AppMode, ImageInput, Message } from "@/types";

interface SendUserMessageOptions {
  mode: AppMode;
  ocrText?: string;
  image?: ImageInput;
}

interface UseChatOptions {
  sessionId?: string;
  userId?: string;
  initialMessages?: Message[];
  onSessionCreated?: (sessionId: string) => void;
  onTitleUpdate?: (title: string) => void;
}

interface UseChatResult {
  messages: Message[];
  streamingText: string;
  isLoading: boolean;
  error: string;
  sendUserMessage: (text: string, options: SendUserMessageOptions) => Promise<void>;
  reset: () => void;
  appendAssistantMessage: (text: string) => void;
  sessionId: string | null;
  isHydrated: boolean;
}

function buildMessage(role: Message["role"], content: string): Message {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now()
  };
}

function generateSessionTitle(firstMessage: string): string {
  const preview = firstMessage.slice(0, 50);
  return preview.length < firstMessage.length ? `${preview}...` : preview;
}

export function useChatPersistent({
  sessionId: initialSessionId,
  userId,
  initialMessages = [],
  onSessionCreated,
  onTitleUpdate
}: UseChatOptions = {}): UseChatResult {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [streamingText, setStreamingText] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId || null);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);

  const messagesRef = useRef<Message[]>(initialMessages);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastMessageIdRef = useRef<string>("");
  const titleGeneratedRef = useRef<boolean>(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Hydrate messages from Supabase on mount if sessionId exists
  useEffect(() => {
    if (!initialSessionId || !userId) {
      setIsHydrated(true);
      return;
    }

    const hydrate = async () => {
      try {
        const response = await fetch("/api/chat-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "getMessages",
            sessionId: initialSessionId
          })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.messages && Array.isArray(data.messages)) {
            const hydratedMessages: Message[] = data.messages.map((msg: { id: string; role: string; content: string; created_at: string }) => ({
              id: msg.id,
              role: msg.role as Message["role"],
              content: msg.content,
              createdAt: new Date(msg.created_at).getTime()
            }));
            setMessages(hydratedMessages);
            messagesRef.current = hydratedMessages;
            if (hydratedMessages.length > 0) {
              titleGeneratedRef.current = true;
            }
          }
        }
      } catch (err) {
        console.error("[Chat] Failed to hydrate messages:", err);
      } finally {
        setIsHydrated(true);
      }
    };

    hydrate();
  }, [initialSessionId, userId]);

  const createNewSession = useCallback(async (mode: string): Promise<string | null> => {
    if (!userId) return null;

    try {
      const response = await fetch("/api/chat-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          mode
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.session?.id) {
          setSessionId(data.session.id);
          onSessionCreated?.(data.session.id);
          return data.session.id;
        }
      }
    } catch (err) {
      console.error("[Chat] Failed to create session:", err);
    }
    return null;
  }, [userId, onSessionCreated]);

  const saveUserMessage = useCallback(async (sessId: string, content: string) => {
    try {
      await fetch("/api/chat-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveMessage",
          sessionId: sessId,
          role: "user",
          content
        })
      });
    } catch (err) {
      console.error("[Chat] Failed to save user message:", err);
    }
  }, []);

  const saveAssistantMessage = useCallback(async (sessId: string, content: string) => {
    try {
      await fetch("/api/chat-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveMessage",
          sessionId: sessId,
          role: "assistant",
          content
        })
      });
    } catch (err) {
      console.error("[Chat] Failed to save assistant message:", err);
    }
  }, []);

  const updateSessionTitle = useCallback(async (sessId: string, title: string) => {
    try {
      await fetch("/api/chat-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateTitle",
          sessionId: sessId,
          title
        })
      });
      onTitleUpdate?.(title);
    } catch (err) {
      console.error("[Chat] Failed to update title:", err);
    }
  }, [onTitleUpdate]);

  const appendAssistantMessage = useCallback((text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    setMessages((current) => [...current, buildMessage("assistant", trimmed)]);
  }, []);

  const sendUserMessage = useCallback(async (
    text: string,
    options: SendUserMessageOptions
  ): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    abortControllerRef.current = new AbortController();

    const messageId = `${trimmed}-${Date.now()}`;
    if (lastMessageIdRef.current === trimmed && messagesRef.current.length > 0) {
      const lastMsg = messagesRef.current[messagesRef.current.length - 1];
      if (lastMsg?.role === "user" && lastMsg.content === trimmed) {
        return;
      }
    }
    lastMessageIdRef.current = messageId;

    // Create session if doesn't exist
    let currentSessionId = sessionId;
    if (!currentSessionId && userId) {
      currentSessionId = await createNewSession(options.mode);
    }

    setError("");
    setIsLoading(true);
    setStreamingText("");

    const nextMessages = [...messagesRef.current, buildMessage("user", trimmed)];
    setMessages(nextMessages);

    // Save user message to Supabase
    if (currentSessionId) {
      await saveUserMessage(currentSessionId, trimmed);
      
      // Generate title from first message
      if (!titleGeneratedRef.current && nextMessages.length === 1) {
        const title = generateSessionTitle(trimmed);
        titleGeneratedRef.current = true;
        await updateSessionTitle(currentSessionId, title);
      }
    }

    let fullText = "";
    let streamCompleted = false;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortControllerRef.current?.signal,
        body: JSON.stringify({
          messages: nextMessages,
          mode: options.mode,
          ocrText: options.ocrText,
          image: options.image
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Chat API failed:", response.status, errText);
        throw new Error(`API Error: ${response.status} ${errText}`);
      }

      await consumeSSE(response, (data) => {
        if (data === "[DONE]") {
          return;
        }
        if (data.startsWith("[ERROR]")) {
          throw new Error(data.slice(8) || "Streaming error");
        }
        try {
          const token = JSON.parse(data) as string;
          fullText += token;
          setStreamingText(fullText);
        } catch {
          fullText += data;
          setStreamingText(fullText);
        }
      });

      streamCompleted = true;

      if (fullText.trim()) {
        const assistantMsg = buildMessage("assistant", fullText.trim());
        setMessages((current) => [...current, assistantMsg]);
        
        // Save assistant message to Supabase
        if (currentSessionId) {
          await saveAssistantMessage(currentSessionId, fullText.trim());
        }
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        return;
      }
      const errorMsg = e.message || String(e);
      setError(errorMsg);

      if (!streamCompleted) {
        let finalText = fullText.trim();
        if (!finalText) {
          finalText = `[Error] ${errorMsg}`;
        } else if (!/[.!?]$/.test(finalText)) {
          finalText += "...";
        }
        const errorMsgObj = buildMessage("assistant", finalText);
        setMessages((current) => [...current, errorMsgObj]);
        
        // Save error message to Supabase
        if (currentSessionId) {
          await saveAssistantMessage(currentSessionId, finalText);
        }
      }
    } finally {
      setStreamingText("");
      setIsLoading(false);
    }
  }, [sessionId, userId, createNewSession, saveUserMessage, saveAssistantMessage, updateSessionTitle]);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    messagesRef.current = [];
    setMessages([]);
    setStreamingText("");
    setError("");
    setIsLoading(false);
    titleGeneratedRef.current = false;
  }, []);

  return {
    messages,
    streamingText,
    isLoading,
    error,
    sendUserMessage,
    reset,
    appendAssistantMessage,
    sessionId,
    isHydrated
  };
}
