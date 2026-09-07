/**
 * Where two readers can answer the same question they share one scoring basis:
 * each student's LATEST completed attempt, the grade that student is shown
 * themselves. `class_stats` (attempt-pooled) is the exception, kept for
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
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type Language = "he" | "ar" | "en";

export type QuestionKind = "single" | "multi";

export type TutorMode = "off" | "hints" | "full";

export class AnalyticsError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "AnalyticsError";
    this.code = code;
  }
}

export interface QuizStats {
  quiz_id: string;
  content_updated_at: string | null;
  excluded_attempt_count: number;
  attempt_count: number;
  completion_count: number;
  average_score: number | null;
}

export interface QuestionOptionStat {
  option_id: string;
  is_correct: boolean;
  deleted: boolean;
  order_index: number;
  text: string | null;
  selection_count: number;
}

export interface QuestionStat {
  question_id: string;
  kind: QuestionKind;
  order_index: number;
  deleted: boolean;
  position_seconds: number;
  prompt: string | null;
  total_answers: number;
  correct_count: number;
  correct_pct: number | null;
  options: QuestionOptionStat[];
}

export interface QuestionStatsResult {
  quiz_id: string;
  base_language: Language | null;
  questions: QuestionStat[];
}

export interface ClassQuizStat {
  quiz_id: string;
  title: string | null;
  deleted: boolean;
  content_updated_at: string | null;
  excluded_attempt_count: number;
  tutor_mode: TutorMode;
  max_attempts: number | null;
  attempt_count: number;
  completion_count: number;
  average_score: number | null;
  /**
   * Roster-based coverage: distinct CURRENT class members who have a completed
   * attempt. This necessarily EXCLUDES anonymized/departed students, so it is
   * reported separately from `completion_count` and must not be conflated with
   * it. Read as "`members_completed` of `current_member_count`".
   */
  members_completed: number;
  current_member_count: number;
}

export interface ClassStats {
  class_id: string;
  current_member_count: number;
  quizzes: ClassQuizStat[];
}

export interface ScoreBucket {
  bucket_min: number;
  bucket_max: number;
  count: number;
}

export interface ClassQuizOptionStat {
  option_id: string;
  order_index: number;
  text: string | null;
  is_correct: boolean;
  deleted: boolean;
  selection_count: number;
}

export interface ClassQuizQuestionStat {
  question_id: string;
  order_index: number;
  position_seconds: number;
  kind: QuestionKind;
  deleted: boolean;
  prompt: string | null;
  answered_count: number;
  correct_count: number;
  correct_pct: number | null;
  options: ClassQuizOptionStat[];
}

export interface ClassQuizAnalytics {
  class_id: string;
  quiz_id: string;
  title: string | null;
  content_updated_at: string | null;
  excluded_attempt_count: number;
  question_count: number;
  member_count: number;
  students_completed: number;
  attempt_count: number;
  completion_count: number;
  average_score: number | null;
  score_distribution: ScoreBucket[];
  questions: ClassQuizQuestionStat[];
}

export interface TutorExtractionAttempt {
  id: string;
  student_id: string | null;
  quiz_id: string;
  class_id: string;
  question_id: string | null;
  attempt_id: string | null;
  position_seconds: number | null;
  prompt: string;
  created_at: string;
}

export interface TutorStats {
  scope: "quiz" | "class";
  total_questions: number;
  distinct_students: number;
  anonymized_count: number;
  answer_extraction_count: number;
  answer_extraction_attempts: TutorExtractionAttempt[];
}

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

export async function getQuizStats(
  client: AnyClient,
  quizId: string
): Promise<QuizStats> {
  return callRpc<QuizStats>(client, "quiz_stats", { p_quiz_id: quizId });
}

export async function getQuestionStats(
  client: AnyClient,
  quizId: string
): Promise<QuestionStatsResult> {
  return callRpc<QuestionStatsResult>(client, "question_stats", {
    p_quiz_id: quizId,
  });
}

export async function getClassStats(
  client: AnyClient,
  classId: string
): Promise<ClassStats> {
  return callRpc<ClassStats>(client, "class_stats", { p_class_id: classId });
}

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

export type AnalyticsScope = "student" | "class" | "quiz";

export interface AnalyticsSearchHit {
  id: string;
  name: string | null;
  email?: string;
  class_count?: number;
  class_names?: string | null;
  language?: Language;
  member_count?: number;
  quiz_count?: number;
  video_title?: string | null;
  visibility?: "private" | "shared";
  base_language?: Language;
  question_count?: number;
}

