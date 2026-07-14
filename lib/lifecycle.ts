import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * User-lifecycle primitives.
 *
 * Server-only helpers, always driven with the **service-role** client (they
 * hard-delete `auth.users` rows and call the privileged lifecycle RPCs, both of
 * which require elevated context). Consumed by `/api/admin/delete-user`.
 *
 * Deletion policy:
 *   • student → hard-delete the auth user. Its `profiles` row cascades
 *     (ON DELETE CASCADE), which cascades `class_members` and drives
 *     `attempts.student_id` / `tutor_questions.student_id` to NULL (SET NULL) —
 *     PII gone, behavioural rows survive anonymised (right-to-be-forgotten).
 *   • teacher → NEVER hard-deleted while they own classes/quizzes
 *     (ON DELETE RESTRICT). Return `must_reassign`; the caller must
 *     `deactivateTeacher` + `reassignOwnership` first, after which the teacher
 *     owns nothing and this hard-deletes them like a student.
 */

export type Role = "teacher" | "student";

export type DeleteUserResult =
  | { status: "deleted"; role: Role; userId: string }
  | { status: "must_reassign"; userId: string; classes: number; quizzes: number };

export interface DeactivateTeacherResult {
  teacherId: string;
  deactivatedAt: string;
}

export interface ReassignOwnershipResult {
  fromTeacher: string;
  toTeacher: string;
  classesReassigned: number;
  quizzesReassigned: number;
}

/**
 * A lifecycle failure with a stable `code` and an HTTP `status` the admin
 * endpoint maps directly onto its `{ error: { code, message } }` response.
 */
export class LifecycleError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "LifecycleError";
    this.code = code;
    this.status = status;
  }
}

/** Shape of a PostgREST error as surfaced by supabase-js `.rpc()`. */
interface PostgrestErrorLike {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** Loose `.rpc()` signature: the generated types omit these RPCs until the gate
 *  regenerates `lib/supabase/types.ts`, so we call through a narrow cast rather
 *  than editing that (gate-owned) file. */
type RpcCaller = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: PostgrestErrorLike | null }>;

/** Map an RPC SQLSTATE onto a `LifecycleError`. */
function mapRpcError(err: PostgrestErrorLike): LifecycleError {
  switch (err.code) {
    case "OT404":
      return new LifecycleError("not_found", err.message, 404);
    case "OT400":
      return new LifecycleError("not_a_teacher", err.message, 400);
    case "OT409":
      return new LifecycleError("reassign_conflict", err.message, 409);
    case "OT422":
      return new LifecycleError("invalid_reassign", err.message, 422);
    default:
      return new LifecycleError("lifecycle_error", err.message, 500);
  }
}

/** Postgres RESTRICT foreign-key violation (a teacher still owns content). */
const FK_RESTRICT_VIOLATION = "23503";

/**
 * Delete a user, branching by role. Idempotent-friendly: a missing
 * profile raises `not_found`.
 */
export async function deleteUser(
  service: SupabaseClient<Database>,
  userId: string
): Promise<DeleteUserResult> {
  const { data: profile, error: profileErr } = await service
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr) {
    throw new LifecycleError("lifecycle_error", profileErr.message, 500);
  }
  if (!profile) {
    throw new LifecycleError("not_found", `No profile for user ${userId}`, 404);
  }

  const role = profile.role as Role;

  if (role === "teacher") {
    const owned = await countTeacherContent(service, userId);
    if (owned.classes > 0 || owned.quizzes > 0) {
      return {
        status: "must_reassign",
        userId,
        classes: owned.classes,
        quizzes: owned.quizzes,
      };
    }
  }

  // Hard-delete the auth user; FK cascade/SET-NULL rules do the anonymisation.
  const { error: delErr } = await service.auth.admin.deleteUser(userId);
  if (delErr) {
    // Race fallback: if a class/quiz was assigned to this teacher between the
    // ownership check and the delete, the RESTRICT FK rejects it — surface the
    // same must_reassign contract rather than a 500.
    const code = (delErr as { code?: string }).code;
    if (role === "teacher" && code === FK_RESTRICT_VIOLATION) {
      const owned = await countTeacherContent(service, userId);
      return {
        status: "must_reassign",
        userId,
        classes: owned.classes,
        quizzes: owned.quizzes,
      };
    }
    throw new LifecycleError("delete_failed", delErr.message, 500);
  }

  return { status: "deleted", role, userId };
}

