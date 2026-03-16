import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createSupabaseServiceClient(): SupabaseClient {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY")
  );
}

export interface UserRecordInput {
  clerkId: string;
  email: string;
}

export async function upsertUserRecord(input: UserRecordInput): Promise<boolean> {
  try {
    const client = createSupabaseServiceClient();
    const { error } = await client.from("users").upsert(
      {
        clerk_id: input.clerkId,
        email: input.email
      },
      { onConflict: "clerk_id" }
    );

    return !error;
  } catch {
    return false;
  }
}

export async function deleteUserByClerkId(clerkId: string): Promise<boolean> {
  try {
    const client = createSupabaseServiceClient();
    const { error } = await client.from("users").delete().eq("clerk_id", clerkId);
    return !error;
  } catch {
    return false;
  }
}

// ─── Scan logs for admin dashboard ────────────────────────────────────────────

export interface ScanLogInput {
  userId: string;
  imagePath: string;
  ocrText: string;
  charCount: number;
}

export interface ScanLogRow {
  id: string;
  user_id: string;
  image_path: string;
  ocr_text: string;
  char_count: number;
  created_at: string;
}

/** Save an OCR scan record so admins can review camera quality. */
export async function saveScanLog(input: ScanLogInput): Promise<boolean> {
  try {
    const client = createSupabaseServiceClient();
    const { error } = await client.from("scan_logs").insert({
      user_id: input.userId,
      image_path: input.imagePath,
      ocr_text: input.ocrText,
      char_count: input.charCount,
    });
    if (error) {
      console.warn("[ScanLog] Insert failed:", error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Fetch recent scan logs for admin review (newest first). */
export async function fetchRecentScanLogs(limit = 30): Promise<ScanLogRow[]> {
  try {
    const client = createSupabaseServiceClient();
    const { data, error } = await client
      .from("scan_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[ScanLog] Fetch failed:", error.message);
      return [];
    }
    return (data ?? []) as ScanLogRow[];
  } catch {
    return [];
  }
}

/** Get a signed URL for a scan image (valid for 1 hour). */
export async function getScanImageUrl(imagePath: string): Promise<string | null> {
  try {
    const client = createSupabaseServiceClient();
    const { data, error } = await client.storage.from("scan-images").createSignedUrl(imagePath, 3600);
    if (error) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Upload a scan image to the scan-images bucket. */
export async function uploadScanImage(
  base64: string,
  userId: string
): Promise<string | null> {
  try {
    const client = createSupabaseServiceClient();
    const path = `${userId}/${Date.now()}.jpg`;
    const content = base64.includes(",") ? base64.split(",")[1]! : base64;
    const buffer = Buffer.from(content, "base64");

    const { error } = await client.storage.from("scan-images").upload(path, buffer, {
      cacheControl: "3600",
      contentType: "image/jpeg",
      upsert: false,
    });

    if (error) {
      console.warn("[ScanImage] Upload failed:", error.message);
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

export async function uploadTemporaryImage(
  base64: string,
  mimeType: string,
  userId: string
): Promise<string | null> {
  try {
    const client = createSupabaseServiceClient();
    const fileExt = mimeType.split("/")[1] ?? "jpg";
    const path = `${userId}/${Date.now()}.${fileExt}`;
    const content = base64.includes(",") ? base64.split(",")[1] : base64;
    const buffer = Buffer.from(content, "base64");

    const { error } = await client.storage.from("images").upload(path, buffer, {
      cacheControl: "3600",
      contentType: mimeType,
      upsert: false
    });

    if (error) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}
