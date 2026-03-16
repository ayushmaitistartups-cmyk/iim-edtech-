"use client";

import { useCallback, useRef, useState } from "react";

interface UseVoiceOutputResult {
  speak: (text: string) => void;
  stop: () => void;
  isSpeaking: boolean;
}

/** Minimum safety timeout per utterance (ms). */
const MIN_UTTERANCE_TIMEOUT_MS = 5_000;
/** Milliseconds per character for estimating max speech duration. */
const MS_PER_CHARACTER = 80;

/**
 * Splits text into sentences for progressive TTS output.
 * Uses a lookbehind split so trailing unpunctuated text is preserved.
 */
function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/(?<=[.!?])\s+/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

export function useVoiceOutput(): UseVoiceOutputResult {
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const queueRef = useRef<string[]>([]);
  const activeRef = useRef<boolean>(false);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const speakNext = useCallback(() => {
    // Clear previous safety timer
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }

    if (typeof window === "undefined" || !window.speechSynthesis) return;

    if (queueRef.current.length === 0) {
      activeRef.current = false;
      setIsSpeaking(false);
      return;
    }

    const sentence = queueRef.current.shift()!;
    // Strip markdown/LaTeX for cleaner TTS
    const clean = sentence
      .replace(/\$\$[^$]*\$\$/g, "equation")
      .replace(/\$[^$]*\$/g, "expression")
      .replace(/[*_~`#>]/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .trim();

    if (!clean) {
      speakNext();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = "en-IN";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => {
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
      speakNext();
    };

    utterance.onerror = (event) => {
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
      if (event.error === "canceled" || event.error === "interrupted") {
        // Normal cancellation — not an error
        return;
      }
      speakNext();
    };

    window.speechSynthesis.speak(utterance);

    // Safety timeout: if onend never fires (Chrome bug), force-advance
    const timeoutMs = Math.max(MIN_UTTERANCE_TIMEOUT_MS, clean.length * MS_PER_CHARACTER);
    safetyTimerRef.current = setTimeout(() => {
      safetyTimerRef.current = null;
      window.speechSynthesis.cancel();
      speakNext();
    }, timeoutMs);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;

      // Chrome bug: synthesis may claim speaking while our queue is empty (stale state)
      if (window.speechSynthesis.speaking && !activeRef.current) {
        window.speechSynthesis.cancel();
      }

      const sentences = splitIntoSentences(text);
      if (sentences.length === 0) return;

      queueRef.current.push(...sentences);

      if (!activeRef.current) {
        activeRef.current = true;
        setIsSpeaking(true);
        // Small delay helps Chrome restart synthesis reliably after a cancel
        setTimeout(speakNext, 50);
      }
    },
    [speakNext]
  );

  const stop = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
    queueRef.current = [];
    activeRef.current = false;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  return { speak, stop, isSpeaking };
}
