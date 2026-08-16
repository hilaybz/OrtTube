import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AnalyticsError } from "@/lib/analytics";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared HTTP plumbing for the `/api/analytics/*` route handlers.
 *
 * Uniform error envelope `{ error: { code, message } }`. The analytics RPCs are
 * owner-checked; they raise `not_owner` for a non-owner or unknown target, and
 * `invalid_args` for the scope rule of `tutor_stats`. `AnalyticsError.code`
 * carries that stable code, so map on it directly.
 */

export function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Map a stable AnalyticsError code to an HTTP status. */
export function statusForCode(code: string): number {
  switch (code) {
    case "not_owner":
      return 403;
    case "not_assigned":
      return 404;
    case "invalid_args":
      return 400;
    default:
      return 400;
  }
}

/** Translate a thrown AnalyticsError into the uniform JSON response. */
export function handleError(e: unknown) {
  if (e instanceof AnalyticsError) {
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
