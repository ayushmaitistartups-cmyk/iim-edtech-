import { auth } from "@clerk/nextjs/server";
import { ConfigurationError, extractTextFromFrame, QuotaExhaustedError, RateLimitedError } from "@/lib/gemini";
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit";
import { uploadScanImage, saveScanLog } from "@/lib/supabase";

interface OCRRequestBody {
  image?: unknown;
}

/** ~2 MB decoded — base64 is ~4/3 of binary size, so 2 MB binary ≈ 2.73 MB base64 chars. */
const MAX_IMAGE_BASE64_LENGTH = 2_800_000;

export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(rateLimitKey(userId, "ocr"), { maxRequests: 10, windowMs: 60_000 });
  if (!rl.success) {
    return rateLimitResponse(rl.resetMs);
  }

  let payload: OCRRequestBody;
  try {
    payload = (await request.json()) as OCRRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof payload.image !== "string" || payload.image.trim().length === 0) {
    return Response.json({ error: "Field 'image' must be a non-empty string" }, { status: 400 });
  }

  if (payload.image.length > MAX_IMAGE_BASE64_LENGTH) {
    return Response.json({ error: "Image too large. Maximum size is 2 MB." }, { status: 413 });
  }

  try {
    const text = await extractTextFromFrame(payload.image);
    const trimmedText = text.trim();

    // Fire-and-forget: save scan image + log to Supabase for admin review
    void (async () => {
      try {
        const imagePath = await uploadScanImage(payload.image as string, userId);
        if (imagePath) {
          await saveScanLog({
            userId,
            imagePath,
            ocrText: trimmedText,
            charCount: trimmedText.length,
          });
        }
      } catch (e) {
        console.warn("[ScanLog] Background save failed:", e);
      }
    })();

    return Response.json({ text: trimmedText });
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return Response.json(
        { error: "configuration_error", message: "Gemini request configuration or API key permissions are invalid. Restart the app server after changing the key, then try again." },
        { status: 400 }
      );
    }
    if (error instanceof QuotaExhaustedError) {
      return Response.json(
        { error: "quota_exhausted", message: error.message },
        { status: 429 }
      );
    }
    if (error instanceof RateLimitedError) {
      return Response.json(
        {
          error: "rate_limited",
          message: error.message,
          retryAfterSeconds: error.retryAfterSeconds ?? 10
        },
        {
          status: 429,
          headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined
        }
      );
    }
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("429") || msg.includes("Too Many Requests")) {
      return Response.json(
        { error: "rate_limited", message: "OCR service is busy. Please try again in a moment.", retryAfterSeconds: 10 },
        { status: 429 }
      );
    }
    if (msg.includes("quota")) {
      return Response.json(
        { error: "quota_exhausted", message: "API quota exhausted. If you updated the key, please RESTART THE SERVER." },
        { status: 429 }
      );
    }

    if (msg.includes("400") || msg.includes("API key not valid") || msg.includes("INVALID_ARGUMENT")) {
      return Response.json(
        { error: "configuration_error", message: "API Key invalid or permissions missing. Check Google AI Studio settings." },
        { status: 400 }
      );
    }

    console.error("OCR processing failed:", error);
    return Response.json({
      error: "ocr_failed",
      message: "OCR processing failed",
      details: msg
    }, { status: 500 });
  }
}
