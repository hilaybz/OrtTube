import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AttemptError } from "@/lib/attempts";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared HTTP plumbing for the `/api/attempts/*` route handlers.
 *
 * Uniform error envelope `{ error: { code, message } }` and a single
 * mapping from the stable RPC/service error codes to HTTP status, so every route
 * reports the same code the DB raised. No answer key ever crosses this layer.
 */

export function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Map a stable AttemptError code to an HTTP status. */
export function statusForCode(code: string): number {
  switch (code) {
    case "unauthorized":
      return 401;
    case "not_member":
    case "not_your_attempt":
      return 403;
    case "not_assigned":
    case "quiz_not_found":
    case "attempt_not_found":
    case "question_not_in_attempt":
      return 404;
    case "no_attempts_left":
    case "already_answered":
    case "attempt_completed":
      return 409;
    case "invalid_selection_count":
    case "invalid_option":
    case "invalid_request":
      return 400;
    default:
      return 400;
  }
}

/** Translate a thrown AttemptError into the uniform JSON response. */
export function handleError(e: unknown) {
  if (e instanceof AttemptError) {
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
