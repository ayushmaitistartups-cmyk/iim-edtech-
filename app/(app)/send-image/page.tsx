"use client";

import { useEffect, useState } from "react";
import NextImage from "next/image";
import { AppHeader } from "@/components/AppHeader";
import { ConversationPanel } from "@/components/ConversationPanel";
import { ChatThread } from "@/components/chat/ChatThread";
import { ImageUpload } from "@/components/image-upload/ImageUpload";
import { useConversation } from "@/hooks/useConversation";
import { consumeSSE } from "@/lib/sse-client";

const MAX_UPLOAD_WIDTH = 800;
const MAX_UPLOAD_HEIGHT = 600;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read selected image"));
    };
    img.src = objectUrl;
  });
}

async function compressForGemini(file: File): Promise<File> {
  const img = await loadImage(file);
  const scale = Math.min(MAX_UPLOAD_WIDTH / img.width, MAX_UPLOAD_HEIGHT / img.height, 1);
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return file;
  }

  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((result) => resolve(result), "image/jpeg", 0.75)
  );

  if (!blob) {
    return file;
  }

  const compressedName = file.name.replace(/\.[^.]+$/, "") + "-compressed.jpg";
  return new File([blob], compressedName, {
    type: "image/jpeg",
    lastModified: Date.now()
  });
}

export default function SendImagePage(): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisStreamingText, setAnalysisStreamingText] = useState<string>("");
  const [analysisDone, setAnalysisDone] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const { messages, addUserMessage, addAssistantMessage, clearHistory } = useConversation();

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const runAnalysis = async (): Promise<void> => {
    if (!file || isAnalyzing) {
      return;
    }

    setError("");
    setIsAnalyzing(true);
    setAnalysisStreamingText("");
    setAnalysisDone(false);
    clearHistory();

    let fullText = "";
    let streamCompleted = false;

    try {
      const compressedFile = await compressForGemini(file);
      const formData = new FormData();
      formData.append("image", compressedFile);

      const response = await fetch("/api/image", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("API Route failed:", response.status, errText);
        throw new Error(`API Error: ${response.status} ${errText}`);
      }

      await consumeSSE(response, (data) => {
        if (data === "[DONE]") {
          return;
        }
        if (data.startsWith("[ERROR]")) {
          throw new Error(data.slice(8) || "Streaming failed");
        }
        const token = JSON.parse(data) as string;
        fullText += token;
        setAnalysisStreamingText(fullText);
      });

      streamCompleted = true;
      addAssistantMessage(fullText);
      setAnalysisDone(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Analysis failed: ${msg}`);
    } finally {
      // Save partial text if stream was interrupted mid-response.
      if (fullText.trim() && !streamCompleted) {
        let finalText = fullText.trim();
        if (!/[.!?]$/.test(finalText)) {
          finalText += "...";
        }
        addAssistantMessage(finalText);
        setAnalysisDone(true);
      }
      setAnalysisStreamingText("");
      setIsAnalyzing(false);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <AppHeader title="Send Image" />

      {!file ? (
        <section className="flex min-h-[calc(100vh-57px)] items-center px-4">
          <ImageUpload onSelect={setFile} />
        </section>
      ) : (
        <section className="mx-auto flex h-[calc(100vh-57px)] w-full max-w-4xl flex-col px-4 py-4">
          {/* Image preview + controls */}
          <div className="flex flex-col gap-3 border border-border p-3">
            {previewUrl ? (
              <NextImage
                alt="Question preview"
                className="max-h-64 w-full object-contain"
                height={480}
                src={previewUrl}
                unoptimized
                width={640}
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                className="border border-foreground bg-foreground px-4 py-2 text-sm text-background disabled:opacity-60"
                disabled={isAnalyzing}
                onClick={() => void runAnalysis()}
                type="button"
              >
                {isAnalyzing ? "Analyzing..." : "Analyze"}
              </button>
              <button
                className="border border-border px-4 py-2 text-sm"
                disabled={isAnalyzing}
                onClick={() => {
                  setFile(null);
                  setError("");
                  setAnalysisDone(false);
                  clearHistory();
                }}
                type="button"
              >
                Change image
              </button>
              <button
                className="border border-border px-4 py-2 text-sm"
                disabled={isAnalyzing}
                onClick={() => {
                  setFile(null);
                  setError("");
                  setAnalysisDone(false);
                  clearHistory();
                }}
                type="button"
              >
                New Question
              </button>
            </div>
          </div>

          {/* Solution + follow-up conversation area */}
          <div className="mt-3 flex min-h-0 flex-1 flex-col border border-border">
            {isAnalyzing && analysisStreamingText.length === 0 ? (
              <div className="p-3">
                <div className="h-5 w-32 animate-pulse bg-muted" />
              </div>
            ) : null}

            {/* Show initial analysis streaming */}
            {!analysisDone ? (
              <ChatThread
                isLoading={isAnalyzing}
                messages={messages}
                streamingText={analysisStreamingText}
              />
            ) : (
              /* After analysis done, switch to ConversationPanel with voice for follow-ups */
              <ConversationPanel
                messages={messages}
                onAddUserMessage={addUserMessage}
                onAddAssistantMessage={addAssistantMessage}
                mode="send_image"
              />
            )}
            {error ? <p className="px-3 pb-2 text-sm text-red-700">{error}</p> : null}
          </div>
        </section>
      )}
    </main>
  );
}
