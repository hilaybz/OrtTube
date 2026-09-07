import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function haveEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function service(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export function uniqueEmail(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}@test.orttube.local`;
}

export async function deleteUser(db: SupabaseClient, userId: string): Promise<void> {
  await db.auth.admin.deleteUser(userId).catch(() => {});
}

export async function deleteSchool(db: SupabaseClient, schoolId: string): Promise<void> {
  await db.from("schools").delete().eq("id", schoolId);
}

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
