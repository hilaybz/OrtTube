/**
 * Analytics (compute-on-read).
 *
 * Thin, typed wrappers over the owner-checked `SECURITY DEFINER` RPCs
 * (`quiz_stats`, `question_stats`, `class_stats`, `tutor_stats`). All statistics
 * are computed live from the normalized tables — there are no rollup or
 * pre-aggregated tables.
 *
 * Trust model:
 * - These RPCs check ownership via `auth.uid()`, so they MUST be called with a
 *   client that carries the signed-in teacher's session (the SSR/anon client in
 *   `lib/supabase/server.ts`) — NOT the service-role client, which has no
 *   `auth.uid()` and would always be rejected as `not_owner`.
 * - The RPCs are the only public surface; they never expose per-student PII when
 *   a row has been anonymized (`student_id IS NULL`) — those rows still count
 *   toward totals/averages, just without attribution.
 * - `question_stats` intentionally DOES surface `is_correct` and the base-language
 *   text: this is teacher-facing owner analytics, not a student read path. The
 *   answer key never crosses to a student because the RPC denies non-owners.
 *
 * The RPC names are cast at the call site rather than typed against the generated
 * `Database` type, so these wrappers do not depend on the analytics functions
 * appearing in the generated `lib/supabase/types.ts`. The runtime calls are valid
 * against the deployed database schema.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** A supported content language (see `lib/lang.ts`). */
export type Language = "he" | "ar" | "en";

/** Question kind (single- vs multi-select). */
export type QuestionKind = "single" | "multi";

/** Per-class tutor delivery mode. */
export type TutorMode = "off" | "hints" | "full";

/** Error raised when an analytics RPC fails (e.g. `not_owner`, `invalid_args`). */
export class AnalyticsError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "AnalyticsError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Result shapes (mirror the jsonb the RPCs build).
// ---------------------------------------------------------------------------

/** `quiz_stats(quiz_id)` — quiz-level completion/attempt/score summary. */
export interface QuizStats {
  quiz_id: string;
  /** Total attempt rows for the quiz (started; includes incomplete). */
  attempt_count: number;
  /** Attempts with `completed_at IS NOT NULL`. */
  completion_count: number;
  /**
   * Mean fraction correct (0..1) over completed attempts, computed from
   * `attempts.num_correct / num_questions`. `null` when no completed attempts.
   */
  average_score: number | null;
}

/** One option's row in a question's distractor distribution. */
export interface QuestionOptionStat {
  option_id: string;
  /** The answer key — safe here: owner-facing analytics only. */
  is_correct: boolean;
  /** True when the option was soft-deleted; still reported for history. */
  deleted: boolean;
  order_index: number;
  /** Base-language option text (`null` if no translation row exists). */
  text: string | null;
  /** How many times this option was chosen (across all attempts). */
  selection_count: number;
}

/** Per-question statistics within a quiz. */
export interface QuestionStat {
  question_id: string;
  kind: QuestionKind;
  order_index: number;
  /** True when the question was soft-deleted; still reported for history. */
  deleted: boolean;
  position_seconds: number;
  /** Base-language prompt (`null` if no translation row exists). */
  prompt: string | null;
  /** Number of answers recorded for this question. */
  total_answers: number;
  /** Answers with `was_correct = true`. */
  correct_count: number;
  /** `correct_count / total_answers` (0..1), or `null` when never answered. */
  correct_pct: number | null;
  /**
   * Distractor distribution over ALL options, including soft-deleted ones, so
   * historical selections still read.
   */
  options: QuestionOptionStat[];
}

/** `question_stats(quiz_id)` result envelope. */
export interface QuestionStatsResult {
  quiz_id: string;
  base_language: Language | null;
  questions: QuestionStat[];
}

