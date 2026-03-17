import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ImageInput, Message } from "@/types";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function stripDataUrlPrefix(input: string): string {
  const commaIndex = input.indexOf(",");
  if (commaIndex === -1) {
    return input;
  }
  return input.slice(commaIndex + 1);
}

/** Max number of recent messages retained, plus the first context seed message. */
const MAX_CONTEXT_MESSAGES = 16;

/** Timeout for non-streaming OCR requests (ms). */
const GEMINI_OCR_TIMEOUT_MS = 25_000;

/** Maximum time to wait for any single chunk during streaming (ms). */
const GEMINI_CHUNK_TIMEOUT_MS = 30_000;

/** Models to try in order — if one hits quota, fall back to the next. */
const MODEL_PRIORITY = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
] as const;

/** Custom error class for quota exhaustion so callers can distinguish it. */
export class QuotaExhaustedError extends Error {
  constructor(model: string, detail?: string) {
    super(`Gemini API quota exhausted for ${model}. ${detail ?? "Please wait, use a new API key, and RESTART THE SERVER."}`);
    this.name = "QuotaExhaustedError";
  }
}

export class RateLimitedError extends Error {
  retryAfterSeconds?: number;

  constructor(detail?: string, retryAfterSeconds?: number) {
    super(detail ?? "Gemini API is temporarily rate limited. Please retry shortly.");
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ConfigurationError extends Error {
  constructor(detail?: string) {
    super(detail ?? "Gemini API request is invalid or the API key is misconfigured.");
    this.name = "ConfigurationError";
  }
}

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const rawKey = requiredEnv("GEMINI_API_KEY");
    _genAI = new GoogleGenerativeAI(rawKey.trim());
  }
  return _genAI;
}

function getModel(
  modelName: string,
  systemInstruction?: string,
  maxOutputTokens = 1024
): ReturnType<GoogleGenerativeAI["getGenerativeModel"]> {
  const genAI = getGenAI();
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens,
      temperature: 0.4
    },
    ...(systemInstruction && {
      systemInstruction
    })
  });
}

/** Check if an error is a 429 quota error. */
function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return msg.includes("429") || msg.includes("quota") || msg.includes("Too Many Requests");
}

function isConfigurationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return (
    msg.includes("400") ||
    msg.includes("Bad Request") ||
    msg.includes("INVALID_ARGUMENT") ||
    msg.includes("API key not valid") ||
    msg.includes("API_KEY_INVALID") ||
    msg.includes("PERMISSION_DENIED") ||
    msg.includes("system_instruction")
  );
}

function isQuotaExhaustedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Only treat as truly permanent if the API explicitly says limit is 0.
  // All other quota/rate messages are treated as transient to avoid locking users out.
  return error.message.includes("limit: 0");
}

