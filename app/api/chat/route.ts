import { auth } from "@clerk/nextjs/server";
import { isValidMessageList, sseResponse } from "@/lib/api";
import { ConfigurationError, QuotaExhaustedError, RateLimitedError, streamChat } from "@/lib/gemini";
import { buildAdaptiveLiveOCRPrompt, LIVE_OCR_SYSTEM_PROMPT } from "@/lib/prompts/live-ocr";
import { SEND_IMAGE_SYSTEM_PROMPT } from "@/lib/prompts/send-image";
import { buildVoiceAgentPrompt } from "@/lib/prompts/voice-agent";
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit";
import type { AppMode, ImageInput, Message } from "@/types";
import type { ExamType } from "@/types/exam";

interface ChatRequestBody {
  messages?: unknown;
  mode?: unknown;
  ocrText?: unknown;
  image?: unknown;
  exam?: unknown;
  stuckCount?: unknown;
  currentConcept?: unknown;
}

/** Validated topics that may arrive from the client session tracker. */
const VALID_CONCEPTS = [
  "general", "integration", "differentiation", "kinematics", "organic-chemistry",
  "thermodynamics", "probability", "algebra", "geometry", "trigonometry",
  "electromagnetism", "optics", "waves", "modern-physics", "inorganic-chemistry",
  "physical-chemistry", "biology",
];

const CONTEXT_WINDOW = 8;

function resolveMode(mode: unknown): AppMode | null {
  if (mode === "live_ocr" || mode === "live_ocr_agent" || mode === "send_image" || mode === "voice_agent") {
    return mode;
  }
  return null;
}

function resolveExam(exam: unknown): ExamType | null {
  if (exam && ["CAT", "GMAT", "NEET", "UPSC", "JEE"].includes(String(exam))) {
    return exam as ExamType;
  }
  return null;
}

function normalizeImage(input: unknown): ImageInput | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const candidate = input as Partial<ImageInput>;
  if (typeof candidate.base64 !== "string" || typeof candidate.mimeType !== "string") {
    return undefined;
  }

  return {
    base64: candidate.base64,
    mimeType: candidate.mimeType
  };
}

function enrichLiveOCR(messages: Message[], ocrText: string): Message[] {
  if (messages.length === 0) {
    return messages;
  }

  const latest = messages[messages.length - 1];
  if (latest.role !== "user") {
    return messages;
  }

  const enrichedLastMessage: Message = {
    ...latest,
    content: `[OCR] ${ocrText}\n${latest.content}`
  };

  return [...messages.slice(0, -1), enrichedLastMessage];
}

function trimMessagesForCost(messages: Message[]): Message[] {
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

function stripMetadata(messages: Message[]): Message[] {
  return messages.map(({ role, content }) => ({
    id: "",
    role,
    content,
    createdAt: 0
  }));
}

export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(rateLimitKey(userId, "chat"), { maxRequests: 30, windowMs: 60_000 });
  if (!rl.success) {
    return rateLimitResponse(rl.resetMs);
  }

  let payload: ChatRequestBody;
  try {
    payload = (await request.json()) as ChatRequestBody;
  } catch (error) {
    console.error("Chat API JSON Error:", error);
    return Response.json({ error: "Invalid JSON body", details: String(error) }, { status: 400 });
  }

  if (!isValidMessageList(payload.messages)) {
    return Response.json({ error: "Invalid messages payload" }, { status: 400 });
  }

  const mode = resolveMode(payload.mode);
  if (!mode) {
    return Response.json({ error: "Invalid mode" }, { status: 400 });
  }

  if (payload.messages.length === 0) {
    return Response.json({ error: "At least one message is required" }, { status: 400 });
  }

  const ocrText = typeof payload.ocrText === "string" ? payload.ocrText.trim() : "";
  const image = normalizeImage(payload.image);
  const enriched =
    (mode === "live_ocr" || mode === "live_ocr_agent") && ocrText ? enrichLiveOCR(payload.messages, ocrText) : payload.messages;
  const trimmedMessages = trimMessagesForCost(enriched);
  const baseMessages = stripMetadata(trimmedMessages);

  let systemPrompt: string;
  let maxTokens: number;

  if (mode === "voice_agent") {
    const exam = resolveExam(payload.exam);
    if (!exam) {
      return Response.json({ error: "Invalid exam for voice agent mode" }, { status: 400 });
    }
    systemPrompt = buildVoiceAgentPrompt(exam);
    maxTokens = 300;
  } else if (mode === "live_ocr_agent") {
    const exam = resolveExam(payload.exam);
    if (!exam) {
      return Response.json({ error: "Invalid exam for live OCR agent mode" }, { status: 400 });
    }
    // stuckCount and currentConcept are sent by the client session tracker.
    // Cap/validate server-side so the client cannot abuse hint escalation.
    const rawStuckCount = typeof payload.stuckCount === "number" ? payload.stuckCount : 0;
    const stuckCount = Math.max(0, Math.min(10, Math.floor(rawStuckCount)));
    const rawConcept = typeof payload.currentConcept === "string" ? payload.currentConcept : "general";
    const currentConcept = VALID_CONCEPTS.includes(rawConcept) ? rawConcept : "general";
    systemPrompt = buildAdaptiveLiveOCRPrompt(exam, { stuckCount, currentConcept });
    maxTokens = 512;
  } else if (mode === "live_ocr") {
    systemPrompt = LIVE_OCR_SYSTEM_PROMPT;
    maxTokens = 512;
  } else {
    systemPrompt = SEND_IMAGE_SYSTEM_PROMPT;
    maxTokens = 1024;
  }

  const MAX_STREAM_DURATION_MS = 60_000;

  return sseResponse(async (controller) => {
    const encoder = new TextEncoder();
    let hasTokens = false;
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.enqueue(
        encoder.encode(`data: [ERROR] Response generation timed out. Please try again.\n\n`)
      );
    }, MAX_STREAM_DURATION_MS);

    try {
      for await (const token of streamChat(baseMessages, systemPrompt, image, maxTokens)) {
        if (timedOut) break;
        hasTokens = true;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(token)}\n\n`));
      }

      if (!hasTokens && !timedOut) {
        controller.enqueue(
          encoder.encode(`data: [ERROR] I couldn't generate a response. Please try again.\n\n`)
        );
      }
    } catch (error) {
      if (error instanceof QuotaExhaustedError) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify("API quota exhausted. The free tier daily limit has been reached. Wait for the quota reset or use a different Google AI Studio project key.")}\n\n`)
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

      throw error;
    } finally {
      clearTimeout(deadline);
    }
  });
}
