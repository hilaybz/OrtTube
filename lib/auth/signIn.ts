/**
 * Role-agnostic sign-in routing + deactivation gate.
 *
 * Sign-in itself is role-agnostic (one form). AFTER Supabase authenticates the
 * user, we read `profiles.role` (authoritative — never `user_metadata`) and:
 *   - if `deactivated_at IS NOT NULL` -> reject; the caller signs the user back out.
 *   - else -> route by role (teacher -> /dashboard, student -> /student).
 *
 * The profile read uses the service-role client (RLS-bypassing) so the decision is
 * deterministic and independent of profile RLS nuances.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Role = "teacher" | "student";

export const TEACHER_HOME = "/dashboard";
export const STUDENT_HOME = "/student";

/** Post-auth landing route for a role. Unknown roles default to the student home. */
export function routeForRole(role: string | null | undefined): string {
  return role === "teacher" ? TEACHER_HOME : STUDENT_HOME;
}

export type SignInEvaluation =
  | { ok: true; role: Role; route: string }
  // `lookup_failed` is a TRANSPORT/query error (DB down, network) — NOT a
  // decision about the account. Callers must NOT sign the user out for it (the
  // profile may well exist); retry / 503 instead. `no_profile` and `deactivated`
  // are genuine negative decisions that DO sign the user out.
  | { ok: false; code: "no_profile" | "deactivated" | "lookup_failed"; message: string };

/**
 * Given an authenticated user's id, decide whether they may proceed and where to
 * route them. `service` must be a service-role client (bypasses RLS).
 */
export async function evaluateSignIn(
  service: SupabaseClient,
  userId: string
): Promise<SignInEvaluation> {
  const { data, error } = await service
    .from("profiles")
    .select("role, deactivated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // A query/transport failure is NOT proof the profile is absent. Surface a
    // distinct code so the caller keeps the session intact and does not sign a
    // legitimate user out over a transient blip.
    return {
      ok: false,
      code: "lookup_failed",
      message: "Could not load your profile right now. Please try again in a moment.",
    };
  }

  if (!data) {
    return {
      ok: false,
      code: "no_profile",
      message: "No profile is associated with this account.",
    };
  }

  if (data.deactivated_at) {
    return {
      ok: false,
      code: "deactivated",
      message: "This account has been deactivated. Please contact your school administrator.",
    };
  }

  const role = (data.role === "teacher" ? "teacher" : "student") as Role;
  return { ok: true, role, route: routeForRole(role) };
}
