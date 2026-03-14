"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useInterrupt } from "@/hooks/useInterrupt";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useVoiceOutput } from "@/hooks/useVoiceOutput";
import { consumeSSE } from "@/lib/sse-client";
import { buildAdaptiveLiveOCRPrompt } from "@/lib/prompts/live-ocr";
import { createSessionTracker, updateSession, type SessionTracker } from "@/lib/utils/session-tracker";
import type { ImageInput, Message } from "@/types";
import type { ExamType } from "@/types/exam";

type AgentStatus = "idle" | "listening" | "thinking" | "speaking";

interface ScanMemoryEntry {
  id: string;
  scannedAt: number;
  text: string;
}

interface UseLiveOCRAgentResult {
  error: string | null;
  initialized: boolean;
  isScanning: boolean;
  lastScanAt: number | null;
  messages: Message[];
  microphoneAvailable: boolean;
  pageContext: string;
  quotaExhausted: boolean;
  scanPage: () => Promise<void>;
  scanHistory: ScanMemoryEntry[];
  scanSummary: string | null;
  startListening: () => void;
  status: AgentStatus;
  stopListening: () => void;
  streamingText: string;
  submitText: (text: string) => Promise<void>;
  transcript: string;
  interrupt: () => void;
}

const CONTEXT_WINDOW = 6;
const MIN_WORDS = 3;
const JPEG_QUALITY = 0.72;
const MAX_CAPTURE_WIDTH = 960;
const MAX_CAPTURE_HEIGHT = 720;
const MAX_SCAN_MEMORY_PAGES = 4;
const SAME_PAGE_SIMILARITY_THRESHOLD = 0.985;

const DEEP_SCAN_PREFIX = String.raw`(?:can you\s+|could you\s+|would you\s+|please\s+)?(?:scan|read|analy[sz]e|look at)\s+(?:this|the)\s+(?:page|sheet|notebook|problem|question)`;
const DEEP_SCAN_EXACT_PATTERN = new RegExp(`^${DEEP_SCAN_PREFIX}(?:\s+for me)?(?:\s+please)?[.!?]*$`, "i");
const DEEP_SCAN_WITH_FOLLOW_UP_PATTERN = new RegExp(
  `^${DEEP_SCAN_PREFIX}(?:\\s+for me)?(?:\\s+please)?(?:\\s*(?:,|and then|then|and)\\s+)(.+)$`,
  "i"
);

function buildMessage(role: Message["role"], content: string): Message {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now()
  };
}

function buildScanMemoryEntry(text: string, scannedAt: number): ScanMemoryEntry {
  return {
    id: `scan-${scannedAt}-${Math.random().toString(36).slice(2, 8)}`,
    scannedAt,
    text
  };
}

function buildPageContext(scanHistory: ScanMemoryEntry[]): string {
  if (scanHistory.length === 0) {
    return "";
  }

  return scanHistory
    .map((entry, index) => `[Scanned page ${index + 1}] ${entry.text}`)
    .join("\n\n");
}

function loadImageFromBase64(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode frame image"));
    image.src = base64;
  });
}

async function hashFrame(base64: string): Promise<string> {
  const image = await loadImageFromBase64(base64);
  const canvas = document.createElement("canvas");
  const size = 16;
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }

  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const grayValues: string[] = [];

  for (let index = 0; index < pixels.length; index += 4) {
    const gray = Math.round((pixels[index] * 0.3 + pixels[index + 1] * 0.59 + pixels[index + 2] * 0.11) / 4) * 4;
    grayValues.push(gray.toString(16).padStart(2, "0"));
  }

  return grayValues.join("");
}

function similarity(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) {
    return 0;
  }

  let same = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) {
      same += 1;
    }
  }

  return same / a.length;
}

