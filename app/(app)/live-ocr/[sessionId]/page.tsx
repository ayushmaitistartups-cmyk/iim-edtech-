"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CheckCircle2, Menu, Mic, ScanSearch, Send, Square } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { StreamingText } from "@/components/chat/StreamingText";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { ChatHistorySidebar } from "@/components/ChatHistorySidebar";
import { useCamera } from "@/hooks/useCamera";
import { useChatPersistent } from "@/hooks/useChatPersistent";
import { useWakeWord } from "@/hooks/useWakeWord";
import { useLiveOCRAgent } from "@/hooks/useLiveOCRAgent";
import { AGENT_OPENERS, type ExamType } from "@/types/exam";
import { auth } from "@clerk/nextjs/server";

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
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
}

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default function LiveOCRSessionPage({ params }: PageProps): JSX.Element {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.sessionId;
  
  const router = useRouter();
  const searchParams = useSearchParams();
  const examParam = searchParams.get("exam");
  const hasExplicitExam = examParam !== null;
  const hasInvalidExam = hasExplicitExam && !VALID_EXAMS.includes(examParam as ExamType);
  const exam = !hasExplicitExam ? "JEE" : hasInvalidExam ? "JEE" : (examParam as ExamType);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [textInput, setTextInput] = useState<string>("");
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(true);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [justWoke, setJustWoke] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userId, setUserId] = useState<string>("");

  // Fetch user ID
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch("/api/user");
        if (res.ok) {
          const data = await res.json();
          setUserId(data.userId || "");
        }
      } catch (err) {
        console.error("Failed to fetch user:", err);
      }
    };
    fetchUser();
  }, []);

  const { isActive, permissionError, noCameraAvailable, startCamera, stopCamera } = useCamera();
  const {
    autoScanEnabled,
    error,
    initialized,
    interrupt,
    isScanning,
    lastScanAt,
    messages: ocrMessages,
    microphoneAvailable,
    pageContext,
    quotaExhausted,
    scanPage,
    scanHistory,
    scanSummary,
    startListening,
    status,
    stopListening,
    streamingText: ocrStreamingText,
    submitText,
    toggleAutoScan,
    transcript,
    unlockAudio
  } = useLiveOCRAgent(exam, videoRef, voiceOutputEnabled);

  const {
    messages,
    streamingText,
    isLoading,
    error: chatError,
    sendUserMessage,
    sessionId: currentSessionId,
    isHydrated
  } = useChatPersistent({
    sessionId,
    userId,
    onSessionCreated: (newSessionId) => {
      router.replace(`/live-ocr/${newSessionId}`);
    },
    onTitleUpdate: (title) => {
      console.log("Session title updated:", title);
    }
  });

  const allMessages = [...messages];

  const handleMicToggle = useCallback(() => {
    if (status === "listening") {
      stopListening();
    } else if (status === "idle" && microphoneAvailable) {
      unlockAudio();
      startListening();
    }
  }, [status, microphoneAvailable, stopListening, startListening, unlockAudio]);

  const handleStartCamera = useCallback(async () => {
    await startCamera(videoRef.current);
  }, [startCamera]);

  const handleStopCamera = useCallback(() => {
    stopCamera(videoRef.current);
  }, [stopCamera]);

  const handleSendText = useCallback(async () => {
    const text = textInput.trim();
    if (!text) return;
    setTextInput("");
    await submitText(text);
  }, [textInput, submitText]);

  const handleStop = useCallback(() => {
    interrupt();
    stopListening();
  }, [interrupt, stopListening]);

  useWakeWord({
    enabled: wakeWordEnabled && status === "idle",
    onWakeWord: useCallback(() => {
      setJustWoke(true);
      setWakeWordEnabled(false);
      unlockAudio();
      startListening();
      wakeTimerRef.current = setTimeout(() => setJustWoke(false), 3000);
    }, [startListening, unlockAudio])
  });

  useEffect(() => {
    return () => {
      if (wakeTimerRef.current) {
        clearTimeout(wakeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, ocrMessages, streamingText, ocrStreamingText]);

  const showTyping = status === "thinking" && !ocrStreamingText;

  return (
    <div className={`min-h-screen bg-gradient-to-br ${EXAM_ACCENTS[exam]} relative`}>
      <AppHeader />
      
      <ChatHistorySidebar
        userId={userId}
        currentSessionId={sessionId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-4 flex items-center justify-between">
            <div>
              <h1 className="text-white font-bold text-lg">Live OCR - {exam}</h1>
              {pageContext && (
                <p className="text-indigo-100 text-sm mt-1">Context: {truncate(pageContext, 60)}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Chat History"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="h-[500px] overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <ScanSearch className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                <h3 className="text-lg font-medium text-gray-600 dark:text-gray-300">
                  {hasExplicitExam ? `${exam} Study Session` : "Ready to Learn"}
                </h3>
                <p className="text-sm text-gray-400 mt-2">
                  Scan a question or type to start chatting
                </p>
              </div>
            )}

            <AnimatePresence>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <ChatBubble
                    message={msg}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            {streamingText && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <ChatBubble
                  message={{
                    id: "streaming",
                    role: "assistant",
                    content: streamingText,
                    createdAt: Date.now()
                  }}
                />
              </motion.div>
            )}

            {showTyping && <TypingIndicator />}
            
            <div ref={bottomRef} />
          </div>

          {/* Camera Preview */}
          {isActive && (
            <div className="px-4 pb-4">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={handleStopCamera}
                  className="absolute top-3 right-3 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="border-t border-gray-200 dark:border-gray-800 p-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Camera */}
              {!isActive ? (
                <button
                  onClick={handleStartCamera}
                  disabled={noCameraAvailable}
                  className="p-3 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title={noCameraAvailable ? "No camera available" : "Start camera"}
                >
                  <Camera className="w-5 h-5" />
                </button>
              ) : (
                <button
                  onClick={scanPage}
                  disabled={isScanning}
                  className={`p-3 rounded-full transition-colors ${
                    isScanning
                      ? "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30"
                      : "bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50"
                  }`}
                  title={isScanning ? "Scanning..." : "Scan question"}
                >
                  <ScanSearch className="w-5 h-5" />
                </button>
              )}

              {/* Mic */}
              <button
                onClick={handleMicToggle}
                disabled={!microphoneAvailable}
                className={`p-3 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  status === "listening"
                    ? "bg-red-100 text-red-500 animate-pulse dark:bg-red-900/30"
                    : "bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
                title={status === "listening" ? "Listening..." : "Start voice input"}
              >
                <Mic className="w-5 h-5" />
              </button>

              {/* Transcript */}
              {transcript && (
                <div className="flex-1 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg text-sm text-blue-700 dark:text-blue-300">
                  {transcript}
                </div>
              )}

              {/* Text Input */}
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendText()}
                  placeholder="Type your question..."
                  disabled={isLoading}
                  className="flex-1 px-4 py-2.5 rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                />
                <button
                  onClick={handleSendText}
                  disabled={!textInput.trim() || isLoading}
                  className="p-3 rounded-full bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>

              {/* Stop */}
              {(status !== "idle" || isLoading) && (
                <button
                  onClick={handleStop}
                  className="p-3 rounded-full bg-red-100 text-red-500 hover:bg-red-200 dark:bg-red-900/30 transition-colors"
                >
                  <Square className="w-5 h-5 fill-current" />
                </button>
              )}
            </div>

            {/* Status Bar */}
            <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
              <div className="flex items-center gap-4">
                {lastScanAt && (
                  <span>Last scan: {formatScanTime(lastScanAt)}</span>
                )}
                {isScanning && <span className="text-yellow-600">Scanning...</span>}
                {quotaExhausted && (
                  <span className="text-red-500">Quota exhausted. Try again later.</span>
                )}
                {chatError && (
                  <span className="text-red-500">{chatError}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {scanHistory.length > 0 && (
                  <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">
                    {scanHistory.length} pages scanned
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
