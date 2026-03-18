import { auth } from "@clerk/nextjs/server";
import { SEND_IMAGE_SYSTEM_PROMPT } from "@/lib/prompts/send-image";
import { sseResponse } from "@/lib/api";
import { ConfigurationError, QuotaExhaustedError, RateLimitedError, streamChat } from "@/lib/gemini";
import { uploadTemporaryImage } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rate-limit";

import type { Message } from "@/types";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic"
]);

function toBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`image:${userId}`, { windowMs: 60_000, maxRequests: 10 });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Rate limit exceeded", retryAfterSeconds: Math.ceil((rateLimit.resetTime - Date.now()) / 1000) },
      { status: 429 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e: any) {
    console.error("FormData Error:", e);
    return Response.json({ error: "Invalid form data", msg: e?.message || String(e) }, { status: 400 });
  }

  const file = formData.get("image");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing image file" }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return Response.json(
      { error: "Unsupported file format. Use JPG, PNG, WEBP, or HEIC." },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json({ error: "File size must be under 10MB." }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const base64 = toBase64(buffer);
  const image = { base64, mimeType: file.type };

  // Best-effort temporary upload for prototype traceability.
  console.log("Saving image...");
  await uploadTemporaryImage(base64, file.type, userId);
  console.log("Image saved!");

  const messages: Message[] = [
    {
      id: "",
      role: "user",
      content: "Solve this step by step.",
      createdAt: 0
    }
  ];

  const MAX_STREAM_DURATION_MS = 55_000;

  console.log("Starting streamChat!");
  return sseResponse(async (controller) => {
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      abortController.abort();
      controller.enqueue(
        encoder.encode(`data: [ERROR] Response generation timed out. Please try again.\n\n`)
      );
    }, MAX_STREAM_DURATION_MS);

    try {
      for await (const token of streamChat(messages, SEND_IMAGE_SYSTEM_PROMPT, image, 4096, abortController.signal)) {
        if (timedOut) break;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(token)}\n\n`));
      }
    } catch (error) {
      if (timedOut) return;

      if (error instanceof QuotaExhaustedError) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify("API quota exhausted. Please try again in a moment.")}\n\n`)
        );
        return;
      }

      if (error instanceof RateLimitedError) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(error.message)}\n\n`));
        return;
      }

      if (error instanceof ConfigurationError) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify("Gemini request configuration is invalid. Restart the app server and try again. If it still fails, recheck the Gemini API key permissions.")}\n\n`)
        );
        return;
      }

      controller.enqueue(
        encoder.encode(`data: [ERROR] Something went wrong. Please try again.\n\n`)
      );
    } finally {
      clearTimeout(deadline);
    }
  });
}
