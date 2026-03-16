"use client";

import { useCallback, useRef } from "react";

/** Overall fetch timeout (ms). Generous to allow full streaming responses. */
const FETCH_TIMEOUT_MS = 90_000;

interface UseInterruptResult {
  /** Fire to immediately cancel TTS + abort streaming fetch. */
  interrupt: () => void;
  /** Get a new AbortSignal that auto-expires after a timeout. */
  createAbortSignal: (timeoutMs?: number) => AbortSignal;
}

interface InterruptDeps {
  stopSpeaking: () => void;
  stopListening: () => void;
}

export function useInterrupt(deps: InterruptDeps): UseInterruptResult {
  const abortRef = useRef<AbortController | null>(null);

  const createAbortSignal = useCallback((timeoutMs: number = FETCH_TIMEOUT_MS): AbortSignal => {
    // Abort any previous controller
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    return AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
  }, []);

  const interrupt = useCallback((): void => {
    // Both must fire synchronously — zero delay (Rule 3)
    deps.stopSpeaking();
    deps.stopListening();
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, [deps]);

  return { interrupt, createAbortSignal };
}
