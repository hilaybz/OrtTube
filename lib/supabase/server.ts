import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";

/**
 * Memoized because the client validates the session JWT against the auth server
 * before its first data call, and that is a network round trip. A layout and the
 * page inside it each used to build their own client and so each paid for that
 * validation separately — two hops to learn the same thing about the same
 * request. Sharing one instance means one validation, and the session it caches
 * is then reused by everything downstream.
 *
 * Safe to share: the instance is scoped to a single request, and writing cookies
 * from a Server Component is already a no-op here (see `setAll`).
 */
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server component — cookies can't be set, session refresh handled by middleware
          }
        },
      },
    }
  );
});
