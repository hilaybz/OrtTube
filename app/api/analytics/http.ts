import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AnalyticsError } from "@/lib/analytics";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared HTTP plumbing for the `/api/analytics/*` route handlers.
 *
 * Uniform error envelope `{ error: { code, message } }`. The analytics
 * RPCs are owner-checked; they raise `not_owner` (SQLSTATE 42501) for a
 * non-owner or unknown target, and `invalid_args` (SQLSTATE 22023) for the
 * scope rule of `tutor_stats`. `AnalyticsError.code` carries the SQLSTATE, so
 * map on that (with a fallback on the message text).
 */

export function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Translate a thrown AnalyticsError into the uniform JSON response. */
export function handleError(e: unknown) {
  if (e instanceof AnalyticsError) {
    const sqlstate = e.code ?? "";
    const msg = e.message ?? "";
    if (sqlstate === "42501" || msg.startsWith("not_owner")) {
      return err("not_owner", "Not the owner of this resource", 403);
    }
    if (sqlstate === "22023" || msg.startsWith("invalid_args")) {
      return err("invalid_args", msg || "Invalid arguments", 400);
    }
    return err("analytics_error", msg || "Analytics error", 400);
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
