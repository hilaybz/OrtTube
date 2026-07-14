/**
 * Small service-role helpers for the admin `seed-teacher` route test.
 *
 * The richer auth flows (sign-in routing, student self-signup) now tell their
 * story through the actor DSL in `test/helpers/testbed`. What remains here is the
 * minimal service-role plumbing the `seed-teacher` HTTP test still needs: an
 * env-gate, a service client, unique emails, and a couple of teardown/read
 * helpers. Everything runs against the real local Supabase at the gate and skips
 * cleanly when the env is absent.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Whether the local Supabase service-role env is configured (else skip). */
export function haveEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/** A service-role client that bypasses RLS. */
export function service(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** A unique-enough email so parallel runs / re-runs never collide. */
export function uniqueEmail(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}@test.orttube.local`;
}

/** Delete an auth user (cascades its profile, memberships, etc.). Best-effort. */
export async function deleteUser(db: SupabaseClient, userId: string): Promise<void> {
  await db.auth.admin.deleteUser(userId).catch(() => {});
}

/** Delete a school. Best-effort teardown. */
export async function deleteSchool(db: SupabaseClient, schoolId: string): Promise<void> {
  await db.from("schools").delete().eq("id", schoolId);
}

/** Read a profile by id (RLS-bypassing), or null if none exists. */
export async function getProfile(
  db: SupabaseClient,
  userId: string
): Promise<{ role: string; school_id: string; email: string; deactivated_at: string | null } | null> {
  const { data } = await db
    .from("profiles")
    .select("role, school_id, email, deactivated_at")
    .eq("id", userId)
    .maybeSingle();
  return data as never;
}
