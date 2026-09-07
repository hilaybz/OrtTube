import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Identifies the caller with `getClaims` rather than `getUser`. `getUser` is
 * unconditionally a request to the auth server, and it sits in front of the RPC
 * on every authenticated route, so it lands one extra round trip on requests
 * that are otherwise a single query. `getClaims` verifies the token's signature
 * locally against a cached JWKS, and falls back to `getUser` on its own when the
 * token is symmetrically signed or the key is unknown — so the check is never
 * weaker than it was, and stops costing a hop wherever asymmetric signing keys
 * are enabled.
 *
 * This gate is deliberately kept rather than left to the RPCs: the `SECURITY
 * DEFINER` RPCs do reject an anonymous `auth.uid()`, but several service
 * wrappers are plain selects, where RLS answers a signed-out caller with an
 * empty result and a 200 instead of a 401.
 */
export async function requireAuth(): Promise<
  | { client: SupabaseClient; userId: string; response?: undefined }
  | { response: NextResponse; client?: undefined; userId?: undefined }
> {
  const client = (await createClient()) as unknown as SupabaseClient;
  const { data } = await client.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) {
    return { response: err("unauthorized", "Sign in required", 401) };
  }
  return { client, userId };
}
