import type { SupabaseClient } from "@supabase/supabase-js";

export type Language = "he" | "ar" | "en";

/**
 * All calls run through the caller's AUTHENTICATED (RLS-subject) client so
 * `auth.uid()` inside each SECURITY DEFINER RPC resolves to the signed-in
 * student. No answer key (`is_correct`) or per-question correctness ever crosses
 * this boundary — grading is server-side and only aggregate scores come back.
 */

export class AttemptError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "AttemptError";
    this.code = code;
  }
}

function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new AttemptError(res.error.message);
  return res.data;
}

export interface StudentOption {
  id: string;
  order_index: number;
  text: string;
}

/**
 * A single question as shown to a student — structural fields + resolved text.
 * Deliberately carries NO `explanation`: an explanation can reveal the answer, so
 * it is delivered only via `getAttemptReview` once the reveal rule is satisfied.
 */
export interface StudentQuestion {
  id: string;
  kind: "single" | "multi";
  position_seconds: number;
  order_index: number;
  prompt: string;
  options: StudentOption[];
}

export interface StudentQuiz {
  quiz_id: string;
  class_id: string;
  title: string | null;
  base_language: Language;
  resolved_language: Language;
  served_complete: boolean;
  questions: StudentQuestion[];
}

export type EnqueueTranslationFn = (
  quizId: string,
  resolvedLanguage: Language
) => void | Promise<void>;

export async function getQuizForStudent(
  client: SupabaseClient,
  classId: string,
  quizId: string,
  opts?: { onIncompleteTranslation?: EnqueueTranslationFn }
): Promise<StudentQuiz> {
  const data = unwrap(
    await client.rpc("get_quiz_for_student", {
      p_class_id: classId,
      p_quiz_id: quizId,
    })
  );
  const quiz = data as unknown as StudentQuiz;

  if (quiz && quiz.served_complete === false && opts?.onIncompleteTranslation) {
    try {
      await opts.onIncompleteTranslation(quiz.quiz_id, quiz.resolved_language);
    } catch {
    }
  }
  return quiz;
}

export interface StartAttemptResult {
  attempt_id: string;
  attempt_no: number;
  resumed: boolean;
  started_at: string;
  answered_question_ids: string[];
}

export async function startOrResumeAttempt(
  client: SupabaseClient,
  classId: string,
  quizId: string
): Promise<StartAttemptResult> {
  const data = unwrap(
    await client.rpc("start_or_resume_attempt", {
      p_class_id: classId,
      p_quiz_id: quizId,
    })
  );
  const result = data as unknown as StartAttemptResult;
  return { ...result, answered_question_ids: result.answered_question_ids ?? [] };
}

export interface SubmitAnswerResult {
  attempt_id: string;
  question_id: string;
  recorded: boolean;
  window_closed: boolean;
}

/**
 *
 * If the allocation's scheduling window has already closed, the RPC finalizes
 * the attempt right there (a hard cutoff) and returns `{ recorded: false, window_closed: true }` instead of raising —
 * a raised exception would roll back that finalizing write. This wrapper turns
 * that flag into a thrown `AttemptError("window_closed")` so callers keep
 * handling it the same way as any other stable error code.
 */
export async function submitAnswer(
  client: SupabaseClient,
  attemptId: string,
  questionId: string,
  optionIds: string[]
): Promise<SubmitAnswerResult> {
  const data = unwrap(
    await client.rpc("submit_answer", {
      p_attempt_id: attemptId,
      p_question_id: questionId,
      p_option_ids: optionIds,
    })
  );
  const result = data as unknown as SubmitAnswerResult;
  if (result.window_closed) {
    throw new AttemptError("window_closed");
  }
  return result;
}

export interface AttemptSummary {
  attempt_id: string;
  attempt_no: number;
  completed_at: string;
  num_questions: number;
  num_correct: number;
}

export async function completeAttempt(
  client: SupabaseClient,
  attemptId: string
): Promise<AttemptSummary> {
  const data = unwrap(
    await client.rpc("complete_attempt", { p_attempt_id: attemptId })
  );
  return data as unknown as AttemptSummary;
}

export interface AttemptReviewOption {
  id: string;
  order_index: number;
  text: string;
}

