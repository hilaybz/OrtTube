import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Service-role Supabase client factory.
 *
 * This client uses the `service_role` key and therefore **bypasses RLS**. It is
 * strictly server-only (guarded by `import "server-only"`) and must never be
 * imported into a client component. Use it only for privileged, server-side work:
 * shared `videos` writes, signup orchestration (which must be able to delete an
 * `auth.users` row), teacher seeding, scheduled jobs, and calling
 * `SECURITY DEFINER` RPCs that need elevated context.
 *
 * For any read/write that should be constrained to the signed-in user, use the
 * anon/SSR client in `./server.ts` instead (subject to RLS).
 *
 * Reuses the existing `NEXT_PUBLIC_SUPABASE_URL` env var (do NOT introduce a
 * second `SUPABASE_URL`) plus `SUPABASE_SERVICE_ROLE_KEY`.
 */
export function createServiceClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "createServiceClient: missing NEXT_PUBLIC_SUPABASE_URL environment variable"
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      "createServiceClient: missing SUPABASE_SERVICE_ROLE_KEY environment variable"
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      // No user session for a service-role client.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