export interface AnalyticsSearchResult {
  scope: AnalyticsScope;
  query: string;
  limit: number;
  offset: number;
  total: number;
  results: AnalyticsSearchHit[];
}

export interface AllocationWindow {
  published: boolean;
  available_from: string | null;
  available_until: string | null;
}

export interface ClassOverviewQuiz extends AllocationWindow {
  quiz_id: string;
  title: string | null;
  content_updated_at: string | null;
  excluded_attempt_count: number;
  base_language: Language;
  question_count: number;
  tutor_mode: TutorMode;
  max_attempts: number | null;
  assigned_at: string;
  member_count: number;
  members_completed: number;
  students_completed: number;
  average_score: number | null;
  tutor_question_count: number;
}

export interface CompletionDay {
  day: string;
  count: number;
}

export interface ClassAnalyticsOverview {
  class_id: string;
  name: string;
  language: Language;
  member_count: number;
  quiz_count: number;
  students_completed: number;
  average_score: number | null;
  tutor_question_count: number;
  score_distribution: ScoreBucket[];
  completions: CompletionDay[];
  quizzes: ClassOverviewQuiz[];
}

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
  latest_score: number | null;
  best_score: number | null;
  class_average_score: number | null;
  class_students_completed: number;
  tutor_question_count: number;
}

export interface StudentAnalyticsClass {
  class_id: string;
  name: string;
  language: Language;
  member_count: number;
  total_assigned: number;
  quizzes_completed: number;
  average_score: number | null;
  class_average_score: number | null;
}

export interface StudentAnalytics {
  student_id: string;
  display_name: string | null;
  email: string | null;
  preferred_language: Language | null;
  joined_at: string | null;
  summary: {
    class_count: number;
    total_assigned: number;
    quizzes_completed: number;
    average_score: number | null;
    peer_average_score: number | null;
    tutor_question_count: number;
  };
  classes: StudentAnalyticsClass[];
  quizzes: StudentAnalyticsQuiz[];
}

export interface QuizAnalyticsClass extends AllocationWindow {
  class_id: string;
  name: string;
  language: Language;
  teacher_id: string;
  teacher_name: string | null;
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

export interface QuizAnalyticsQuestion {
  question_id: string;
  order_index: number;
  position_seconds: number;
  kind: QuestionKind;
  deleted: boolean;
  prompt: string | null;
  answered_count: number;
  correct_count: number;
  correct_pct: number | null;
  tutor_question_count: number;
}

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
    class_count: number;
    member_count: number;
    students_completed: number;
    attempt_count: number;
    completion_count: number;
    average_score: number | null;
    tutor_question_count: number;
  };
  score_distribution: ScoreBucket[];
  classes: QuizAnalyticsClass[];
  questions: QuizAnalyticsQuestion[];
}

export interface TutorQuestionRow {
  id: string;
  created_at: string;
  prompt: string;
  position_seconds: number | null;
  question_id: string | null;
  question_prompt: string | null;
  flagged: boolean;
  quiz_id: string;
  quiz_title: string | null;
  class_id: string;
  class_name: string;
  student_id: string | null;
  student_name: string | null;
  student_email: string | null;
}

export interface TutorQuestionQuizFilter {
  quiz_id: string;
  title: string | null;
  count: number;
}

export interface TutorQuestionClassFilter {
  class_id: string;
  name: string;
  count: number;
}

export interface TutorQuestionsPage {
  total: number;
  flagged_count: number;
  limit: number;
  offset: number;
  rows: TutorQuestionRow[];
  quiz_filters: TutorQuestionQuizFilter[];
  class_filters: TutorQuestionClassFilter[];
}

export interface TutorPromptRow {
  prompt: string;
  question_id: string | null;
  created_at: string;
}

export interface TutorPromptsResult {
  scope: "quiz" | "class";
  prompts: TutorPromptRow[];
}

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

export async function getClassAnalyticsOverview(
  client: AnyClient,
  classId: string
): Promise<ClassAnalyticsOverview> {
  return callRpc<ClassAnalyticsOverview>(client, "class_analytics_overview", {
    p_class_id: classId,
  });
}

export async function getStudentAnalytics(
  client: AnyClient,
  studentId: string
): Promise<StudentAnalytics> {
  return callRpc<StudentAnalytics>(client, "student_analytics", {
    p_student_id: studentId,
  });
}

export async function getQuizAnalyticsOverview(
  client: AnyClient,
  quizId: string
): Promise<QuizAnalyticsOverview> {
  return callRpc<QuizAnalyticsOverview>(client, "quiz_analytics_overview", {
    p_quiz_id: quizId,
  });
}

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
