"use client";

import { useEffect, useRef, useState } from "react";

interface UseOCRParams {
  enabled: boolean;
  captureFrame: () => string | null;
  autoScan?: boolean;
  intervalMs?: number;
}

interface UseOCRResult {
  detectedText: string;
  isScanning: boolean;
  quotaExhausted: boolean;
  scanNow: () => Promise<string | null>;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.92;

function loadImageFromBase64(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode frame image"));
    img.src = base64;
  });
}

async function hashFrame(base64: string): Promise<string> {
  const img = await loadImageFromBase64(base64);
  const canvas = document.createElement("canvas");
  const size = 16;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "";
  }

  ctx.drawImage(img, 0, 0, size, size);
  const pixels = ctx.getImageData(0, 0, size, size).data;
  const grayValues: string[] = [];

  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round((pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11) / 4) * 4;
    grayValues.push(gray.toString(16).padStart(2, "0"));
  }

  return grayValues.join("");
}

function similarity(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) {
    return 0;
  }
  let same = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) {
      same += 1;
    }
  }
  return same / a.length;
}

export function useOCR({
  enabled,
  captureFrame,
  autoScan = false,
  intervalMs = 10000
}: UseOCRParams): UseOCRResult {
  const [detectedText, setDetectedText] = useState<string>("");
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [quotaExhausted, setQuotaExhausted] = useState<boolean>(false);
  const previousTextRef = useRef<string>("");
  const previousFrameHashRef = useRef<string>("");
  const consecutiveFailsRef = useRef<number>(0);
  const quotaExhaustedTimeRef = useRef<number>(0);

  const scanNow = async (): Promise<string | null> => {
    if (!enabled || quotaExhausted || isScanning) {
      return null;
    }

    const frame = captureFrame();
    if (!frame) {
      return null;
    }

    try {
      setIsScanning(true);
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: frame })
      });

      if (!response.ok) {
        if (response.status === 429) {
          const data = await response.json().catch(() => ({}));
          if (data.error === "quota_exhausted") {
            setQuotaExhausted(true);
            quotaExhaustedTimeRef.current = Date.now();
            return null;
          }
          consecutiveFailsRef.current += 1;
          if (consecutiveFailsRef.current >= 3) {
            setQuotaExhausted(true);
            quotaExhaustedTimeRef.current = Date.now();
          }
        }
        return null;
      }

      // Reset quota exhaustion after 60 seconds
      if (quotaExhausted && Date.now() - quotaExhaustedTimeRef.current > 60_000) {
        setQuotaExhausted(false);
        consecutiveFailsRef.current = 0;
      }

      consecutiveFailsRef.current = 0;
      const payload = (await response.json()) as { text?: string };
      const nextText = (payload.text ?? "").trim();
      if (!nextText || nextText === previousTextRef.current) {
        return null;
      }

      previousTextRef.current = nextText;
      setDetectedText(nextText);
      return nextText;
    } catch (error) {
      console.error("OCR request failed:", error);
      return null;
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (!enabled || quotaExhausted || !autoScan) {
      setIsScanning(false);
      if (!enabled) {
        setDetectedText("");
        previousTextRef.current = "";
        previousFrameHashRef.current = "";
        setQuotaExhausted(false);
        consecutiveFailsRef.current = 0;
      }
      return;
    }

    const interval = window.setInterval(async () => {
      if (isScanning) {
        return;
      }

      const frame = captureFrame();
      if (!frame) {
        return;
      }

      try {
        const currentHash = await hashFrame(frame);
        const changeScore = similarity(previousFrameHashRef.current, currentHash);
        if (changeScore > DEFAULT_SIMILARITY_THRESHOLD) {
          return;
        }
        previousFrameHashRef.current = currentHash;
        await scanNow();
      } catch (error) {
        console.error("OCR frame diffing failed:", error);
      }
    }, intervalMs);

    return () => {
      window.clearInterval(interval);
      setIsScanning(false);
    };
  }, [enabled, autoScan, captureFrame, intervalMs, quotaExhausted, isScanning]);

  return { detectedText, isScanning, quotaExhausted, scanNow };
}