function extractRetryAfterSeconds(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const match = error.message.match(/retry_delay\s*{\s*seconds:\s*(\d+)/i);
  if (!match) {
    return undefined;
  }
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** Sleep for given ms. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry a function with exponential backoff on 429 errors.
 *  Only retries transient per-minute limits — daily exhaustion is thrown immediately. */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelayMs = 2000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isQuotaError(error)) throw error;

      // If the error says limit: 0 (daily exhausted), don't retry — it won't help.
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("limit: 0")) throw error;

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`Gemini 429 — retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/** Keep first context message plus recent turns to cap input tokens. */
function trimHistory(messages: Message[], maxMessages: number): Message[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  const first = messages[0];
  const tail = messages.slice(-maxMessages);
  if (tail[0]?.id === first.id) {
    return tail;
  }
  return [first, ...tail];
}

export async function extractTextFromFrame(base64: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY || "";
  console.log(`[Gemini] OCR Request | Key: ...${key.slice(-4)}`);
  const cleanBase64 = stripDataUrlPrefix(base64);
  const content = [
    {
      inlineData: {
        mimeType: "image/jpeg" as const,
        data: cleanBase64
      }
    },
    "Extract all visible text from this image. Reproduce math expressions in LaTeX (e.g. $x^2 + 3x = 0$). Return nothing else."
  ];

  let sawTransientRateLimit = false;
  let lastRetryAfterSeconds: number | undefined;

  // Try each model in priority order; fall back on quota errors.
  for (const modelName of MODEL_PRIORITY) {
    try {
      const model = getModel(modelName, undefined, 512);
      const result = await withRetry(() => model.generateContent(content, { timeout: GEMINI_OCR_TIMEOUT_MS }));
      return result.response.text().trim();
    } catch (error) {
      if (isQuotaError(error)) {
        if (!isQuotaExhaustedError(error)) {
          sawTransientRateLimit = true;
          lastRetryAfterSeconds = extractRetryAfterSeconds(error) ?? lastRetryAfterSeconds;
        }
        console.warn(`Model ${modelName} quota hit (${(error as Error).message}), trying next fallback...`);
        continue;
      }
      if (isConfigurationError(error)) {
        throw new ConfigurationError((error as Error).message);
      }
      // If model not found (404), log and skip to next model
      if ((error as Error).message.includes("404") || (error as Error).message.includes("not found")) {
        console.warn(`Model ${modelName} not found, skipping fallback...`);
        continue;
      }
      throw error;
    }
  }

  if (sawTransientRateLimit) {
    throw new RateLimitedError(
      `Gemini OCR is temporarily rate limited (Key: ...${key.slice(-4)}). Please retry in a few seconds.`,
      lastRetryAfterSeconds
    );
  }

  throw new QuotaExhaustedError("all models", `Key ending in ...${key.slice(-4)} exhausted all models. Check usage in Google AI Studio or restart server if key was updated.`);
}

function toGeminiRole(role: Message["role"]): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

/** Wraps an async iterable so each .next() call has a per-chunk timeout. */
async function* iterateWithChunkTimeout<T>(
  stream: AsyncIterable<T>,
  timeoutMs: number
): AsyncGenerator<T> {
  const iterator = stream[Symbol.asyncIterator]();
  while (true) {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () => reject(new Error("Gemini stream chunk timed out")),
          timeoutMs
        );
      }),
    ]).finally(() => {
      if (timerId !== undefined) clearTimeout(timerId);
    });
    if (result.done) break;
    yield result.value;
  }
}

export async function* streamChat(
  messages: Message[],
  systemPrompt: string,
  image?: ImageInput,
  maxOutputTokens = 1024
): AsyncGenerator<string> {
  const key = process.env.GEMINI_API_KEY || "";
  console.log(`[Gemini] Chat Request | Key: ...${key.slice(-4)}`);
  
  if (messages.length === 0) {
    return;
  }

  const trimmed = trimHistory(messages, MAX_CONTEXT_MESSAGES);

  const historyParts = trimmed.slice(0, -1).map((message) => ({
    role: toGeminiRole(message.role),
    parts: [{ text: message.content }]
  }));

  const latest = trimmed[trimmed.length - 1];
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  if (image) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: stripDataUrlPrefix(image.base64)
      }
    });
  }
  parts.push({ text: latest.content });

  let sawTransientRateLimit = false;
  let lastRetryAfterSeconds: number | undefined;

  // Try each model in priority order; fall back on quota errors.
  for (const modelName of MODEL_PRIORITY) {
    try {
      const model = getModel(modelName, systemPrompt, maxOutputTokens);
      const chat = model.startChat({ history: historyParts });
      const result = await withRetry(() => chat.sendMessageStream(parts));

      for await (const chunk of iterateWithChunkTimeout(result.stream, GEMINI_CHUNK_TIMEOUT_MS)) {
        try {
          const text = chunk.text();
          if (text) {
            yield text;
          }
        } catch {
          continue;
        }
      }
      return; // Success — exit the model loop.
    } catch (error) {
      if (isQuotaError(error)) {
        if (!isQuotaExhaustedError(error)) {
          sawTransientRateLimit = true;
          lastRetryAfterSeconds = extractRetryAfterSeconds(error) ?? lastRetryAfterSeconds;
        }
        console.warn(`Model ${modelName} quota hit (${(error as Error).message}), trying next fallback...`);
        continue;
      }
      if (isConfigurationError(error)) {
        throw new ConfigurationError((error as Error).message);
      }
      // If model not found (404), log and skip to next model
      if ((error as Error).message.includes("404") || (error as Error).message.includes("not found")) {
        console.warn(`Model ${modelName} not found, skipping fallback...`);
        continue;
      }
      throw error;
    }
  }
  if (sawTransientRateLimit) {
    throw new RateLimitedError(
      `Gemini Chat is temporarily rate limited (Key: ...${key.slice(-4)}). Please retry in a few seconds.`,
      lastRetryAfterSeconds
    );
  }

  throw new QuotaExhaustedError("all models", `Key ending in ...${key.slice(-4)} exhausted all models. Check usage in Google AI Studio or restart server if key was updated.`);
}
