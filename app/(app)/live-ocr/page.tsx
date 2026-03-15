"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CheckCircle2, Mic, ScanSearch, Send, Square } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { StreamingText } from "@/components/chat/StreamingText";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { useCamera } from "@/hooks/useCamera";
import { useLiveOCRAgent } from "@/hooks/useLiveOCRAgent";
import { AGENT_OPENERS, type ExamType } from "@/types/exam";

const VALID_EXAMS: readonly ExamType[] = ["CAT", "GMAT", "NEET", "UPSC", "JEE"];

const EXAM_ACCENTS: Record<ExamType, string> = {
  CAT: "from-blue-500/20 via-cyan-500/10 to-transparent",
  GMAT: "from-fuchsia-500/20 via-violet-500/10 to-transparent",
  NEET: "from-rose-500/20 via-red-500/10 to-transparent",
  UPSC: "from-amber-500/20 via-orange-500/10 to-transparent",
  JEE: "from-emerald-500/20 via-lime-500/10 to-transparent"
};

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

function formatScanTime(value: number | null): string {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
}

export default function LiveOCRPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const examParam = searchParams.get("exam");
  const hasExplicitExam = examParam !== null;
  const hasInvalidExam = hasExplicitExam && !VALID_EXAMS.includes(examParam as ExamType);
  const exam = !hasExplicitExam ? "JEE" : hasInvalidExam ? "JEE" : (examParam as ExamType);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [textInput, setTextInput] = useState<string>("");
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(true);

  const { isActive, permissionError, noCameraAvailable, startCamera, stopCamera } = useCamera();
  const {
    alwaysOnVoice,
    autoScanEnabled,
    error,
    initialized,
    interrupt,
    isScanning,
    lastScanAt,
    messages,
    microphoneAvailable,
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
    toggleAlwaysOnVoice,
    toggleAutoScan,
    transcript
  } = useLiveOCRAgent(exam, videoRef, voiceOutputEnabled);

  useEffect(() => {
    const currentVideoElement = videoRef.current;
    void startCamera(currentVideoElement);

    return () => {
      stopCamera(currentVideoElement);
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status, streamingText]);

  const statusMeta = useMemo(
    () => ({
      idle: { dot: "bg-foreground/40", label: isActive ? "Camera live" : "Connecting camera" },
      listening: { dot: "bg-green-500", label: "Listening" },
      thinking: { dot: "bg-amber-500", label: "Thinking" },
      speaking: { dot: "bg-sky-500", label: "Speaking" }
    }),
    [isActive]
  );
  const hasDeepScan = pageContext.length > 0;
  const formattedScanTime = formatScanTime(lastScanAt);
  const latestScan = scanHistory[scanHistory.length - 1] ?? null;

  if (hasInvalidExam) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 text-center">
        <div className="max-w-md border border-border bg-background p-6">
          <p className="text-base text-foreground/80">That exam selection is not available.</p>
          <button
            className="mt-4 border border-foreground px-4 py-2 text-sm hover:bg-foreground hover:text-background"
            onClick={() => router.push("/exam-select")}
            type="button"
          >
            Choose an exam
          </button>
        </div>
      </main>
    );
  }

  if (permissionError) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 text-center">
        <div className="max-w-md border border-border bg-background p-6">
          <p className="text-base text-foreground/80">
            Camera access is required so Clarity can see your notebook while you talk.
          </p>
          <button
            className="mt-4 border border-foreground px-4 py-2 text-sm hover:bg-foreground hover:text-background"
            onClick={() => router.push("/exam-select")}
            type="button"
          >
            Back to exam selection
          </button>
        </div>
      </main>
    );
  }

  if (noCameraAvailable) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 text-center">
        <div className="max-w-md border border-border bg-background p-6">
          <p className="text-base text-foreground/80">No camera was detected on this device.</p>
          <button
            className="mt-4 border border-foreground px-4 py-2 text-sm hover:bg-foreground hover:text-background"
            onClick={() => router.push("/exam-select")}
            type="button"
          >
            Back to exam selection
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <AppHeader title={`Live OCR + Voice — ${exam}`} />

      {!microphoneAvailable ? (
        <div className="mx-auto mt-4 max-w-6xl border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-700">
          Voice input is not available in this browser. You can still scan and type your questions.
        </div>
      ) : null}

      <section className="mx-auto grid min-h-[calc(100vh-57px)] max-w-6xl gap-4 px-4 py-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="relative overflow-hidden border border-border bg-black">
          <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${EXAM_ACCENTS[exam]}`} />
          <video className="h-full min-h-[320px] w-full object-cover" muted playsInline ref={videoRef} />

          <div className="absolute left-3 right-3 top-3 flex flex-wrap items-start justify-between gap-2 text-background">
            <div className="border border-white/30 bg-black/45 px-3 py-2 backdrop-blur-sm">
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/70">Live tutor</p>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusMeta[status].dot}`} />
                <span>{statusMeta[status].label}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {hasDeepScan ? (
                <div className="flex items-center gap-2 border border-emerald-300/50 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-100 backdrop-blur-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Deep scan ready</span>
                </div>
              ) : null}
              {autoScanEnabled && !quotaExhausted ? (
                <div className="flex items-center gap-1.5 border border-emerald-300/40 bg-black/45 px-2 py-2 text-[10px] text-emerald-200 backdrop-blur-sm">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  Auto-scan
                </div>
              ) : null}
              <button
                className="border border-white/25 bg-black/45 px-3 py-2 text-xs font-medium backdrop-blur-sm hover:bg-black/60 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isScanning || quotaExhausted}
                onClick={() => void scanPage()}
                title="Scan current page"
                type="button"
              >
                {isScanning ? "Scanning..." : "Scan page"}
              </button>
              <button
                className="border border-white/25 bg-black/45 px-3 py-2 text-xs font-medium backdrop-blur-sm hover:bg-black/60"
                onClick={() => router.push("/exam-select")}
                title="Change exam"
                type="button"
              >
                Change exam
              </button>
            </div>
          </div>

          <AnimatePresence>
            {isScanning ? (
              <motion.div
                animate={{ opacity: 0 }}
                className="pointer-events-none absolute inset-0 bg-white"
                initial={{ opacity: 0.25 }}
                transition={{ duration: 0.25 }}
              />
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {scanSummary && !isScanning ? (
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="absolute left-3 top-20 max-w-sm border border-emerald-200/40 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-50 backdrop-blur-sm"
                exit={{ opacity: 0, y: -8 }}
                initial={{ opacity: 0, y: -8 }}
              >
                {scanSummary}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="absolute bottom-3 left-3 right-3 grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
            <div className="border border-white/15 bg-black/65 p-3 text-white backdrop-blur-sm">
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/60">Current frame context</p>
              <p className="mt-2 text-sm leading-6 text-white/85">
                Every question automatically includes the camera frame you are looking at right now.
              </p>
            </div>

            <div
              className={[
                "border bg-black/65 p-3 text-white backdrop-blur-sm transition-colors",
                hasDeepScan ? "border-emerald-300/40" : "border-white/15"
              ].join(" ")}
            >
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/60">Deep scan memory</p>
              {formattedScanTime ? (
                <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-emerald-200/80">
                  Captured at {formattedScanTime}
                </p>
              ) : null}
              <p className="mt-2 text-sm leading-6 text-white/85">
                {scanSummary && !pageContext
                  ? scanSummary
                  : latestScan
                  ? truncate(latestScan.text, 180)
                  : quotaExhausted
                    ? "OCR quota is exhausted, so deep page scans are paused for now."
                    : "Use Scan page when you want Clarity to read the whole sheet more carefully."}
              </p>
              {scanHistory.length > 1 ? (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/75">
                    {scanHistory.length} pages in memory
                  </p>
                  <div className="mt-2 flex max-h-28 flex-col gap-2 overflow-y-auto pr-1">
                    {scanHistory
                      .slice()
                      .reverse()
                      .map((entry, index) => (
                        <div key={entry.id} className="border border-white/10 bg-white/5 px-2 py-2 text-xs text-white/80">
                          <p className="uppercase tracking-[0.16em] text-white/45">
                            Page {scanHistory.length - index} at {formatScanTime(entry.scannedAt)}
                          </p>
                          <p className="mt-1 leading-5">{truncate(entry.text, 120)}</p>
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex min-h-[520px] flex-col border border-border bg-background">
          <div className="border-b border-border px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-foreground/45">Conversation</p>
                <h2 className="mt-1 text-xl font-semibold">One tutor, voice and vision together</h2>
              </div>
              <div className="border border-border px-3 py-2 text-right">
                <p className="text-[11px] uppercase tracking-[0.2em] text-foreground/45">Exam</p>
                <p className="mt-1 text-sm font-medium">{exam}</p>
              </div>
            </div>
            <p className="mt-3 max-w-xl text-sm leading-6 text-foreground/70">
              {AGENT_OPENERS[exam]}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 && !initialized ? (
                <div className="flex flex-1 items-center justify-center">
                  <div className="max-w-md border border-dashed border-border px-5 py-6 text-center">
                    <Camera className="mx-auto h-6 w-6 text-foreground/60" />
                    <p className="mt-3 text-sm leading-6 text-foreground/75">
                      Point the camera at your work, then ask naturally. Every voice turn sends the live frame automatically.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((message) => (
                    <ChatBubble key={message.id} message={message} />
                  ))}
                  {streamingText ? <StreamingText text={streamingText} /> : null}
                  {status === "thinking" && !streamingText ? <TypingIndicator /> : null}
                </>
              )}
              <div ref={bottomRef} />
            </div>

            <AnimatePresence>
              {transcript ? (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="mx-4 mb-3 border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800"
                  exit={{ opacity: 0, y: 8 }}
                  initial={{ opacity: 0, y: 8 }}
                >
                  <span className="font-medium">You said:</span> {transcript}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {error ? (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="mx-4 mb-3 border-l-4 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700"
                  exit={{ opacity: 0, y: 8 }}
                  initial={{ opacity: 0, y: 8 }}
                >
                  {error}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="border-t border-border px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className={[
                    "flex h-12 w-12 items-center justify-center rounded-full border transition-colors",
                    status === "listening"
                      ? "border-green-500 bg-green-50 text-green-600"
                      : status === "thinking" || status === "speaking"
                        ? "border-red-400 bg-red-50 text-red-600"
                        : alwaysOnVoice
                          ? "border-sky-500 bg-sky-50 text-sky-600 ring-2 ring-sky-300"
                          : "border-border bg-background text-foreground hover:border-foreground",
                    !microphoneAvailable ? "cursor-not-allowed opacity-50" : ""
                  ].join(" ")}
                  disabled={!microphoneAvailable}
                  onClick={() => {
                    if (status === "thinking" || status === "speaking") {
                      interrupt();
                      return;
                    }
                    if (status === "listening") {
                      stopListening();
                      return;
                    }
                    startListening();
                  }}
                  title={status === "listening" ? "Stop listening" : status === "thinking" || status === "speaking" ? "Interrupt" : "Start listening"}
                  type="button"
                >
                  {status === "thinking" || status === "speaking" ? (
                    <Square className="h-4 w-4" />
                  ) : (
                    <Mic className="h-5 w-5" />
                  )}
                </button>

                <button
                  className={[
                    "flex h-12 items-center gap-2 border px-3 text-xs font-medium transition-colors",
                    alwaysOnVoice
                      ? "border-sky-500 bg-sky-50 text-sky-700 hover:border-sky-700"
                      : "border-border text-foreground/60 hover:border-foreground"
                  ].join(" ")}
                  disabled={!microphoneAvailable}
                  onClick={toggleAlwaysOnVoice}
                  title={alwaysOnVoice ? "Always-on listening active — click to disable" : "Enable always-on listening"}
                  type="button"
                >
                  {alwaysOnVoice ? "Always on ●" : "Always on"}
                </button>

                <div className="flex items-center">
                  <button
                    className={[
                      "flex h-12 items-center gap-2 border px-4 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      hasDeepScan ? "border-emerald-400/60 bg-emerald-50 hover:border-emerald-600" : "border-border hover:border-foreground"
                    ].join(" ")}
                    disabled={isScanning || quotaExhausted}
                    onClick={() => void scanPage()}
                    title="Scan current page now"
                    type="button"
                  >
                    <ScanSearch className="h-4 w-4" />
                    {isScanning ? "Scanning page" : "Scan now"}
                  </button>
                  <button
                    className={[
                      "flex h-12 items-center border-b border-r border-t px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      autoScanEnabled
                        ? "border-emerald-400/60 bg-emerald-50 text-emerald-700 hover:border-emerald-600"
                        : "border-border text-foreground/40 hover:border-foreground"
                    ].join(" ")}
                    disabled={quotaExhausted}
                    onClick={toggleAutoScan}
                    title={autoScanEnabled ? "Auto-scan is on (every 8s) — click to disable" : "Enable auto-scan"}
                    type="button"
                  >
                    {autoScanEnabled ? "Auto ●" : "Auto"}
                  </button>
                </div>

                <button
                  className={[
                    "flex h-12 items-center gap-2 border px-4 text-sm transition-colors",
                    voiceOutputEnabled
                      ? "border-sky-400/60 bg-sky-50 text-sky-700 hover:border-sky-600"
                      : "border-border text-foreground/50 hover:border-foreground"
                  ].join(" ")}
                  onClick={() => setVoiceOutputEnabled((v) => !v)}
                  type="button"
                >
                  {voiceOutputEnabled ? "Voice on" : "Voice off"}
                </button>

                <div className="min-w-[140px] text-xs uppercase tracking-[0.22em] text-foreground/45">
                  {status === "idle"
                    ? "Ready"
                    : status === "listening"
                      ? "Listening"
                      : status === "thinking"
                        ? "Thinking"
                        : "Speaking"}
                </div>
              </div>

              <div className="mt-3 flex items-end gap-2">
                <textarea
                  className="min-h-12 flex-1 resize-none border border-border bg-background px-3 py-3 text-sm outline-none transition-colors focus:border-foreground"
                  disabled={status === "thinking"}
                  maxLength={2000}
                  onChange={(event) => setTextInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      const nextText = textInput.trim();
                      if (!nextText) {
                        return;
                      }
                      setTextInput("");
                      void submitText(nextText);
                    }
                  }}
                  placeholder="Ask about the step you are showing, or type 'scan this page'..."
                  rows={2}
                  value={textInput}
                />
                <button
                  aria-label="Send message"
                  className="flex h-12 w-12 items-center justify-center border border-foreground bg-foreground text-background disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={status === "thinking" || textInput.trim().length === 0}
                  onClick={() => {
                    const nextText = textInput.trim();
                    if (!nextText) {
                      return;
                    }
                    setTextInput("");
                    void submitText(nextText);
                  }}
                  type="button"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
