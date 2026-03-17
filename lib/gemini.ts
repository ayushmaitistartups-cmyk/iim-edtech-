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

/** Timeout for the initial stream connection (ms). */
const GEMINI_INITIAL_CONNECTION_TIMEOUT_MS = 20_000;

/** Maximum time to wait for any single chunk during streaming (ms).
 *  Must be well below SSE_READ_TIMEOUT_MS (25s) to avoid client/server races. */
const GEMINI_CHUNK_TIMEOUT_MS = 30_000;

/** Models to try in order — best quality first, lite as fallback. */
const MODEL_PRIORITY = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
] as const;

/** How long to skip a key after it is rate-limited (ms). */
const KEY_COOLDOWN_MS = 60_000;

/** Custom error class for quota exhaustion so callers can distinguish it. */
export class QuotaExhaustedError extends Error {
  constructor(model: string, detail?: string) {
    super(`Gemini API quota exhausted for ${model}. ${detail ?? "Please try again in a moment."}`);
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

/* -------------------------------------------------------------------------- */
/*  Multi-key pool                                                            */
/* -------------------------------------------------------------------------- */

let _keys: string[] | null = null;
let _genAIs: GoogleGenerativeAI[] | null = null;

/** Parse GEMINI_API_KEY — supports comma-separated list for key rotation. */
function getKeys(): string[] {
  if (!_keys) {
    const raw = requiredEnv("GEMINI_API_KEY");
    _keys = raw.split(",").map((k) => k.trim()).filter(Boolean);
    if (_keys.length === 0) {
      throw new Error("No valid API keys found in GEMINI_API_KEY");
    }
    if (_keys.length > 1) {
      console.log(`[Gemini] Loaded ${_keys.length} API keys for rotation`);
    }
  }
  return _keys;
}

function getGenAIs(): GoogleGenerativeAI[] {
  if (!_genAIs) {
    _genAIs = getKeys().map((k) => new GoogleGenerativeAI(k));
  }
  return _genAIs;
}

/** Short suffix for logging — never logs full key. */
function keyTag(keyIdx: number): string {
  return `...${getKeys()[keyIdx].slice(-4)}`;
}

/* Per-key cooldown tracking */
const keyCooldowns = new Map<number, number>();

/** Round-robin counter so consecutive requests start on different keys. */
let _rrIndex = 0;

/** Return key indices ordered: non-cooled-down first (round-robin), then cooled-down as fallback. */
function getKeyOrder(): number[] {
  const total = getKeys().length;
  const now = Date.now();
  const available: number[] = [];
  const cooledDown: number[] = [];

  for (let i = 0; i < total; i++) {
    const idx = (_rrIndex + i) % total;
    const expiry = keyCooldowns.get(idx);
    if (expiry && now < expiry) {
      cooledDown.push(idx);
    } else {
      if (expiry) keyCooldowns.delete(idx);
      available.push(idx);
    }
  }

  _rrIndex = (_rrIndex + 1) % total;
  return [...available, ...cooledDown];
}

function cooldownKey(keyIdx: number): void {
  keyCooldowns.set(keyIdx, Date.now() + KEY_COOLDOWN_MS);
}

function getModel(
  keyIdx: number,
  modelName: string,
  systemInstruction?: string,
  maxOutputTokens = 1024
): ReturnType<GoogleGenerativeAI["getGenerativeModel"]> {
  return getGenAIs()[keyIdx].getGenerativeModel({
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

/* -------------------------------------------------------------------------- */
/*  Error classification                                                      */
/* -------------------------------------------------------------------------- */

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

function isModelNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("404") || error.message.includes("not found");
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
  maxRetries = 3,
  baseDelayMs = 1000
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

/* -------------------------------------------------------------------------- */
/*  OCR                                                                       */
/* -------------------------------------------------------------------------- */

export async function extractTextFromFrame(base64: string, abortSignal?: AbortSignal): Promise<string> {
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

  // Try each model in priority order; for each model, try each key.
  for (const modelName of MODEL_PRIORITY) {
    const keyOrder = getKeyOrder();

    for (const keyIdx of keyOrder) {
      try {
        console.log(`[Gemini] OCR Request | Model: ${modelName} | Key: ${keyTag(keyIdx)}`);
        const model = getModel(keyIdx, modelName, undefined, 512);

        const callFn = () => model.generateContent(content, { timeout: GEMINI_OCR_TIMEOUT_MS, signal: abortSignal });
        const result = await withRetry(callFn);

        return result.response.text().trim();
      } catch (error) {
        if (isQuotaError(error)) {
          cooldownKey(keyIdx);
          if (!isQuotaExhaustedError(error)) {
            sawTransientRateLimit = true;
            lastRetryAfterSeconds = extractRetryAfterSeconds(error) ?? lastRetryAfterSeconds;
          }
          console.warn(`Model ${modelName} Key ${keyTag(keyIdx)} quota hit, trying next...`);
          continue;
        }
        if (isConfigurationError(error)) {
          throw new ConfigurationError((error as Error).message);
        }
        if (isModelNotFoundError(error)) {
          console.warn(`Model ${modelName} not found, skipping...`);
          break; // No point trying other keys for a model that doesn't exist
        }
        throw error;
      }
    }
  }

  if (sawTransientRateLimit) {
    throw new RateLimitedError(
      "Gemini OCR is temporarily rate limited. Please retry in a few seconds.",
      lastRetryAfterSeconds
    );
  }

  throw new QuotaExhaustedError("all models", "All API keys exhausted all models. Check usage in Google AI Studio or add more keys.");
}

/* -------------------------------------------------------------------------- */
/*  Streaming chat                                                            */
/* -------------------------------------------------------------------------- */

function toGeminiRole(role: Message["role"]): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

/** Gemini requires strict user/model/user/model role alternation.
 *  Merge consecutive same-role messages so the API doesn't silently fail. */
function sanitizeHistory(
  history: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>
): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  if (history.length <= 1) return history;

  const merged: typeof history = [history[0]];
  for (let i = 1; i < history.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = history[i];
    if (curr.role === prev.role) {
      // Merge text into previous entry
      prev.parts[0].text += "\n" + curr.parts[0].text;
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/** Wraps an async iterable so each .next() call has a per-chunk timeout. */
async function* iterateWithChunkTimeout<T>(
  stream: AsyncIterable<T>,
  timeoutMs: number
): AsyncGenerator<T> {
  const iterator = stream[Symbol.asyncIterator]();
  try {
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
  } finally {
    if (typeof iterator.return === 'function') {
      await iterator.return();
    }
  }
}

export async function* streamChat(
  messages: Message[],
  systemPrompt: string,
  image?: ImageInput,
  maxOutputTokens = 1024,
  abortSignal?: AbortSignal
): AsyncGenerator<string> {
  if (messages.length === 0) {
    return;
  }

  const trimmed = trimHistory(messages, MAX_CONTEXT_MESSAGES);

  const historyParts = sanitizeHistory(
    trimmed.slice(0, -1).map((message) => ({
      role: toGeminiRole(message.role),
      parts: [{ text: message.content }]
    }))
  );

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

  // Try each model in priority order; for each model, try each key.
  for (const modelName of MODEL_PRIORITY) {
    const keyOrder = getKeyOrder();

    for (const keyIdx of keyOrder) {
      try {
        console.log(`[Gemini] Chat Request | Model: ${modelName} | Key: ${keyTag(keyIdx)}`);
        const model = getModel(keyIdx, modelName, systemPrompt, maxOutputTokens);
        const chat = model.startChat({ history: historyParts });

        const callFn = (): Promise<Awaited<ReturnType<typeof chat.sendMessageStream>>> =>
          Promise.race([
            chat.sendMessageStream(parts, { signal: abortSignal }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("Initial connection timeout")),
                GEMINI_INITIAL_CONNECTION_TIMEOUT_MS
              )
            ),
          ]);
        const result = await withRetry(callFn);

        for await (const chunk of iterateWithChunkTimeout(result.stream, GEMINI_CHUNK_TIMEOUT_MS)) {
          if (abortSignal?.aborted) return;
          try {
            const text = chunk.text();
            if (text) {
              yield text;
            }
          } catch (e: any) {
            yield `\n\n[Response stopped: ${e?.message ?? "content filtered"}]`;
            break;
          }
        }
        return; // Success — exit both loops.
      } catch (error) {
        if (isQuotaError(error)) {
          cooldownKey(keyIdx);
          if (!isQuotaExhaustedError(error)) {
            sawTransientRateLimit = true;
            lastRetryAfterSeconds = extractRetryAfterSeconds(error) ?? lastRetryAfterSeconds;
          }
          console.warn(`Model ${modelName} Key ${keyTag(keyIdx)} quota hit, trying next...`);
          continue;
        }
        if (isConfigurationError(error)) {
          throw new ConfigurationError((error as Error).message);
        }
        if (isModelNotFoundError(error)) {
          console.warn(`Model ${modelName} not found, skipping...`);
          break; // No point trying other keys for a model that doesn't exist
        }
        throw error;
      }
    }
  }

  if (sawTransientRateLimit) {
    throw new RateLimitedError(
      "Gemini Chat is temporarily rate limited. Please retry in a few seconds.",
      lastRetryAfterSeconds
    );
  }

  throw new QuotaExhaustedError("all models", "All API keys exhausted all models. Check usage in Google AI Studio or add more keys.");
}
