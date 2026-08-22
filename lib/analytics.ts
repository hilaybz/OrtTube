/**
 * Analytics (compute-on-read).
 *
 * Thin, typed wrappers over the owner-checked `SECURITY DEFINER` RPCs behind the
 * teacher analytics hub — the per-entity readers (`class_analytics_overview`,
 * `student_analytics`, `quiz_analytics_overview`), the hub's own
 * `teacher_analytics_search`, the tutor-question log (`tutor_questions_page`,
 * `tutor_prompts_in_scope`) and the older narrower aggregates (`quiz_stats`,
 * `question_stats`, `class_stats`, `class_quiz_analytics`, `tutor_stats`). All
 * statistics are computed live from the normalized tables — there are no rollup
 * or pre-aggregated tables.
 *
 * Where two readers can answer the same question they share one scoring basis:
 * each student's LATEST completed attempt, the grade that student is shown
 * themselves. `class_stats` (090-era, attempt-pooled) is the exception, kept for
 * the overview screen it already feeds.
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

/**
 * Error raised when an analytics RPC fails. `code` is the stable code the RPC
 * raised as its exception message (e.g. `not_owner`, `invalid_args`), matching
 * the `ClassError` convention so consumers switch on `code` alone.
 */
export class AnalyticsError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
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
  content_updated_at: string | null;
  excluded_attempt_count: number;
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
  content_updated_at: string | null;
  excluded_attempt_count: number;
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

/** One 20%-wide score band in a `ClassQuizAnalytics.score_distribution`. */
export interface ScoreBucket {
  /** Inclusive lower bound, 0..1 (e.g. `0.4`). */
  bucket_min: number;
  /** Exclusive upper bound, 0..1 (e.g. `0.6`) — except the top bucket, which
   * includes a perfect score. */
  bucket_max: number;
  /** Students whose latest completed attempt scored in this band. */
  count: number;
}

/** One option's row in `ClassQuizAnalyticsQuestion.options`. */
export interface ClassQuizOptionStat {
  option_id: string;
  order_index: number;
  /** Class-language option text, falling back to the quiz's base language. */
  text: string | null;
  /** The answer key — safe here: owner-facing analytics only. */
  is_correct: boolean;
  /** True when the option was soft-deleted; still reported for history. */
  deleted: boolean;
  /**
   * How many students (by their latest completed attempt) chose this option —
   * never inflated by retakes or by another class running the same quiz.
   */
  selection_count: number;
}

/** Per-question statistics within one class's assignment of a quiz. */
export interface ClassQuizQuestionStat {
  question_id: string;
  order_index: number;
  position_seconds: number;
  kind: QuestionKind;
  /** True when the question was soft-deleted; still reported for history. */
  deleted: boolean;
  /** Class-language prompt, falling back to the quiz's base language. */
  prompt: string | null;
  /** Students (latest attempt) who answered this question at all. */
  answered_count: number;
  /** Of those, how many answered correctly. */
  correct_count: number;
  /** `correct_count / answered_count` (0..1), or `null` when never answered. */
  correct_pct: number | null;
  options: ClassQuizOptionStat[];
}

/**
 * `class_quiz_analytics(class_id, quiz_id)` result — the per-(class, quiz)
 * view `class_stats`/`question_stats` don't provide (those are class-wide-all-
 * quizzes and quiz-wide-all-classes respectively). Scored from each student's
 * LATEST completed attempt only, matching the grade they're shown themselves —
 * never best-of, never every retake.
 */
