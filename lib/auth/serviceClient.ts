/**
 * Service-role Supabase client for auth.
 *
 * A service-role factory scoped to the auth flows: behaviourally identical to
 * `lib/supabase/service.ts` (service-role key, RLS-bypassing, server-only), it
 * backs the sign-in role/deactivation lookup and student/teacher provisioning,
 * which must read profiles and drive the `auth.admin` API regardless of RLS.
 *
 * Server-only: we use a runtime guard instead of `import "server-only"` because the
 * `server-only` package throws at import time under a plain Node/Vitest runtime
 * (no `react-server` condition), which would break the integration tests that
 * import the route handlers.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Creates a fresh service-role client. This client BYPASSES RLS and exposes the
 * `auth.admin` API (create/delete users). It must never reach the browser.
 *
 * Reads the existing env names (do not introduce a second `SUPABASE_URL`):
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Throws clearly if either is missing.
 */
export function createServiceClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "createServiceClient() must never be called in the browser (service-role key)."
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable.");
  }
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
