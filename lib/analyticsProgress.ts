/**
 * Per-student (roster) analytics (compute-on-read).
 *
 * Thin, typed wrappers over the owner-checked `SECURITY DEFINER` RPCs
 * `class_roster_progress` and `student_quiz_progress`. Where `lib/analytics.ts`
 * aggregates attempts anonymously, these surface INDIVIDUAL student progress and
 * scores for the class's teacher — this is owner-only teacher analytics, so
 * per-student attribution is intentional.
 *
 * Trust model (identical to `lib/analytics.ts`):
 * - The RPCs check ownership via `auth.uid()`, so they MUST be called with a
 *   client carrying the signed-in teacher's session (the SSR/anon client in
 *   `lib/supabase/server.ts`) — NOT the service-role client, which has no
 *   `auth.uid()` and would always be rejected as `not_owner`.
 * - Errors are raised as `AnalyticsError` (reusing the class from
 *   `lib/analytics.ts`) carrying the RPC's stable code (e.g. `not_owner`), so the
 *   shared `/api/analytics/*` error mapper maps a non-owner to HTTP 403.
 *
 * The RPC names are cast at the call site rather than typed against the generated
 * `Database` type, so these wrappers do not depend on the new functions appearing
 * in `lib/supabase/types.ts`. The runtime calls are valid against the deployed
 * schema.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AnalyticsError } from "@/lib/analytics";

// ---------------------------------------------------------------------------
// Result shapes (mirror the jsonb the RPCs build).
// ---------------------------------------------------------------------------

/** One assigned, non-deleted quiz as it stands for a single member. */
export interface RosterQuizProgress {
  quiz_id: string;
  title: string | null;
  /** The member has at least one completed attempt for this quiz. */
  completed: boolean;
  /** All attempt rows (completed or not) this member has for the quiz. */
  attempt_count: number;
  /** `num_correct` of the member's best gradeable completed attempt, or `null`. */
  best_num_correct: number | null;
  /** `num_questions` of that same best attempt, or `null`. */
  best_num_questions: number | null;
  /**
   * Highest `num_correct / num_questions` fraction (0..1) over the member's
   * completed, gradeable attempts. `null` when none.
   */
  best_score: number | null;
}

/** One current class member with a per-quiz breakdown and a rollup. */
export interface RosterMemberProgress {
  student_id: string;
  display_name: string | null;
  email: string;
  /** Assigned, non-deleted quiz count (the completion denominator). */
  total_assigned: number;
  /** Quizzes this member has completed at least once. */
  quizzes_completed: number;
  /** Mean of this member's per-quiz best scores (0..1), or `null` if none. */
  average_best_score: number | null;
  quizzes: RosterQuizProgress[];
}

/** Class-level rollup accompanying the per-member breakdown. */
export interface RosterProgressSummary {
  /** Current roster size. */
  member_count: number;
  /** Assigned, non-deleted quiz count. */
  total_assigned: number;
  /** `member_count * total_assigned` — the completion ceiling. */
  possible_completions: number;
  /** Sum over members of `quizzes_completed`. */
  quizzes_completed_total: number;
  /** Mean best score (0..1) over every completed member×quiz pair, or `null`. */
  average_best_score: number | null;
}

/** `class_roster_progress(class_id)` result envelope. */
export interface ClassRosterProgress {
  class_id: string;
  summary: RosterProgressSummary;
  members: RosterMemberProgress[];
}

/** One attempt row in the single-student drill-down. */
export interface StudentAttemptProgress {
  attempt_id: string;
  attempt_no: number;
  started_at: string;
  completed_at: string | null;
  num_correct: number | null;
  num_questions: number | null;
  /** `num_correct / num_questions` (0..1) for a completed, gradeable attempt. */
  score: number | null;
}

/** One assigned, non-deleted quiz with the student's full attempt list. */
export interface StudentQuizProgressItem {
  quiz_id: string;
  title: string | null;
  completed: boolean;
  attempt_count: number;
  best_score: number | null;
  attempts: StudentAttemptProgress[];
}

/** `student_quiz_progress(class_id, student_id)` result envelope. */
export interface StudentQuizProgress {
  class_id: string;
  student_id: string;
  display_name: string | null;
  email: string | null;
  quizzes: StudentQuizProgressItem[];
}

// ---------------------------------------------------------------------------
// Internals (mirror lib/analytics.ts; decoupled from the generated Database type)
// ---------------------------------------------------------------------------

interface RpcError {
  message: string;
  code?: string;
}

type RpcInvoker = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: RpcError | null }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

async function callRpc<T>(
  client: AnyClient,
  fn: string,
  args: Record<string, unknown>
): Promise<T> {
  const rpc = client.rpc.bind(client) as unknown as RpcInvoker;
  const { data, error } = await rpc(fn, args);
  if (error) {
    throw new AnalyticsError(error.message);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Per-current-member progress across the class's assigned, non-deleted quizzes,
 * with a per-member rollup and a class-level summary. Caller must own the class,
 * else `not_owner`.
 */
export async function getClassRosterProgress(
  client: AnyClient,
  classId: string
): Promise<ClassRosterProgress> {
  return callRpc<ClassRosterProgress>(client, "class_roster_progress", {
    p_class_id: classId,
  });
}

/**
 * Drill-down for one student: per assigned, non-deleted quiz, the full attempt
 * list with scores. Caller must own the class, else `not_owner`.
 */
export async function getStudentQuizProgress(
  client: AnyClient,
  classId: string,
  studentId: string
): Promise<StudentQuizProgress> {
  return callRpc<StudentQuizProgress>(client, "student_quiz_progress", {
    p_class_id: classId,
    p_student_id: studentId,
  });
}
