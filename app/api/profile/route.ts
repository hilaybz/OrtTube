import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSupportedLanguage } from "@/lib/lang";

/**
 * /api/profile  (self-service profile settings)
 *   PATCH → update the caller's own `profiles.preferred_language`.
 *
 * The value must be one of `he`/`ar`/`en`, or `null` to clear it (fall back to
 * the class/quiz language). The write goes through the SSR (RLS-subject) client,
 * so the `profiles` self-update policy is what actually authorises it — this
 * handler only authenticates, validates, and shapes the response.
 *
 * Uniform error envelope `{ error: { code, message } }`; success returns the
 * persisted `{ preferred_language }`.
 */

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function PATCH(req: NextRequest) {
  const client = (await createClient()) as unknown as SupabaseClient;
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return err("unauthorized", "Sign in required", 401);

  let body: { preferred_language?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("invalid_request", "Body must be JSON", 400);
  }

  const raw = body.preferred_language;
  if (raw !== null && !isSupportedLanguage(raw)) {
    return err(
      "invalid_request",
      "preferred_language must be one of he, ar, en, or null",
      400
    );
  }
  const value = raw as "he" | "ar" | "en" | null;

  const { data, error } = await client
    .from("profiles")
    .update({ preferred_language: value })
    .eq("id", user.id)
    .select("preferred_language")
    .maybeSingle();

  if (error) return err("internal_error", "Unexpected error", 500);
  if (!data) return err("not_authorized", "אין לך הרשאה לפעולה זו.", 403);

  return NextResponse.json({
    preferred_language: (data as { preferred_language: string | null })
      .preferred_language,
  });
}
