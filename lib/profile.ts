import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MyProfile {
  id: string;
  role: "teacher" | "student";
  school_id: string;
  email: string;
  display_name: string | null;
  preferred_language: "he" | "ar" | "en" | null;
  deactivated_at: string | null;
}

/**
 * Identifies the caller with `getClaims` rather than `getUser`: the project
 * signs its tokens with an asymmetric key, so the signature is verified locally
 * against a cached JWKS instead of by a round trip to the auth server on every
 * page. The guarantee is the same one `getUser` gives — a tampered or expired
 * token fails verification — and the select still runs under RLS, which is what
 * actually confines the row to this caller.
 *
 * The `id` filter is needed despite that: `profiles_select` also lets a teacher
 * read their own students, so an unfiltered select would return a roster rather
 * than one row.
 */
export const getMyProfile = cache(async function getMyProfile(
  client: SupabaseClient
): Promise<MyProfile | null> {
  const { data: claims } = await client.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data } = await client
    .from("profiles")
    .select(
      "id, role, school_id, email, display_name, preferred_language, deactivated_at"
    )
    .eq("id", userId)
    .maybeSingle();
  return (data as MyProfile) ?? null;
});
