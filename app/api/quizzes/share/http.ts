import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SharingError } from "@/lib/sharing";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared HTTP plumbing for the `/api/quizzes/share` route handlers.
 *
 * Uniform error envelope `{ error: { code, message } }` and a single
 * mapping from the stable RPC/service error codes to HTTP status, so the route
 * reports the same code the DB raised.
 */

export function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Map a stable SharingError code to an HTTP status. */
export function statusForCode(code: string): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "not_authorized":
    case "quiz_deleted":
      return 403;
    case "quiz_not_found":
      return 404;
    default:
      return 400;
  }
}

/** Translate a thrown SharingError into the uniform JSON response. */
export function handleError(e: unknown) {
  if (e instanceof SharingError) {
    return err(e.code, e.message, statusForCode(e.code));
  }
  return err("internal_error", "Unexpected error", 500);
}

/**
 * Resolve the signed-in user + RLS-subject client, or an early 401 response.
 * Returns a discriminated result so callers can `if (auth.response) return`.
 */
export async function requireAuth(): Promise<
  | { client: SupabaseClient; userId: string; response?: undefined }
  | { response: NextResponse; client?: undefined; userId?: undefined }
> {
  const client = (await createClient()) as unknown as SupabaseClient;
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    return { response: err("unauthorized", "Sign in required", 401) };
  }
  return { client, userId: user.id };
}
