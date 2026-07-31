import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The signed-in user's own profile. Read server-side via the SSR client, which
 * carries the caller's session so RLS (`profiles` self-select) applies. Used by
 * the role-guarded layouts and settings.
 */
export interface MyProfile {
  id: string;
  role: "teacher" | "student";
  school_id: string;
  email: string;
  preferred_language: "he" | "ar" | "en" | null;
  deactivated_at: string | null;
}

/** Resolve the caller's profile, or null when signed out / no profile row. */
export async function getMyProfile(
  client: SupabaseClient
): Promise<MyProfile | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;
  const { data } = await client
    .from("profiles")
    .select("id, role, school_id, email, preferred_language, deactivated_at")
    .eq("id", user.id)
    .maybeSingle();
  return (data as MyProfile) ?? null;
}