/** Per-assigned-quiz statistics inside a class. */
export interface ClassQuizStat {
  quiz_id: string;
  title: string | null;
  /** True when the quiz was soft-deleted (assignment row may still exist). */
  deleted: boolean;
  tutor_mode: TutorMode;
  /** `null` = unlimited attempts. */
  max_attempts: number | null;
  /** Attempt-based: all attempt rows for (class, quiz). */
  attempt_count: number;
  /**
   * Attempt-based completion: completed attempt rows for (class, quiz).
   * Includes anonymized attempts (`student_id IS NULL`), so departed/deleted
   * students still count toward the total.
   */
  completion_count: number;
  /** Mean fraction correct (0..1) over completed attempts, or `null`. */
  average_score: number | null;
  /**
   * Roster-based coverage: distinct CURRENT class members who have a completed
   * attempt. This necessarily EXCLUDES anonymized/departed students, so it is
   * reported separately from `completion_count` and must not be conflated with
   * it. Read as "`members_completed` of `current_member_count`".
   */
  members_completed: number;
  /** Denominator for the roster-based figure — current class size. */
  current_member_count: number;
}

/** `class_stats(class_id)` result envelope. */
export interface ClassStats {
  class_id: string;
  /** Current roster size (count of `class_members`). */
  current_member_count: number;
  quizzes: ClassQuizStat[];
}

/** A single flagged tutor interaction (likely answer-extraction attempt). */
export interface TutorExtractionAttempt {
  id: string;
  /** `null` when the student was anonymized. */
  student_id: string | null;
  quiz_id: string;
  class_id: string;
  /** The on-screen question at ask time (present ⇒ flagged). */
  question_id: string | null;
  attempt_id: string | null;
  position_seconds: number | null;
  prompt: string;
  created_at: string;
}

/** `tutor_stats(quiz_id | class_id)` result. */
export interface TutorStats {
  scope: "quiz" | "class";
  /** Total `tutor_questions` rows in scope. */
  total_questions: number;
  /** Distinct non-null students who asked. */
  distinct_students: number;
  /** Rows whose student was anonymized (`student_id IS NULL`). */
  anonymized_count: number;
  /**
   * Rows asked while a quiz question was on screen (`question_id IS NOT NULL`) —
   * likely answer-extraction attempts, for teacher audit.
   */
  answer_extraction_count: number;
  /** The flagged rows (most recent first, capped server-side). */
  answer_extraction_attempts: TutorExtractionAttempt[];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface RpcError {
  message: string;
  code?: string;
}

/**
 * Minimal structural view of the client's `.rpc(...)` so these wrappers stay
 * decoupled from the generated `Database` type (regenerated at the gate).
 */
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
    throw new AnalyticsError(error.message, error.code);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Quiz-level stats (completion count, attempt count, average score).
 * Caller must own the quiz and be a non-deactivated teacher, else `not_owner`.
 */
export async function getQuizStats(
  client: AnyClient,
  quizId: string
): Promise<QuizStats> {
  return callRpc<QuizStats>(client, "quiz_stats", { p_quiz_id: quizId });
}

/**
 * Per-question correct% + distractor distribution (soft-deleted options
 * included). Owner-checked.
 */
export async function getQuestionStats(
  client: AnyClient,
  quizId: string
): Promise<QuestionStatsResult> {
  return callRpc<QuestionStatsResult>(client, "question_stats", {
    p_quiz_id: quizId,
  });
}

/**
 * Per-assigned-quiz class stats: attempt-based averages/completion (anonymized
 * attempts still count) plus a separate current-roster coverage figure.
 * Caller must own the class.
 */
export async function getClassStats(
  client: AnyClient,
  classId: string
): Promise<ClassStats> {
  return callRpc<ClassStats>(client, "class_stats", { p_class_id: classId });
}

/**
 * Tutor-interaction stats for a quiz OR a class (exactly one scope). Flags
 * likely answer-extraction attempts. Owner-checked for the given scope.
 */
export async function getTutorStats(
  client: AnyClient,
  scope: { quizId: string } | { classId: string }
): Promise<TutorStats> {
  const args: Record<string, unknown> =
    "quizId" in scope
      ? { p_quiz_id: scope.quizId, p_class_id: null }
      : { p_quiz_id: null, p_class_id: scope.classId };
  return callRpc<TutorStats>(client, "tutor_stats", args);
}
