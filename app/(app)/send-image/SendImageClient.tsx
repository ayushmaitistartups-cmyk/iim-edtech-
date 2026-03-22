"use client";

import { useState, useRef, useEffect } from "react";
import { ExamType } from "@/types/exam";
import Link from "next/link";
import { ArrowLeft, UploadCloud, Loader2, AlertCircle, Send, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useChat } from "@/hooks/useChat";
import { recordSessionActivity } from "@/lib/utils/analytics";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"]);

export function SendImageClient({ exam }: { exam: ExamType }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>("image/jpeg");
  const [analyzing, setAnalyzing] = useState(false);
  const [streamingResult, setStreamingResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [followUpInput, setFollowUpInput] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    messages,
    streamingText,
    isLoading: chatLoading,
    error: chatError,
    sendUserMessage,
    appendAssistantMessage,
    reset,
  } = useChat();

  const analysisComplete = messages.length > 0;

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const handleFile = (f: File) => {
    setError(null);
    reset();
    if (!ALLOWED_TYPES.has(f.type)) {
      setError("Unsupported file type. Please use JPG, PNG, WEBP, or HEIC.");
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError("File is too large. Maximum size is 10 MB.");
      return;
    }
    setFile(f);
    setImageMime(f.type);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setPreview(dataUrl);
      setImageBase64(dataUrl.split(",")[1] ?? null);
    };
    reader.readAsDataURL(f);
  };

  const analyzeImage = async () => {
    if (!file) return;
    setAnalyzing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("exam", exam);

      const res = await fetch("/api/image", { method: "POST", body: formData });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Server error (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream received.");
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break outer;
          if (payload.startsWith("[ERROR]")) {
            setError(payload.slice(7).trim() || "Something went wrong. Please try again.");
            break outer;
          }
          try {
            accumulated += JSON.parse(payload) as string;
            setStreamingResult(accumulated);
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      if (accumulated.trim()) {
        appendAssistantMessage(accumulated.trim());
        recordSessionActivity(exam, ["general"], 1, 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze image. Please try again.");
    } finally {
      setAnalyzing(false);
      setStreamingResult("");
    }
  };

  const clearImage = () => {
    setPreview(null);
    setFile(null);
    setImageBase64(null);
    setStreamingResult("");
    setError(null);
    reset();
  };

  const handleFollowUp = async () => {
    const text = followUpInput.trim();
    if (!text || chatLoading) return;
    setFollowUpInput("");
    // Attach image only on the first follow-up so the model has visual context
    const image =
      messages.length <= 5 && imageBase64
        ? { base64: imageBase64, mimeType: imageMime }
        : undefined;
    await sendUserMessage(text, { mode: "send_image", exam, image });
  };

  return (
    <div className="min-h-screen bg-surface p-4 sm:p-8 pt-24 flex flex-col items-center perspective-container overflow-x-hidden">
      {/* Top Navigation */}
      <nav className="absolute top-0 left-0 right-0 z-50 p-6 flex justify-between items-center bg-gradient-to-b from-surface to-transparent">
        <Link
          href={`/dashboard?exam=${exam}`}
          className="btn glass text-ink border-edge hover:bg-surface hover:scale-105 active:scale-95 transition-all text-sm h-10 px-4 flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
        <div className="bg-strength/10 text-strength border border-strength/20 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">
          {exam} Mode
        </div>
      </nav>

      <div className="max-w-3xl w-full transform-3d animate-slide-up [animation-delay:100ms]">
        <header className="mb-12 text-center">
          <h1 className="text-display mb-4">Async Problem Solving</h1>
          <p className="text-title text-ink-muted">
            Upload a question image. Get a full step-by-step breakdown, then continue the Socratic dialogue.
          </p>
        </header>

        {/* Error Banner */}
        <AnimatePresence>
          {(error || chatError) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 bg-error/10 text-error border border-error/20 rounded-2xl p-4 flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{error || chatError}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {!preview ? (
          /* ── Upload Zone ── */
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="w-full h-80 border-2 border-dashed border-edge rounded-3xl flex flex-col items-center justify-center bg-surface-raised cursor-pointer hover:border-accent hover:bg-surface transition-all group shadow-modal"
          >
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/heic"
              className="hidden"
              id="upload"
              onChange={(e) => e.target.files && handleFile(e.target.files[0])}
            />
            <label htmlFor="upload" className="w-full h-full flex flex-col items-center justify-center cursor-pointer p-8">
              <div className="w-20 h-20 rounded-2xl bg-surface border border-edge shadow-lifted flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-gentle transform-3d">
                <UploadCloud className="w-10 h-10 text-accent group-hover:-translate-y-1 transition-transform" />
              </div>
              <h3 className="text-headline mb-2">Drag & Drop Image</h3>
              <p className="text-body text-ink-muted text-center">or click to browse — JPG, PNG, WEBP, HEIC up to 10 MB</p>
            </label>
          </div>
        ) : (
          <div className="space-y-6 animate-slide-up [animation-delay:0ms]">
            {/* Image Preview */}
            <div className="relative w-full rounded-3xl overflow-hidden shadow-modal border border-edge bg-surface-raised transform-3d">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Problem Preview" className="w-full h-auto max-h-[400px] object-contain" />
              {!analysisComplete && !analyzing && (
                <button
                  onClick={clearImage}
                  className="absolute top-4 right-4 bg-[#0f1115]/80 backdrop-blur-md text-white px-4 py-2 rounded-full text-sm font-bold hover:bg-[#0f1115] transition-colors border border-white/10 shadow-lifted"
                >
                  Change Image
                </button>
              )}
            </div>

            {/* Analyse Button */}
            {!analysisComplete && !analyzing && (
              <button
                onClick={analyzeImage}
                className="btn btn-primary w-full h-14 text-title shadow-lifted hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                Analyse Problem Structure
              </button>
            )}

            {/* Analysing State */}
            <AnimatePresence>
              {analyzing && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-6"
                >
                  <div className="flex items-center gap-3 py-4">
                    <Loader2 className="w-5 h-5 text-accent animate-spin shrink-0" />
                    <p className="text-body text-ink-muted animate-pulse">Analysing for {exam}…</p>
                  </div>
                  {streamingResult && (
                    <div className="bg-surface-raised border border-edge rounded-3xl p-8 shadow-modal">
                      <p className="text-sm font-bold text-accent uppercase tracking-widest mb-5">
                        {exam} Analysis
                      </p>
                      <div className="text-body text-ink leading-relaxed whitespace-pre-wrap font-sans">
                        {streamingResult}
                        <span className="inline-block w-2 h-4 bg-accent/40 ml-0.5 animate-pulse" />
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Result + Socratic Follow-up Chat */}
            <AnimatePresence>
              {analysisComplete && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  {/* Initial Analysis Block */}
                  <div className="bg-surface-raised border border-edge rounded-3xl p-8 shadow-modal transform-3d">
                    <div className="flex items-center justify-between mb-5">
                      <p className="text-sm font-bold text-accent uppercase tracking-widest flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-accent animate-pulse inline-block" />
                        {exam} Analysis
                      </p>
                      <button
                        onClick={clearImage}
                        className="flex items-center gap-1.5 text-caption text-ink-muted hover:text-ink transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        New Problem
                      </button>
                    </div>
                    <div className="text-body text-ink leading-relaxed whitespace-pre-wrap font-sans">
                      {messages[0]?.content}
                    </div>
                  </div>

                  {/* Follow-up conversation thread */}
                  {messages.length > 1 && (
                    <div className="space-y-3">
                      {messages.slice(1).map((msg, i) => (
                        <motion.div
                          key={msg.id || i}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[85%] rounded-2xl px-5 py-4 text-body ${
                              msg.role === "user"
                                ? "bg-accent/10 border border-accent/20 text-ink"
                                : "bg-surface-raised border border-edge text-ink"
                            }`}
                          >
                            {msg.role === "assistant" && (
                              <p className="text-caption font-semibold text-accent mb-1.5">Clarity</p>
                            )}
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                          </div>
                        </motion.div>
                      ))}

                      {/* Streaming response */}
                      {streamingText && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex justify-start"
                        >
                          <div className="max-w-[85%] rounded-2xl px-5 py-4 text-body bg-surface-raised border border-edge text-ink">
                            <p className="text-caption font-semibold text-accent mb-1.5">Clarity</p>
                            <p className="whitespace-pre-wrap leading-relaxed">
                              {streamingText}
                              <span className="inline-block w-2 h-4 bg-accent/40 ml-0.5 animate-pulse" />
                            </p>
                          </div>
                        </motion.div>
                      )}

                      {/* Typing indicator */}
                      {chatLoading && !streamingText && (
                        <div className="flex justify-start">
                          <div className="bg-surface-raised border border-edge rounded-2xl px-5 py-4">
                            <div className="flex gap-1.5 items-center h-5">
                              <span className="w-2 h-2 rounded-full bg-ink-ghost animate-bounce [animation-delay:0ms]" />
                              <span className="w-2 h-2 rounded-full bg-ink-ghost animate-bounce [animation-delay:150ms]" />
                              <span className="w-2 h-2 rounded-full bg-ink-ghost animate-bounce [animation-delay:300ms]" />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div ref={chatBottomRef} />

                  {/* Follow-up Input */}
                  <div className="flex gap-3 bg-surface-raised border border-edge rounded-2xl p-3 shadow-soft focus-within:border-accent/50 transition-colors">
                    <input
                      ref={inputRef}
                      type="text"
                      value={followUpInput}
                      onChange={(e) => setFollowUpInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleFollowUp();
                        }
                      }}
                      placeholder={`Ask a follow-up question about this ${exam} problem…`}
                      className="flex-1 bg-transparent text-ink placeholder:text-ink-ghost outline-none text-body py-1 px-2"
                      disabled={chatLoading}
                    />
                    <button
                      onClick={handleFollowUp}
                      disabled={!followUpInput.trim() || chatLoading}
                      className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center hover:bg-accent-hover active:bg-accent-pressed transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    >
                      {chatLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