/** Count the classes and quizzes a teacher owns (incl. soft-deleted quizzes —
 *  the RESTRICT FK blocks a delete regardless of `deleted_at`). */
async function countTeacherContent(
  service: SupabaseClient<Database>,
  teacherId: string
): Promise<{ classes: number; quizzes: number }> {
  const [{ count: classes, error: cErr }, { count: quizzes, error: qErr }] =
    await Promise.all([
      service
        .from("classes")
        .select("*", { count: "exact", head: true })
        .eq("teacher_id", teacherId),
      service
        .from("quizzes")
        .select("*", { count: "exact", head: true })
        .eq("author_id", teacherId),
    ]);

  if (cErr) throw new LifecycleError("lifecycle_error", cErr.message, 500);
  if (qErr) throw new LifecycleError("lifecycle_error", qErr.message, 500);

  return { classes: classes ?? 0, quizzes: quizzes ?? 0 };
}

/**
 * Very long ban window (~100 years) — GoTrue has no "permanent" flag, so a large
 * finite duration is the idiomatic way to keep a user locked out.
 */
const BAN_DURATION = "876000h";

/**
 * Deactivate a teacher (RPC `deactivate_teacher`). Idempotent.
 *
 * Stamping `profiles.deactivated_at` gates FUTURE sign-ins (the sign-in
 * evaluation rejects a deactivated profile), but an ALREADY-issued GoTrue access
 * token stays valid until it expires — so a just-deactivated teacher could keep
 * acting via their live session. We therefore also BAN the auth user, which
 * revokes their refresh token and blocks new token issuance, closing that window.
 * The ban is best-effort layered on top of the authoritative DB flag: if it
 * fails we still surface the deactivation (the profile flag already applied).
 */
export async function deactivateTeacher(
  service: SupabaseClient<Database>,
  teacherId: string
): Promise<DeactivateTeacherResult> {
  const rpc = service.rpc.bind(service) as unknown as RpcCaller;
  const { data, error } = await rpc("deactivate_teacher", {
    p_teacher_id: teacherId,
  });
  if (error) throw mapRpcError(error);

  // Revoke the GoTrue session so a live token can't outlive the deactivation.
  const { error: banErr } = await service.auth.admin.updateUserById(teacherId, {
    ban_duration: BAN_DURATION,
  });
  if (banErr) {
    // Non-fatal: the authoritative profile flag is already set. Log for ops.
    console.error(
      `[lifecycle] failed to ban deactivated teacher ${teacherId}: ${banErr.message}`
    );
  }

  const row = data as { teacher_id: string; deactivated_at: string };
  return { teacherId: row.teacher_id, deactivatedAt: row.deactivated_at };
}

/**
 * Reassign every class + quiz from one teacher to another (RPC
 * `reassign_ownership`). Target must be an active, same-school teacher.
 */
export async function reassignOwnership(
  service: SupabaseClient<Database>,
  fromTeacher: string,
  toTeacher: string
): Promise<ReassignOwnershipResult> {
  const rpc = service.rpc.bind(service) as unknown as RpcCaller;
  const { data, error } = await rpc("reassign_ownership", {
    p_from_teacher: fromTeacher,
    p_to_teacher: toTeacher,
  });
  if (error) throw mapRpcError(error);

  const row = data as {
    from_teacher: string;
    to_teacher: string;
    classes_reassigned: number;
    quizzes_reassigned: number;
  };
  return {
    fromTeacher: row.from_teacher,
    toTeacher: row.to_teacher,
    classesReassigned: row.classes_reassigned,
    quizzesReassigned: row.quizzes_reassigned,
  };
}