function trimMessages(messages: Message[]): Message[] {
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

function parseDeepScanCommand(text: string): { followUpText: string | null; shouldScan: boolean } {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { followUpText: null, shouldScan: false };
  }

  const followUpMatch = normalized.match(DEEP_SCAN_WITH_FOLLOW_UP_PATTERN);
  if (followUpMatch) {
    const followUpText = followUpMatch[1]?.trim() ?? "";
    return {
      followUpText: followUpText.length > 0 ? followUpText : null,
      shouldScan: true
    };
  }

  return {
    followUpText: null,
    shouldScan: DEEP_SCAN_EXACT_PATTERN.test(normalized)
  };
}

function cleanSpeechText(text: string): string {
  return text
    .replace(/\$\$[^$]*\$\$/g, "equation")
    .replace(/\$[^$]*\$/g, "expression")
    .replace(/[*_~`#>]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

function nextSentenceBoundary(text: string, startIndex: number): number {
  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];
    if ((character === "." || character === "!" || character === "?") && (!nextCharacter || /\s/.test(nextCharacter))) {
      return index + 1;
    }
  }

  return -1;
}

function extractImageInput(videoElement: HTMLVideoElement | null, canvas: HTMLCanvasElement): ImageInput | null {
  if (!videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
    return null;
  }

  const sourceWidth = videoElement.videoWidth;
  const sourceHeight = videoElement.videoHeight;
  const scale = Math.min(MAX_CAPTURE_WIDTH / sourceWidth, MAX_CAPTURE_HEIGHT / sourceHeight, 1);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.drawImage(videoElement, 0, 0, width, height);

  return {
    base64: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
    mimeType: "image/jpeg"
  };
}

export function useLiveOCRAgent(exam: ExamType, videoRef: RefObject<HTMLVideoElement>, voiceOutputEnabled = true): UseLiveOCRAgentResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [scanHistory, setScanHistory] = useState<ScanMemoryEntry[]>([]);
  const [streamingText, setStreamingText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState<boolean>(false);
  const [scanSummary, setScanSummary] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const sessionRef = useRef<SessionTracker>(createSessionTracker());
  const lastScanHashRef = useRef<string>("");
  const scanHistoryRef = useRef<ScanMemoryEntry[]>([]);
  const pageContextRef = useRef<string>("");
  const statusRef = useRef<AgentStatus>("idle");
  const turnInProgressRef = useRef<boolean>(false);

  const pageContext = useMemo(() => buildPageContext(scanHistory), [scanHistory]);

  const { speak, stop: stopSpeaking, isSpeaking } = useVoiceOutput();
  const { transcript, isListening, isSupported, startListening, stopListening } = useVoiceInput({
    onTranscript: (text) => {
      void submitText(text);
    }
  });
  const { interrupt: baseInterrupt, createAbortSignal } = useInterrupt({
    stopListening,
    stopSpeaking
  });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    scanHistoryRef.current = scanHistory;
    pageContextRef.current = buildPageContext(scanHistory);
  }, [scanHistory]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (isListening) {
      setStatus("listening");
      return;
    }

    if (statusRef.current === "listening" && !turnInProgressRef.current) {
      setStatus("idle");
    }
  }, [isListening]);

  useEffect(() => {
    if (!isSpeaking && statusRef.current === "speaking") {
      setStatus("idle");
    }
  }, [isSpeaking]);

  useEffect(() => {
    if (!voiceOutputEnabled) {
      stopSpeaking();
    }
  }, [voiceOutputEnabled, stopSpeaking]);

  const captureFrame = useCallback((): ImageInput | null => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }

    return extractImageInput(videoRef.current, canvasRef.current);
  }, [videoRef]);

  const speakProgressively = useCallback(
    (fullText: string, spokenUntil: number): number => {
      let nextIndex = spokenUntil;

      while (true) {
        const boundary = nextSentenceBoundary(fullText, nextIndex);
        if (boundary === -1) {
          return nextIndex;
        }

        const sentence = cleanSpeechText(fullText.slice(nextIndex, boundary));
        if (sentence) {
          if (voiceOutputEnabled) {
            speak(sentence);
            if (statusRef.current === "thinking") {
              setStatus("speaking");
            }
          }
        }
        nextIndex = boundary;
      }
    },
    [speak, voiceOutputEnabled]
  );

  const sendStudentTurn = useCallback(
    async (trimmed: string): Promise<void> => {
      if (trimmed.split(/\s+/).length < MIN_WORDS) {
        setError("Say a little more so I have enough context to help.");
        return;
      }

      turnInProgressRef.current = true;
      baseInterrupt();
      setError(null);
      setStreamingText("");
      setInitialized(true);

      const userMessage = buildMessage("user", trimmed);
      const nextMessages = [...messagesRef.current, userMessage];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      setStatus("thinking");

      const session = sessionRef.current;
      const adaptivePrompt = buildAdaptiveLiveOCRPrompt(exam, {
        stuckCount: session.conceptMap[session.currentConcept]?.stuckCount ?? 0,
        currentConcept: session.currentConcept
      });

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: createAbortSignal(),
          body: JSON.stringify({
            exam,
            image: captureFrame() ?? undefined,
            messages: trimMessages(nextMessages),
            mode: "live_ocr_agent",
            ocrText: pageContextRef.current || undefined,
            systemPrompt: adaptivePrompt
          })
        });

        if (!response.ok) {
          if (response.status === 429) {
            setError("Rate limit reached. Wait a moment and try again.");
          } else if (response.status === 401) {
            setError("Please sign in to continue.");
          } else {
            const errorText = await response.text();
            setError(errorText || `API error: ${response.status}`);
          }
          setStatus("idle");
          return;
        }

        let fullText = "";
        let spokenUntil = 0;

        await consumeSSE(response, (data) => {
          if (data === "[DONE]") {
            return;
          }
          if (data.startsWith("[ERROR]")) {
            throw new Error(data.slice(8) || "Streaming failed");
          }

          const token = JSON.parse(data) as string;
          fullText += token;
          setStreamingText(fullText);
          spokenUntil = speakProgressively(fullText, spokenUntil);
        });

        const trailingText = cleanSpeechText(fullText.slice(spokenUntil));
        if (trailingText && voiceOutputEnabled) {
          speak(trailingText);
          if (statusRef.current === "thinking") {
            setStatus("speaking");
          }
        }

        if (fullText.trim()) {
          const assistantMessage = buildMessage("assistant", fullText.trim());
          messagesRef.current = [...messagesRef.current, assistantMessage];
          setMessages(messagesRef.current);
          updateSession(sessionRef.current, trimmed, fullText.trim());
        }

        setStreamingText("");
        // If voice is off (or response had no speakable content), nothing transitions
        // status from "thinking" → "idle" via the isSpeaking effect, so do it here.
        if (statusRef.current === "thinking") {
          setStatus("idle");
        }
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") {
          setStreamingText("");
          setStatus("idle");
          return;
        }

        const nextError = cause instanceof Error ? cause.message : String(cause);
        setError(nextError);
        setStreamingText("");
        setStatus("idle");
      } finally {
        turnInProgressRef.current = false;
      }
    },
    [baseInterrupt, captureFrame, createAbortSignal, exam, speak, speakProgressively, voiceOutputEnabled]
  );

  const runDeepScan = useCallback(async (): Promise<boolean> => {
    const frame = captureFrame();
    if (!frame || isScanning) {
      return false;
    }

    let currentHash = "";

    try {
      currentHash = await hashFrame(frame.base64);
      const samePageAlreadyScanned =
        scanHistoryRef.current.length > 0 && similarity(lastScanHashRef.current, currentHash) >= SAME_PAGE_SIMILARITY_THRESHOLD;

      if (samePageAlreadyScanned) {
        setInitialized(true);
        setScanSummary("This page already matches your latest deep scan. Ask your question or move to a new page.");
        return true;
      }
    } catch (cause) {
      console.warn("Deep scan dedupe failed, continuing with OCR request:", cause);
    }

    setIsScanning(true);
    setError(null);
    setInitialized(true);

    try {
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: frame.base64 })
      });

      if (!response.ok) {
        if (response.status === 429) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
            retryAfterSeconds?: number;
          };

          if (payload.error === "quota_exhausted") {
            setQuotaExhausted(true);
            setError(payload.message || "API Quota Exhausted");
            setScanSummary("Quota Limit Reached");
            return false;
          }

          const retrySuffix = payload.retryAfterSeconds ? ` Retry in about ${payload.retryAfterSeconds} seconds.` : " Please try again in a moment.";
          setScanSummary(`OCR is busy right now.${retrySuffix}`);
          setError((payload.message ?? "OCR service is temporarily busy.") + retrySuffix);
          return false;
        }

        try {
          const errorJson = await response.json();
          const niceMessage = errorJson.message || errorJson.error || "OCR failed";
          const technicalDetails = errorJson.details ? ` (${errorJson.details})` : "";
          setError(`${niceMessage}${technicalDetails}`);
        } catch {
          const errorText = await response.text();
          setError(errorText || `OCR error: ${response.status}`);
        }
        return false;
      }

      const payload = (await response.json()) as { text?: string };
      const nextText = payload.text?.trim() ?? "";
      if (!nextText) {
        setScanSummary("Deep scan finished, but the page text was still too unclear.");
        setError("I could not read enough from the page. Try adjusting the camera.");
        return false;
      }

      const scannedAt = Date.now();
      const lastEntry = scanHistoryRef.current[scanHistoryRef.current.length - 1];
      const nextHistory =
        lastEntry?.text === nextText
          ? [...scanHistoryRef.current.slice(0, -1), { ...lastEntry, scannedAt }]
          : [...scanHistoryRef.current, buildScanMemoryEntry(nextText, scannedAt)].slice(-MAX_SCAN_MEMORY_PAGES);

      scanHistoryRef.current = nextHistory;
      setScanHistory(nextHistory);
      setLastScanAt(scannedAt);
      if (currentHash) {
        lastScanHashRef.current = currentHash;
      }
      setScanSummary(
        nextHistory.length === 1
          ? "Deep scan ready. I will use this page text in follow-up questions."
          : `Deep scan saved. I now remember ${nextHistory.length} scanned pages for this session.`
      );
      return true;
    } catch (cause) {
      const nextError = cause instanceof Error ? cause.message : String(cause);
      setError(nextError);
      return false;
    } finally {
      setIsScanning(false);
    }
  }, [captureFrame, isScanning]);

  const submitText = useCallback(
    async (rawText: string): Promise<void> => {
      const trimmed = rawText.trim();
      if (!trimmed) {
        return;
      }

      const scanCommand = parseDeepScanCommand(trimmed);
      if (scanCommand.shouldScan) {
        const scanSucceeded = await runDeepScan();
        if (scanSucceeded && scanCommand.followUpText) {
          await sendStudentTurn(scanCommand.followUpText);
        }
        return;
      }

      await sendStudentTurn(trimmed);
    },
    [runDeepScan, sendStudentTurn]
  );

  const scanPage = useCallback(async (): Promise<void> => {
    await runDeepScan();
  }, [runDeepScan]);

  const interrupt = useCallback(() => {
    baseInterrupt();
    setStreamingText("");
    setStatus("idle");
  }, [baseInterrupt]);

  return useMemo(
    () => ({
      error,
      initialized,
      interrupt,
      isScanning,
      lastScanAt,
      messages,
      microphoneAvailable: isSupported,
      pageContext,
      quotaExhausted,
      scanPage,
      scanHistory,
      scanSummary,
      startListening,
      status,
      stopListening,
      streamingText,
      submitText,
      transcript,
    }),
    [
      error,
      initialized,
      interrupt,
      isScanning,
      isSupported,
      lastScanAt,
      messages,
      pageContext,
      quotaExhausted,
      scanPage,
      scanHistory,
      scanSummary,
      startListening,
      status,
      stopListening,
      streamingText,
      submitText,
      transcript
    ]
  );
}