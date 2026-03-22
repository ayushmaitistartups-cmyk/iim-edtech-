"use client";

import { useEffect, useRef, useState } from "react";
import { consumeSSE } from "@/lib/sse-client";
import type { AppMode, ImageInput, Message } from "@/types";
import type { ExamType } from "@/types/exam";

interface SendUserMessageOptions {
  mode: AppMode;
  exam?: ExamType;
  ocrText?: string;
  image?: ImageInput;
}

interface UseChatResult {
  messages: Message[];
  streamingText: string;
  isLoading: boolean;
  error: string;
  sendUserMessage: (text: string, options: SendUserMessageOptions) => Promise<void>;
  reset: () => void;
  appendAssistantMessage: (text: string) => void;
}

function buildMessage(role: Message["role"], content: string): Message {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now()
  };
}

export function useChat(initialMessages: Message[] = []): UseChatResult {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const messagesRef = useRef<Message[]>(initialMessages);
  const [streamingText, setStreamingText] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastMessageIdRef = useRef<string>("");

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const appendAssistantMessage = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    setMessages((current) => [...current, buildMessage("assistant", trimmed)]);
  };

  const sendUserMessage = async (
    text: string,
    options: SendUserMessageOptions
  ): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    // Cancel previous request if still in progress
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    abortControllerRef.current = new AbortController();

    // Deduplicate: skip if same message sent recently
    const messageId = `${trimmed}-${Date.now()}`;
    if (lastMessageIdRef.current === trimmed && messagesRef.current.length > 0) {
      const lastMsg = messagesRef.current[messagesRef.current.length - 1];
      if (lastMsg?.role === "user" && lastMsg.content === trimmed) {
        return;
      }
    }
    lastMessageIdRef.current = messageId;

    setError("");
    setIsLoading(true);
    setStreamingText("");

    const nextMessages = [...messagesRef.current, buildMessage("user", trimmed)];
    setMessages(nextMessages);

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
          exam: options.exam,
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
          // Non-JSON token, append raw
          fullText += data;
          setStreamingText(fullText);
        }
      });

      streamCompleted = true;

      if (fullText.trim()) {
        setMessages((current) => [...current, buildMessage("assistant", fullText.trim())]);
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
        setMessages((current) => [...current, buildMessage("assistant", finalText)]);
      }
    } finally {
      setStreamingText("");
      setIsLoading(false);
    }
  };

  const reset = (): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    messagesRef.current = [];
    setMessages([]);
    setStreamingText("");
    setError("");
    setIsLoading(false);
  };

  return {
    messages,
    streamingText,
    isLoading,
    error,
    sendUserMessage,
    reset,
    appendAssistantMessage
  };
}
