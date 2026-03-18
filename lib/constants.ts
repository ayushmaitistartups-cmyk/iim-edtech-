// API Rate Limits (per minute)
export const RATE_LIMITS = {
  CHAT: { windowMs: 60_000, maxRequests: 20 },
  OCR: { windowMs: 60_000, maxRequests: 15 },
  IMAGE: { windowMs: 60_000, maxRequests: 10 },
} as const;

// Timeouts (ms) - increased for long responses
export const TIMEOUTS = {
  GEMINI_CHUNK: 120_000,
  GEMINI_INITIAL_CONNECTION: 30_000,
  GEMINI_STREAM_TOTAL: 600_000,
  SSE_READ: 180_000,
  VOICE_AGENT: 90_000,
  VOICE_AGENT_CHUNK: 20_000,
  OCR_NON_STREAMING: 30_000,
} as const;

// Image Processing
export const IMAGE_LIMITS = {
  MAX_BASE64_LENGTH: 2_800_000,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  CROP_MAX_WIDTH: 800,
  CROP_MAX_HEIGHT: 600,
} as const;

// AI Models - separate for text and image requests
export const MODEL_PRIORITY_TEXT = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
] as const;

export const MODEL_PRIORITY_IMAGE = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
] as const;

// Context
export const CONTEXT_WINDOW = 16;

// Voice Agent
export const VOICE_LANGUAGE = "en-IN" as const;
export const VOICE_RATE = 1.05;
export const VOICE_PITCH = 1.0;

// Auto-scan
export const AUTO_SCAN_INTERVAL_MS = 10_000;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.92;

// Quota Recovery
export const QUOTA_RECOVERY_TIME_MS = 60_000;
export const MAX_CONSECUTIVE_FAILURES = 3;
