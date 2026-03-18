"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cleanTextForTTS } from "@/lib/utils/latex-to-spoken";
import { useAudioDeviceMonitor } from "@/hooks/useAudioDeviceMonitor";

interface UseVoiceOutputResult {
  speak: (text: string) => void;
  stop: () => void;
  isSpeaking: boolean;
  isSupported: boolean;
  /** Call once inside a user gesture (tap) to unlock iOS audio for the session. */
  unlockAudio: () => void;
}

/** Minimum safety timeout per utterance (ms). */
const MIN_UTTERANCE_TIMEOUT_MS = 5_000;
/** Milliseconds per character for estimating max speech duration. */
const MS_PER_CHARACTER = 80;
/** iOS pauses speechSynthesis after ~15s — resume every 5s to prevent it. */
const IOS_RESUME_INTERVAL_MS = 5_000;
/** Max sentence length before splitting (iOS drops long utterances). */
const MAX_UTTERANCE_CHARS = 200;

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

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

/**
 * Splits long sentences at comma/semicolon boundaries so iOS doesn't drop them.
 */
function chunkLongSentence(sentence: string): string[] {
  if (sentence.length <= MAX_UTTERANCE_CHARS) return [sentence];
  const chunks: string[] = [];
  let remaining = sentence;
  while (remaining.length > MAX_UTTERANCE_CHARS) {
    // Find the last comma or semicolon within the limit
    let splitAt = -1;
    for (let i = MAX_UTTERANCE_CHARS - 1; i >= 40; i--) {
      if (remaining[i] === "," || remaining[i] === ";") {
        splitAt = i + 1;
        break;
      }
    }
    // No good break point — hard split at limit
    if (splitAt === -1) splitAt = MAX_UTTERANCE_CHARS;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Select the best TTS voice for English. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  // Prefer en-IN, then en-US, then any English
  const enIN = voices.find((v) => v.lang === "en-IN");
  if (enIN) return enIN;
  const google = voices.find((v) => v.name.includes("Google") && v.lang.startsWith("en"));
  if (google) return google;
  const enUS = voices.find((v) => v.lang === "en-US");
  if (enUS) return enUS;
  const anyEn = voices.find((v) => v.lang.startsWith("en"));
  if (anyEn) return anyEn;
  return null;
}

export function useVoiceOutput(): UseVoiceOutputResult {
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const queueRef = useRef<string[]>([]);
  const activeRef = useRef<boolean>(false);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const isIOSRef = useRef(false);
  const audioUnlockedRef = useRef(false);

  const supported = typeof window !== "undefined" && !!window.speechSynthesis;

  // Detect iOS and set up voice selection on mount
  useEffect(() => {
    if (!supported) return;
    isIOSRef.current = detectIOS();

    // Pick voice immediately (may be empty on Safari, re-picked on voiceschanged)
    voiceRef.current = pickVoice();

    const onVoicesChanged = () => {
      voiceRef.current = pickVoice();
    };
    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
    };
  }, [supported]);

  const startResumeInterval = useCallback(() => {
    if (!isIOSRef.current || resumeIntervalRef.current) return;
    resumeIntervalRef.current = setInterval(() => {
      if (typeof window !== "undefined" && window.speechSynthesis && activeRef.current) {
        window.speechSynthesis.resume();
      }
    }, IOS_RESUME_INTERVAL_MS);
  }, []);

  const clearResumeInterval = useCallback(() => {
    if (resumeIntervalRef.current) {
      clearInterval(resumeIntervalRef.current);
      resumeIntervalRef.current = null;
    }
  }, []);

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
      clearResumeInterval();
      return;
    }

    const sentence = queueRef.current.shift()!;
    // Convert LaTeX to spoken words and strip markdown
    const clean = cleanTextForTTS(sentence);

    if (!clean) {
      speakNext();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(clean);
    // Use the selected voice's actual language — hardcoding en-IN while
    // the selected voice is en-US causes iOS to silently drop the utterance.
    utterance.lang = voiceRef.current?.lang ?? "en-IN";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    if (voiceRef.current) {
      utterance.voice = voiceRef.current;
    }

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

    // Start iOS keep-alive resume interval
    startResumeInterval();

    // Safety timeout: if onend never fires, force-advance
    const timeoutMs = Math.max(MIN_UTTERANCE_TIMEOUT_MS, clean.length * MS_PER_CHARACTER);
    safetyTimerRef.current = setTimeout(() => {
      safetyTimerRef.current = null;
      window.speechSynthesis.cancel();
      speakNext();
    }, timeoutMs);
  }, [clearResumeInterval, startResumeInterval]);

  // Re-pick voice and reset synthesis when audio devices change (earphone plug/unplug)
  useAudioDeviceMonitor({
    enabled: supported,
    onDeviceChange: useCallback(() => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      voiceRef.current = pickVoice();

      // If we were speaking, restart the queue after a delay for device to settle
      if (activeRef.current && queueRef.current.length > 0) {
        setTimeout(() => {
          if (queueRef.current.length > 0) {
            speakNext();
          } else {
            activeRef.current = false;
            setIsSpeaking(false);
          }
        }, 500);
      }
    }, [speakNext])
  });

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;

      // Chrome bug: synthesis may claim speaking while our queue is empty (stale state)
      if (window.speechSynthesis.speaking && !activeRef.current) {
        window.speechSynthesis.cancel();
      }

      const sentences = splitIntoSentences(text);
      if (sentences.length === 0) return;

      // Chunk long sentences for iOS compatibility
      const chunks = sentences.flatMap(chunkLongSentence);
      queueRef.current.push(...chunks);

      if (!activeRef.current) {
        activeRef.current = true;
        setIsSpeaking(true);
        // iOS needs a longer delay after cancel than Chrome
        const delay = isIOSRef.current ? 250 : 50;
        setTimeout(speakNext, delay);
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
    clearResumeInterval();
    queueRef.current = [];
    activeRef.current = false;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [clearResumeInterval]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      if (resumeIntervalRef.current) clearInterval(resumeIntervalRef.current);
    };
  }, []);

  // iOS: recover from background/tab-switch freeze.  When the page comes back
  // to the foreground, speechSynthesis may be permanently frozen.  Cancel and
  // restart the queue so the user doesn't think voice is broken.
  useEffect(() => {
    if (!supported || !isIOSRef.current) return;

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && activeRef.current) {
        window.speechSynthesis.cancel();
        setTimeout(() => {
          if (queueRef.current.length > 0) {
            speakNext();
          } else {
            activeRef.current = false;
            setIsSpeaking(false);
            clearResumeInterval();
          }
        }, 300);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [supported, speakNext, clearResumeInterval]);

  const unlockAudio = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;

    // Clear any stale synthesis state first
    window.speechSynthesis.cancel();

    // iOS requires a speak() call inside a user gesture to permit future synthesis.
    // rate must be ≤ 4 (iOS silently drops utterances with rate > ~4).
    // volume must be > 0 (some iOS versions won't unlock at 0).
    const silent = new SpeechSynthesisUtterance("");
    silent.volume = 0.01;
    silent.rate = 2;

    // Set voice explicitly so iOS doesn't fail on a missing default voice.
    const voice = pickVoice();
    if (voice) {
      silent.voice = voice;
      silent.lang = voice.lang;
    } else {
      silent.lang = "en-US";
    }

    window.speechSynthesis.speak(silent);
  }, []);

  return { speak, stop, isSpeaking, isSupported: supported, unlockAudio };
}
