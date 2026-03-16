"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, MicOff, Square, Send } from "lucide-react";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { StreamingText } from "@/components/chat/StreamingText";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useVoiceOutput } from "@/hooks/useVoiceOutput";
import { useInterrupt } from "@/hooks/useInterrupt";
import { consumeSSE } from "@/lib/sse-client";
import type { AppMode, ImageInput, Message } from "@/types";

type ConversationStatus = "idle" | "listening" | "thinking" | "speaking";

interface ConversationPanelProps {
  messages: Message[];
  onAddUserMessage: (text: string) => Message[];
  onAddAssistantMessage: (text: string) => void;
  mode: AppMode;
  ocrText?: string;
  image?: ImageInput;
  onRequestSnapshot?: () => Promise<void>;
  className?: string;
}

const CONTEXT_WINDOW = 8;

function trimMessagesForCost(messages: Message[]): Message[] {
  if (messages.length <= CONTEXT_WINDOW) {
    return messages;
  }

  const first = messages[0];
  const tail = messages.slice(-CONTEXT_WINDOW);
  if (tail[0]?.id === first.id) {
    return tail;
  }
  return [first, ...tail];
}

function isSnapshotCommand(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return normalized.includes("look at this") || normalized.includes("scan this") || normalized.includes("read this");
}

