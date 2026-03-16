"use client";

import React, { useCallback, useRef, useState } from "react";
import type { ExamType } from "@/types/exam";
import type { Message } from "@/types";

interface UseVoiceAgentParams {
  exam: ExamType;
  language?: "en-IN" | "en-US";
}

interface UseVoiceAgentResult {
  messages: Message[];
  status: "idle" | "listening" | "thinking" | "speaking";
  transcript: string;
  startListening: () => void;
  interrupt: () => void;
  initialized: boolean;
  microphoneAvailable: boolean;
  error: string | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
}

interface SpeechRecognitionConstructor {
  new(): SpeechRecognitionInstance;
}

function buildMessage(role: Message["role"], content: string): Message {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now()
  };
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const W = window as any;
  return W.SpeechRecognition || W.webkitSpeechRecognition || null;
}

function parseSSEData(raw: string): string[] {
  // Parse SSE format: "data: {json}\n\n"
  return raw
    .split("\n\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^data:\s*(.+)$/);
      return match ? match[1] : null;
    })
    .filter(Boolean) as string[];
}

function splitIntoSentences(text: string): string[] {
  // Match sentence-ending punctuation followed by space or end
  const sentences = text.split(/(?<=[.!?।])\s+/);
  return sentences
    .map((s) =>
      s
        .replace(/\$\$[^$]*\$\$/g, "equation")
        .replace(/\$[^$]*\$/g, "expression")
        .replace(/[*_~`#>]/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .trim()
    )
    .filter((s) => s.length > 0);
}

export function useVoiceAgent({ exam, language = "en-IN" }: UseVoiceAgentParams): UseVoiceAgentResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [transcript, setTranscript] = useState<string>("");
  const [initialized, setInitialized] = useState<boolean>(false);
  const [microphoneAvailable, setMicrophoneAvailable] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const transcriptRef = useRef<string>("");

  // Initialize microphone availability on mount
  React.useEffect(() => {
    const SR = getSpeechRecognition();
    setMicrophoneAvailable(!!SR);
  }, []);

  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Set up voice selection with voiceschanged listener (needed for Safari/iOS)
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) return;
      voiceRef.current =
        voices.find((v) => v.lang === language) ??
        voices.find((v) => v.name.includes("Google") && v.lang.startsWith("en")) ??
        voices.find((v) => v.lang === "en-US") ??
        voices.find((v) => v.lang.startsWith("en")) ??
        null;
    };

    pickVoice();
    window.speechSynthesis.addEventListener("voiceschanged", pickVoice);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", pickVoice);
    };
  }, [language]);

  const speakSentence = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const clean = text
      .replace(/\$\$[^$]*\$\$/g, "equation")
      .replace(/\$[^$]*\$/g, "expression")
      .replace(/[*_~`#>]/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .trim();

    if (!clean) return;

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = language;
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    if (voiceRef.current) {
      utterance.voice = voiceRef.current;
    }

    window.speechSynthesis.speak(utterance);
  }, [language]);

  const sendMessage = useCallback(
    async (userText: string) => {
      const trimmed = userText.trim();

      // Validation
      if (trimmed.length < 3) {
        setError("Please speak a bit longer.");
        setTimeout(() => setError(null), 3000);
        return;
      }

      setStatus("thinking");
      setError(null);
      setInitialized(true);

      const newMessages: Message[] = [...messagesRef.current, buildMessage("user", trimmed)];
      messagesRef.current = newMessages;
      setMessages(newMessages);

      const trimmedMsgs =
        newMessages.length > 9
          ? [newMessages[0], ...newMessages.slice(-8)]
          : newMessages;

      abortRef.current = new AbortController();
      const signal = AbortSignal.any([abortRef.current.signal, AbortSignal.timeout(90_000)]);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            messages: trimmedMsgs,
            exam,
            mode: "voice_agent"
          })
        });

        if (!response.ok) {
          if (response.status === 429) {
            setError("Rate limited. Please wait a moment.");
          } else if (response.status === 401) {
            setError("Please sign in to continue.");
          } else {
            setError(`API error: ${response.status}`);
          }
          setStatus("idle");
          return;
        }

        if (!response.body) {
          setError("No response from server.");
          setStatus("idle");
          return;
        }

        setStatus("speaking");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";
        let buffer = "";
        let spokenSentenceCount = 0;

        while (true) {
          const { done, value } = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Server response timed out. Please try again.")), 20_000)
            ),
          ]);
          if (done) break;

          const chunk = decoder.decode(value);
          buffer += chunk;

          const lines = buffer.split("\n\n");
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i];
            const parsed = parseSSEData(line);
            for (const token of parsed) {
              try {
                const json = JSON.parse(token);
                fullResponse += json;

                // Speak only NEW complete sentences (not the last partial one)
                const sentences = splitIntoSentences(fullResponse);
                for (let s = spokenSentenceCount; s < sentences.length - 1; s++) {
                  speakSentence(sentences[s]);
                }
                spokenSentenceCount = Math.max(spokenSentenceCount, sentences.length - 1);
              } catch {
                // Invalid JSON token, skip
              }
            }
          }
          buffer = lines[lines.length - 1];
        }

        // Process remaining buffer
        if (buffer) {
          const parsed = parseSSEData(buffer);
          for (const token of parsed) {
            try {
              const json = JSON.parse(token);
              fullResponse += json;
            } catch {
              // Invalid JSON token, skip
            }
          }
        }

        // Speak any remaining unspoken sentences
        const finalSentences = splitIntoSentences(fullResponse);
        for (let s = spokenSentenceCount; s < finalSentences.length; s++) {
          speakSentence(finalSentences[s]);
        }

        const newMsgs = [...messagesRef.current, buildMessage("assistant", fullResponse)];
        messagesRef.current = newMsgs;
        setMessages(newMsgs);
      } catch (err: any) {
        if (err.name === "AbortError") {
          // User interrupted, silent
        } else if (err instanceof TypeError && err.message.includes("fetch")) {
          setError("Network error. Please check your connection.");
        } else {
          setError(`Error: ${err?.message || "Unknown error"}`);
          console.error("Voice agent error:", err);
        }
      } finally {
        setStatus("idle");
      }
    },
    [exam, speakSentence]
  );

  const startListening = useCallback(() => {
    interrupt();

    const SR = getSpeechRecognition();
    if (!SR) {
      setError("Microphone not available on this browser.");
      return;
    }

    const recognition = new SR();
    recognition.lang = language;
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      setStatus("listening");
      setError(null);
    };

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const text = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join("");
      transcriptRef.current = text;
      setTranscript(text);
    };

    recognition.onerror = (e: Event) => {
      const errEvent = e as unknown as { error?: string };
      if (errEvent.error !== "no-speech") {
        setError(`Microphone error: ${errEvent.error}`);
      }
    };

    recognition.onend = () => {
      const finalText = transcriptRef.current.trim();
      if (finalText.length > 3) {
        void sendMessage(finalText);
      } else if (finalText.length > 0) {
        setError("Please speak at least a few words.");
        setStatus("idle");
      }
      setTranscript("");
      transcriptRef.current = "";
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      setError("Failed to start microphone. Please check permissions.");
      console.error("Recognition start error:", err);
    }
  }, [language, sendMessage]);

  const interrupt = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (abortRef.current) {
      abortRef.current.abort();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // Already stopped
      }
    }
    setStatus("idle");
  }, []);

  return {
    messages,
    status,
    transcript,
    startListening,
    interrupt,
    initialized,
    microphoneAvailable,
    error
  };
}