/**
 * Per-question review detail — present only when the review is revealed.
 * `prompt`/`options` are read off the attempt's frozen `attempt_questions`
 * snapshot, independent of whether the class<->quiz assignment is still live —
 * a closed window or later unassignment must not blank out a finished review.
 */
export interface AttemptReviewQuestion {
  question_id: string;
  was_correct: boolean | null;
  prompt: string;
  options: AttemptReviewOption[];
  correct_option_ids: string[];
  explanation: string | null;
  selected_option_ids: string[];
}

/**
 * Result of `get_attempt_review`. The reveal gate governs the shape:
 *   • not completed          → { revealed:false, completed:false }
 *   • completed, attempts left / unlimited → score only (no `questions`)
 *   • completed AND exhausted → { revealed:true, ..., questions:[...] }
 * `num_correct`/`num_questions` are present whenever the attempt is completed.
 */
export interface AttemptReview {
  revealed: boolean;
  completed: boolean;
  num_correct?: number;
  num_questions?: number;
  questions?: AttemptReviewQuestion[];
}

export async function getAttemptReview(
  client: SupabaseClient,
  attemptId: string
): Promise<AttemptReview> {
  const data = unwrap(
    await client.rpc("get_attempt_review", { p_attempt_id: attemptId })
  );
  return data as unknown as AttemptReview;
}

/**
 * Everything the student UI needs for one (class, quiz) that the other reads
 * don't expose: the player's delivery context (video/tutor_mode/max_attempts),
 * the feed's attempt state, the resume target, and — crucially — the newest
 * completed attempt id so the reveal-gated review survives a revisit/refresh
 * (`start_or_resume_attempt` can't supply it once attempts are exhausted).
 * Never carries per-question correctness; reveal stays enforced by
 * `getAttemptReview`.
 */
export interface StudentAttemptState {
  class_id: string;
  quiz_id: string;
  youtube_video_id: string;
  video_title: string | null;
  duration_seconds: number | null;
  base_language: Language;
  tutor_mode: "off" | "hints" | "full";
  max_attempts: number | null;
  /**
   * The allocation's close time and the server's clock at read time — null
   * when the allocation has no end bound. The player derives a clock-skew-
   * proof deadline timer from the two: `Date.now() + (server_now - client_now)`
   * gives the offset, applied to `available_until`, rather than trusting the
   * device clock directly.
   */
  available_until: string | null;
  server_now: string;
  attempt_count: number;
  completed_count: number;
  attempts_left: number | null;
  in_progress: boolean;
  resume_attempt_id: string | null;
  last_completed_attempt_id: string | null;
  last_num_correct: number | null;
  last_num_questions: number | null;
}

export async function listMyAttemptsForQuiz(
  client: SupabaseClient,
  classId: string,
  quizId: string
): Promise<StudentAttemptState> {
  const data = unwrap(
    await client.rpc("list_my_attempts_for_quiz", {
      p_class_id: classId,
      p_quiz_id: quizId,
    })
  );
  return data as unknown as StudentAttemptState;
}

/**
 * The newest completed attempt for (student, class, quiz), read directly off
 * `attempts` under RLS (`attempts_student_select`: `student_id = auth.uid()`)
 * rather than through any `class_quizzes`-gated RPC. Deliberately independent
 * of whether the allocation is currently published/live/unassigned: a closed
 * window does not unassign, and a student must always be able to see their own
 * past results even once the window that produced them has closed.
 * `list_my_attempts_for_quiz` and
 * `get_quiz_for_student`, by contrast, correctly gate on liveness because they
 * hand back *playable* content, not history — this is the fallback both the
 * player and results pages use when those raise `not_assigned` for that
 * reason, so a closed window still lands the student on their score rather
 * than a dead end.
 */
export async function findLatestCompletedAttempt(
  client: SupabaseClient,
  classId: string,
  quizId: string
): Promise<{ id: string; num_correct: number | null; num_questions: number | null } | null> {
  const { data, error } = await client
    .from("attempts")
    .select("id, num_correct, num_questions")
    .eq("class_id", classId)
    .eq("quiz_id", quizId)
    .not("completed_at", "is", null)
    .order("attempt_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new AttemptError(error.message);
  return (data as { id: string; num_correct: number | null; num_questions: number | null } | null) ?? null;
}
