"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Monitors audio device changes (earphone plug/unplug, Bluetooth connect/disconnect).
 * Exposes a counter that increments on each change, plus an optional callback.
 *
 * Consumers should use `deviceChangeCount` as a dependency or listen to `onDeviceChange`
 * to restart their audio pipelines (SpeechRecognition, speechSynthesis, etc.).
 */
interface UseAudioDeviceMonitorOptions {
  /** Called when an audio device change is detected. */
  onDeviceChange?: () => void;
  /** Whether monitoring is enabled. Defaults to true. */
  enabled?: boolean;
}

interface UseAudioDeviceMonitorResult {
  /** Increments on each device change event. Use as a React dependency. */
  deviceChangeCount: number;
}

/** Debounce delay — device change events often fire in rapid bursts. */
const DEBOUNCE_MS = 600;

export function useAudioDeviceMonitor({
  onDeviceChange,
  enabled = true
}: UseAudioDeviceMonitorOptions = {}): UseAudioDeviceMonitorResult {
  const [deviceChangeCount, setDeviceChangeCount] = useState(0);
  const callbackRef = useRef(onDeviceChange);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    callbackRef.current = onDeviceChange;
  }, [onDeviceChange]);

  const handleDeviceChange = useCallback(() => {
    // Debounce: OS may fire multiple events for a single plug/unplug
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setDeviceChangeCount((c) => c + 1);
      callbackRef.current?.();
    }, DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [enabled, handleDeviceChange]);

  return { deviceChangeCount };
}
