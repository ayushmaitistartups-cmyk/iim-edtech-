"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SpeechRecognitionConstructor,
  SpeechRecognitionErrorEvent,
  SpeechRecognitionEvent,
  SpeechRecognitionInstance,
} from "@/types/speech";

const WAKE_PHRASES = [
  "hello bro",
  "hello brother",
  "hey bro",
  "hello pro",
  "helo bro",
  "yellow bro",
  "hello brow",
];

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const W = window as any;
  return (W.SpeechRecognition as SpeechRecognitionConstructor) ||
    (W.webkitSpeechRecognition as SpeechRecognitionConstructor) ||
    null;
}

function matchesWakePhrase(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return WAKE_PHRASES.some((phrase) => lower.includes(phrase));
}

interface UseWakeWordOptions {
  enabled: boolean;
  onWakeWord: () => void;
}

interface UseWakeWordResult {
  isListeningForWake: boolean;
  isSupported: boolean;
}

export function useWakeWord({ enabled, onWakeWord }: UseWakeWordOptions): UseWakeWordResult {
  const [isListeningForWake, setIsListeningForWake] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const enabledRef = useRef(enabled);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWakeWordRef = useRef(onWakeWord);
  const firedRef = useRef(false);

  // Compute once — browser capability doesn't change at runtime
  const isSupported = useMemo(() => getSpeechRecognition() !== null, []);

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { onWakeWordRef.current = onWakeWord; }, [onWakeWord]);

  const stopWake = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* already stopped */ }
      recognitionRef.current = null;
    }
    setIsListeningForWake(false);
  }, []);

  // startWake calls itself recursively via closure in onend — deps are intentionally empty
  // because all mutable state is accessed through refs (enabledRef, firedRef).
  const startWake = useCallback(() => {
    if (!enabledRef.current) return;
    const SR = getSpeechRecognition();
    if (!SR) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }

    firedRef.current = false;
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    recognition.onstart = null;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (firedRef.current) return;
      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (matchesWakePhrase(transcript)) {
          firedRef.current = true;
          try { recognition.abort(); } catch { /* ignore */ }
          recognitionRef.current = null;
          setIsListeningForWake(false);
          onWakeWordRef.current();
          return;
        }
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListeningForWake(false);
      // Auto-restart with a short gap — onend fires on both silence and normal end
      if (enabledRef.current && !firedRef.current) {
        restartTimerRef.current = setTimeout(() => {
          if (enabledRef.current && !firedRef.current) {
            startWake();
          }
        }, 250);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        // Permanently disable — user denied mic permission
        enabledRef.current = false;
        setIsListeningForWake(false);
        return;
      }
      // "aborted" / "no-speech" — onend handles restart
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsListeningForWake(true);
    } catch {
      // Another recognizer may already hold the mic — back off and retry
      restartTimerRef.current = setTimeout(() => {
        if (enabledRef.current) startWake();
      }, 800);
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      const timer = setTimeout(() => startWake(), 400);
      return () => clearTimeout(timer);
    } else {
      stopWake();
    }
  }, [enabled, startWake, stopWake]);

  // Cleanup on unmount — set flags first so any in-flight restart timers abort
  useEffect(() => {
    return () => {
      enabledRef.current = false;
      firedRef.current = true;
      stopWake();
    };
  }, [stopWake]);

  return { isListeningForWake, isSupported };
}