export function ConversationPanel({
  messages,
  onAddUserMessage,
  onAddAssistantMessage,
  mode,
  ocrText,
  image,
  onRequestSnapshot,
  className = ""
}: ConversationPanelProps): JSX.Element {
  const [status, setStatus] = useState<ConversationStatus>("idle");
  const [streamingText, setStreamingText] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [textInput, setTextInput] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<ConversationStatus>("idle");

  const { speak, stop: stopSpeaking, isSpeaking } = useVoiceOutput();
  const { isSupported: voiceSupported, startListening, stopListening, isListening } = useVoiceInput({
    onTranscript: (text) => {
      const transcript = text.trim();
      if (!transcript) {
        return;
      }

      if (mode === "live_ocr" && onRequestSnapshot && isSnapshotCommand(transcript)) {
        void onRequestSnapshot();
        return;
      }

      void handleSend(transcript);
    }
  });
  const { interrupt, createAbortSignal } = useInterrupt({
    stopSpeaking,
    stopListening
  });

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Scroll to bottom on new messages or streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, status]);

  // Sync speaking state
  useEffect(() => {
    if (!isSpeaking && statusRef.current === "speaking") {
      setStatus("idle");
    }
  }, [isSpeaking]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!text.trim() || status === "thinking") return;

      setError("");
      setStreamingText("");

      // Stop any ongoing speech/listening
      interrupt();

      const updatedMessages = onAddUserMessage(text.trim());
      const messagesForApi = trimMessagesForCost(updatedMessages);
      setStatus("thinking");

      try {
        const signal = createAbortSignal();
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: messagesForApi,
            mode,
            ocrText: ocrText || undefined,
            image: image || undefined
          }),
          signal
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API Error: ${response.status} ${errText}`);
        }

        let fullText = "";
        let lastSpokenIndex = 0;

        await consumeSSE(response, (data) => {
          if (data === "[DONE]") return;
          if (data.startsWith("[ERROR]")) {
            throw new Error(data.slice(8) || "Streaming failed");
          }
          try {
            const token = JSON.parse(data) as string;
            fullText += token;
            setStreamingText(fullText);

            // Speak sentence by sentence as tokens stream in
            const unspoken = fullText.slice(lastSpokenIndex);
            const sentenceEnd = unspoken.search(/[.!?]\s/);
            if (sentenceEnd !== -1) {
              const sentence = unspoken.slice(0, sentenceEnd + 1);
              speak(sentence);
              lastSpokenIndex += sentenceEnd + 1;
              if (statusRef.current === "thinking") {
                setStatus("speaking");
              }
            }
          } catch {
            fullText += data;
            setStreamingText(fullText);
          }
        }, signal);

        // Speak any remaining text
        const remaining = fullText.slice(lastSpokenIndex).trim();
        if (remaining) {
          speak(remaining);
          if (statusRef.current === "thinking") {
            setStatus("speaking");
          }
        }

        if (fullText.trim()) {
          onAddAssistantMessage(fullText.trim());
        }
        setStreamingText("");
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") {
          // User interrupted — not an error
          setStreamingText("");
          setStatus("idle");
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStreamingText("");
        setStatus("idle");
      }
    },
    [status, onAddUserMessage, createAbortSignal, mode, ocrText, image, interrupt, speak, onAddAssistantMessage]
  );

  const handleMicToggle = useCallback(() => {
    if (isListening) {
      stopListening();
      return;
    }
    if (status === "thinking" || status === "speaking") {
      interrupt();
      setStreamingText("");
      setStatus("idle");
      return;
    }
    setStatus("listening");
    startListening();
  }, [isListening, status, stopListening, interrupt, startListening]);

  const handleStop = useCallback(() => {
    interrupt();
    setStreamingText("");
    setStatus("idle");
  }, [interrupt]);

  const handleTextSubmit = useCallback(async () => {
    const text = textInput.trim();
    if (!text) return;
    setTextInput("");
    await handleSend(text);
  }, [textInput, handleSend]);

  const statusLabel: Record<ConversationStatus, string> = {
    idle: "",
    listening: "Listening...",
    thinking: "Thinking...",
    speaking: "Speaking..."
  };

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`}>
      {/* Chat messages area */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {messages.map((message) => (
          <ChatBubble key={message.id} message={message} />
        ))}
        {streamingText ? <StreamingText text={streamingText} /> : null}
        {status === "thinking" && !streamingText ? <TypingIndicator /> : null}
        <div ref={bottomRef} />
      </div>

      {/* Error display */}
      {error ? <p className="px-3 pb-2 text-sm text-red-700">{error}</p> : null}

      {/* Status indicator */}
      <AnimatePresence>
        {status !== "idle" ? (
          <motion.div
            animate={{ opacity: 1, height: "auto" }}
            className="flex items-center justify-center px-3 py-1"
            exit={{ opacity: 0, height: 0 }}
            initial={{ opacity: 0, height: 0 }}
          >
            <span
              className={[
                "text-xs font-medium",
                status === "listening" ? "text-green-600" : "",
                status === "thinking" ? "text-amber-600" : "",
                status === "speaking" ? "text-blue-600" : ""
              ].join(" ")}
            >
              {statusLabel[status]}
            </span>
            {status === "listening" ? (
              <motion.span
                animate={{ scale: [1, 1.3, 1] }}
                className="ml-2 inline-block h-2 w-2 rounded-full bg-green-500"
                transition={{ repeat: Infinity, duration: 1.2 }}
              />
            ) : null}
            {status === "thinking" ? (
              <motion.span
                animate={{ opacity: [0.4, 1, 0.4] }}
                className="ml-2 inline-block h-2 w-2 rounded-full bg-amber-500"
                transition={{ repeat: Infinity, duration: 1 }}
              />
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Input area with mic + text fallback */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          {/* Voice mic button */}
          {voiceSupported ? (
            <button
              className={[
                "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors",
                isListening
                  ? "border-green-500 bg-green-50 text-green-600"
                  : status === "thinking" || status === "speaking"
                    ? "border-red-400 bg-red-50 text-red-500"
                    : "border-border bg-background text-foreground hover:border-foreground"
              ].join(" ")}
              onClick={status === "thinking" || status === "speaking" ? handleStop : handleMicToggle}
              title={
                isListening
                  ? "Stop listening"
                  : status === "thinking" || status === "speaking"
                    ? "Stop AI"
                    : "Start speaking"
              }
              type="button"
            >
              {isListening ? (
                <>
                  <Mic className="h-5 w-5" />
                  <span className="voice-pulse-ring" />
                </>
              ) : status === "thinking" || status === "speaking" ? (
                <Square className="h-4 w-4" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
            </button>
          ) : null}

          {/* Text input fallback */}
          <textarea
            className="h-11 flex-1 resize-none border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
            disabled={status === "thinking"}
            maxLength={2000}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleTextSubmit();
              }
            }}
            placeholder={
              voiceSupported ? "Type or press mic to speak..." : "Type a message..."
            }
            rows={1}
            value={textInput}
          />

          <button
            className="flex h-11 w-11 shrink-0 items-center justify-center border border-foreground bg-foreground text-background disabled:cursor-not-allowed disabled:opacity-60"
            disabled={status === "thinking" || textInput.trim().length === 0}
            onClick={() => void handleTextSubmit()}
            title="Send message"
            type="button"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