export interface ClassQuizAnalytics {
  class_id: string;
  quiz_id: string;
  title: string | null;
  content_updated_at: string | null;
  excluded_attempt_count: number;
  question_count: number;
  /** Current roster size. */
  member_count: number;
  /** Distinct students counted in `average_score`/`score_distribution`. */
  students_completed: number;
  /** All attempt rows for (class, quiz), any state — includes retakes. */
  attempt_count: number;
  /** All completed attempt rows for (class, quiz) — includes retakes. */
  completion_count: number;
  /** Mean fraction correct (0..1) over each student's latest attempt, or `null`. */
  average_score: number | null;
  /** Always 5 bands, 0 counts included. */
  score_distribution: ScoreBucket[];
  questions: ClassQuizQuestionStat[];
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
    throw new AnalyticsError(error.message);
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
 * Per-question, per-option, and score-distribution stats for one quiz WITHIN
 * one class — the view `class_stats`/`question_stats` can't give alone.
 * Caller must own the class; the quiz must be currently assigned to it
 * (`not_owner` / `not_assigned`, in that check order).
 */
export async function getClassQuizAnalytics(
  client: AnyClient,
  classId: string,
  quizId: string
): Promise<ClassQuizAnalytics> {
  return callRpc<ClassQuizAnalytics>(client, "class_quiz_analytics", {
    p_class_id: classId,
    p_quiz_id: quizId,
  });
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

// ---------------------------------------------------------------------------
// Hub search (`teacher_analytics_search`)
// ---------------------------------------------------------------------------

/** The three entity kinds the analytics hub can search and render. */
export type AnalyticsScope = "student" | "class" | "quiz";

/**
 * One search hit. The RPC returns a single row shape for all three scopes with
 * the fields that don't apply left out, so the hub renders per-scope copy from
 * one list type instead of a discriminated union it would have to narrow at
 * every call site.
 */
export interface AnalyticsSearchHit {
  id: string;
  /** Class name / student display name / quiz title — `null` for an untitled quiz. */
  name: string | null;
  /** student scope. */
  email?: string;
  /** student scope — how many of the teacher's classes they are in. */
  class_count?: number;
  /** student scope — those classes, comma-joined. */
  class_names?: string | null;
  /** class scope. */
  language?: Language;
  /** class scope. */
  member_count?: number;
  /** class scope — assigned, non-deleted quizzes. */
  quiz_count?: number;
  /** quiz scope. */
  video_title?: string | null;
  /** quiz scope. */
  visibility?: "private" | "shared";
  /** quiz scope. */
  base_language?: Language;
  /** quiz scope — live questions. */
  question_count?: number;
}

/** `teacher_analytics_search(...)` result envelope — one page plus its total. */
export interface AnalyticsSearchResult {
  scope: AnalyticsScope;
  query: string;
  limit: number;
  offset: number;
  total: number;
  results: AnalyticsSearchHit[];
}

// ---------------------------------------------------------------------------
// Class view (`class_analytics_overview`)
// ---------------------------------------------------------------------------

/**
 * The allocation lifecycle fields every analytics row carries, so the UI can
 * derive the state with `allocationState()` — the product's single derivation of
 * it — instead of trusting a label baked in SQL.
 */
export interface AllocationWindow {
  published: boolean;
  available_from: string | null;
  available_until: string | null;
}

/** One assigned quiz's row in the class analytics view. */
export interface ClassOverviewQuiz extends AllocationWindow {
  quiz_id: string;
  title: string | null;
  content_updated_at: string | null;
  excluded_attempt_count: number;
  base_language: Language;
  /** Live (non-deleted) questions. */
  question_count: number;
  tutor_mode: TutorMode;
  /** `null` = unlimited attempts. */
  max_attempts: number | null;
  assigned_at: string;
  /** Current roster size — the completion denominator. */
  member_count: number;
  /**
   * CURRENT members with at least one completed attempt. Roster-based, so it
   * excludes anonymized/departed students and is the figure rendered as `12/28`.
   */
  members_completed: number;
  /** Students behind `average_score` (gradeable latest attempts, anonymized included). */
  students_completed: number;
  /** Mean of each student's latest completed attempt (0..1), or `null`. */
  average_score: number | null;
  tutor_question_count: number;
}

/** One day of completion activity in a class. */
export interface CompletionDay {
  /** `YYYY-MM-DD` (UTC). */
  day: string;
  count: number;
}

/** `class_analytics_overview(class_id)` result. */
export interface ClassAnalyticsOverview {
  class_id: string;
  name: string;
  language: Language;
  member_count: number;
  /** Assigned, non-deleted quizzes. */
  quiz_count: number;
  students_completed: number;
  average_score: number | null;
  tutor_question_count: number;
  /** Always 5 bands over every counted (student, quiz) result. */
  score_distribution: ScoreBucket[];
  /** Only days with activity, oldest first, over the recent window. */
  completions: CompletionDay[];
  quizzes: ClassOverviewQuiz[];
}

// ---------------------------------------------------------------------------
// Student view (`student_analytics`)
// ---------------------------------------------------------------------------

/** One (class, quiz) pair as it stands for one student. */
export interface StudentAnalyticsQuiz extends AllocationWindow {
  class_id: string;
  class_name: string;
  quiz_id: string;
  title: string | null;
  question_count: number;
  assigned_at: string;
  max_attempts: number | null;
  attempt_count: number;
  completed: boolean;
  last_completed_at: string | null;
  /** The student's LATEST completed attempt (0..1) — the grade they were shown. */
  latest_score: number | null;
  /** Their best completed attempt (0..1) — what the roster screens report. */
  best_score: number | null;
  /** The class's mean over every student's latest attempt (0..1), for comparison. */
  class_average_score: number | null;
  class_students_completed: number;
  tutor_question_count: number;
}

/** One of the caller's classes this student belongs to. */
export interface StudentAnalyticsClass {
  class_id: string;
  name: string;
  language: Language;
  member_count: number;
  /** Assigned, non-deleted quizzes in that class. */
  total_assigned: number;
  quizzes_completed: number;
  /** The student's mean latest score in that class (0..1). */
  average_score: number | null;
  /** The class's own mean latest score (0..1), for comparison. */
  class_average_score: number | null;
}

/** `student_analytics(student_id)` result. */
export interface StudentAnalytics {
  student_id: string;
  display_name: string | null;
  email: string | null;
  preferred_language: Language | null;
  /** Earliest join date across the caller's classes. */
  joined_at: string | null;
  summary: {
    class_count: number;
    total_assigned: number;
    quizzes_completed: number;
    /** The student's mean latest score across the caller's classes (0..1). */
    average_score: number | null;
    /** Everyone else's mean latest score in the same classes (0..1). */
    peer_average_score: number | null;
    tutor_question_count: number;
  };
  classes: StudentAnalyticsClass[];
  /** Ordered by when the student finished, unfinished last — the grade trend. */
  quizzes: StudentAnalyticsQuiz[];
}

// ---------------------------------------------------------------------------
// Quiz view (`quiz_analytics_overview`)
// ---------------------------------------------------------------------------

/** One class this quiz is assigned to, from the author's point of view. */
export interface QuizAnalyticsClass extends AllocationWindow {
  class_id: string;
  name: string;
  language: Language;
  teacher_id: string;
  teacher_name: string | null;
  /** False for a same-school colleague's class running this shared quiz. */
  is_own_class: boolean;
  member_count: number;
  assigned_at: string;
  max_attempts: number | null;
  tutor_mode: TutorMode;
  students_completed: number;
  attempt_count: number;
  average_score: number | null;
  tutor_question_count: number;
}

/** Per-question difficulty across every class running the quiz. */
export interface QuizAnalyticsQuestion {
  question_id: string;
  order_index: number;
  position_seconds: number;
  kind: QuestionKind;
  /** True when soft-deleted; still reported so history reads. */
  deleted: boolean;
  /** Base-language prompt (`null` if no translation row exists). */
  prompt: string | null;
  answered_count: number;
  correct_count: number;
  /** `correct_count / answered_count` (0..1), or `null` when never answered. */
  correct_pct: number | null;
  /** Tutor questions asked while this question was on screen. */
  tutor_question_count: number;
}

/** `quiz_analytics_overview(quiz_id)` result. */
export interface QuizAnalyticsOverview {
  quiz_id: string;
  title: string | null;
  content_updated_at: string | null;
  excluded_attempt_count: number;
  base_language: Language;
  visibility: "private" | "shared";
  created_at: string;
  video: {
    video_id: string;
    youtube_video_id: string;
    title: string | null;
    channel_name: string | null;
    duration_seconds: number | null;
  };
  summary: {
    question_count: number;
    /** How many classes the quiz is assigned to. */
    class_count: number;
    /** Combined roster of those classes. */
    member_count: number;
    students_completed: number;
    attempt_count: number;
    completion_count: number;
    average_score: number | null;
    tutor_question_count: number;
  };
  /** Always 5 bands over every counted attempt, across all classes. */
  score_distribution: ScoreBucket[];
  classes: QuizAnalyticsClass[];
  /** In question order; the "most often wrong" list sorts by `correct_pct`. */
  questions: QuizAnalyticsQuestion[];
}

// ---------------------------------------------------------------------------
// Tutor question log (`tutor_questions_page`, `tutor_prompts_in_scope`)
// ---------------------------------------------------------------------------

/** One logged tutor interaction, attributed for the owning teacher. */
export interface TutorQuestionRow {
  id: string;
  created_at: string;
  prompt: string;
  position_seconds: number | null;
  /** The on-screen question at ask time, if any. */
  question_id: string | null;
  /** That question's base-language prompt. */
  question_prompt: string | null;
  /** `question_id IS NOT NULL` — a likely answer-extraction attempt. */
  flagged: boolean;
  quiz_id: string;
  quiz_title: string | null;
  class_id: string;
  class_name: string;
  /** `null` when the student was anonymized. */
  student_id: string | null;
  student_name: string | null;
  student_email: string | null;
}

/** One entry in the log's quiz filter, with its row count in scope. */
export interface TutorQuestionQuizFilter {
  quiz_id: string;
  title: string | null;
  count: number;
}

/** One entry in the log's class filter, with its row count in scope. */
export interface TutorQuestionClassFilter {
  class_id: string;
  name: string;
  count: number;
}

/** `tutor_questions_page(...)` result — one page plus everything to filter it. */
export interface TutorQuestionsPage {
  total: number;
  /** Rows asked while a question was on screen, across the whole scope. */
  flagged_count: number;
  limit: number;
  offset: number;
  rows: TutorQuestionRow[];
  quiz_filters: TutorQuestionQuizFilter[];
  class_filters: TutorQuestionClassFilter[];
}

/** One row from `tutor_prompts_in_scope` — bare prompt text, no attribution. */
export interface TutorPromptRow {
  prompt: string;
  /** The on-screen question at ask time, if any. */
  question_id: string | null;
  created_at: string;
}

/** `tutor_prompts_in_scope(quiz_id | class_id)` result. */
export interface TutorPromptsResult {
  scope: "quiz" | "class";
  prompts: TutorPromptRow[];
}

/**
 * Search the caller's OWN entities within one scope — their classes, the
 * students in them, or the quizzes they authored. Paged, with the total
 * alongside the page. `invalid_args` for an unknown scope; `not_owner` for a
 * deactivated (or non-) teacher.
 */
export async function searchAnalyticsEntities(
  client: AnyClient,
  scope: AnalyticsScope,
  opts: { query?: string; limit?: number; offset?: number } = {}
): Promise<AnalyticsSearchResult> {
  return callRpc<AnalyticsSearchResult>(client, "teacher_analytics_search", {
    p_scope: scope,
    p_query: opts.query ?? null,
    p_limit: opts.limit ?? 10,
    p_offset: opts.offset ?? 0,
  });
}

/**
 * Everything the class analytics view renders in one read: header counts, the
 * per-quiz table (latest-attempt scored, so it agrees with
 * `class_quiz_analytics`), a class-wide score distribution and a
 * completions-per-day series. Caller must own the class, else `not_owner`.
 */
export async function getClassAnalyticsOverview(
  client: AnyClient,
  classId: string
): Promise<ClassAnalyticsOverview> {
  return callRpc<ClassAnalyticsOverview>(client, "class_analytics_overview", {
    p_class_id: classId,
  });
}

/**
 * One student ACROSS every class the caller owns — the view a per-class RPC
 * can't give. `not_owner` unless the caller is an active teacher with this
 * student in one of their classes.
 */
export async function getStudentAnalytics(
  client: AnyClient,
  studentId: string
): Promise<StudentAnalytics> {
  return callRpc<StudentAnalytics>(client, "student_analytics", {
    p_student_id: studentId,
  });
}

/**
 * One quiz across every class it runs in: which classes have it, how each did,
 * the pooled score distribution, and per-question difficulty. Author-scoped
 * (`not_owner` otherwise).
 */
export async function getQuizAnalyticsOverview(
  client: AnyClient,
  quizId: string
): Promise<QuizAnalyticsOverview> {
  return callRpc<QuizAnalyticsOverview>(client, "quiz_analytics_overview", {
    p_quiz_id: quizId,
  });
}

/**
 * A page of the tutor-question log. Every scope supplied must be one the caller
 * owns; at least one is required (`invalid_args` otherwise). The student scope is
 * additionally confined to the caller's own classes.
 */
export async function getTutorQuestionsPage(
  client: AnyClient,
  scope: { studentId?: string; quizId?: string; classId?: string },
  window: { limit?: number; offset?: number } = {}
): Promise<TutorQuestionsPage> {
  return callRpc<TutorQuestionsPage>(client, "tutor_questions_page", {
    p_student_id: scope.studentId ?? null,
    p_quiz_id: scope.quizId ?? null,
    p_class_id: scope.classId ?? null,
    p_limit: window.limit ?? 10,
    p_offset: window.offset ?? 0,
  });
}

/**
 * The raw tutor prompts in ONE scope (a quiz or a class), most recent first and
 * capped server-side — the bounded text corpus the AI summary reads. Distinct
 * from `getTutorQuestionsPage`, which is the attributed, paged log a human
 * reads. Owner-checked for the given scope.
 */
export async function fetchTutorPrompts(
  client: AnyClient,
  scope: { quizId: string } | { classId: string }
): Promise<TutorPromptsResult> {
  const args: Record<string, unknown> =
    "quizId" in scope
      ? { p_quiz_id: scope.quizId, p_class_id: null }
      : { p_quiz_id: null, p_class_id: scope.classId };
  return callRpc<TutorPromptsResult>(client, "tutor_prompts_in_scope", args);
}
