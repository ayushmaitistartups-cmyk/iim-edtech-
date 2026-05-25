import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let _supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!_supabaseClient) {
    _supabaseClient = createClient(
      requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
  }
  return _supabaseClient;
}

export function createSupabaseServiceClient(): SupabaseClient {
  return getSupabaseClient();
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
