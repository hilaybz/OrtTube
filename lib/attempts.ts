import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Content language (mirrors `@/lib/lang`'s `Language`; declared locally so this
 * module type-checks in isolation before the shared foundation is merged at the
 * gate). Structurally identical, so no collision when the branches combine.
 */
export type Language = "he" | "ar" | "en";

/**
 * Attempts service layer. Thin, typed TypeScript wrappers over
 * the server-authoritative SECURITY DEFINER RPCs:
 *
 *   get_quiz_for_student   → the ONLY student-facing quiz read (answer-free)
 *   start_or_resume_attempt→ start a new run or resume an incomplete one
 *   submit_answer          → server-side grading + was_correct snapshot
 *   complete_attempt       → finalize + score summary
 *
 * Clients are typed as the un-parameterised `SupabaseClient` on purpose (same
 * convention as lib/classes.ts / lib/quiz.ts): these functions compile
 * independently of `lib/supabase/types.ts` being regenerated for the RPCs this
 * task adds (the gate regenerates those types).
 *
 * All calls run through the caller's AUTHENTICATED (RLS-subject) client so
 * `auth.uid()` inside each SECURITY DEFINER RPC resolves to the signed-in
 * student. No answer key (`is_correct`) or per-question correctness ever crosses
 * this boundary — grading is server-side and only aggregate scores come back.
 */

/** Stable error thrown when an RPC raises one of its documented codes. */
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

// ── Answer-free quiz read ─────────────────────────────────────────────────────

/** A single option as shown to a student — never carries `is_correct`. */
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
  /** The language the text was resolved to (preferred → class → base). */
  resolved_language: Language;
  /** false → some rows fell back to base because the resolved language is missing. */
  served_complete: boolean;
  questions: StudentQuestion[];
}

/**
 * Optional best-effort hook fired when the resolved language was incomplete, so a
 * caller can enqueue `ensureTranslation` to fill it for next time. Injected
 * (not statically imported) so this module compiles without the translation lib present.
 * Any failure here is swallowed — the read already fell back to base.
 */
export type EnqueueTranslationFn = (
  quizId: string,
  resolvedLanguage: Language
) => void | Promise<void>;

/**
 * Fetch the answer-free quiz for the signed-in student in a class. Verifies
 * membership + assignment server-side and resolves text to the student's
 * language, falling back to base per-row. When `served_complete` is false and an
 * `onIncompleteTranslation` hook is supplied, it is invoked best-effort.
 */
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
      // best-effort: a translation enqueue failure must not fail the read.
    }
  }
  return quiz;
}

// ── Start / resume ────────────────────────────────────────────────────────────

export interface StartAttemptResult {
  attempt_id: string;
  attempt_no: number;
  /** true → an existing incomplete attempt was resumed. */
  resumed: boolean;
  started_at: string;
  /** Questions already answered in this attempt (ids only — never correctness). */
  answered_question_ids: string[];
}

/**
 * Start a new attempt or resume the newest incomplete one for (student, class,
 * quiz). Enforces `max_attempts` (completed attempts only) and snapshots the live
 * question set at start. Raises `no_attempts_left` when exhausted.
 */
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

// ── Submit ────────────────────────────────────────────────────────────────────

export interface SubmitAnswerResult {
  attempt_id: string;
  question_id: string;
  recorded: boolean;
}

/**
 * Submit the chosen option(s) for a question in an attempt. Grading is
 * server-side; the result is recorded with a `was_correct` snapshot and is NOT
 * returned to the client. Raises `already_answered` on a repeat submission.
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
  return data as unknown as SubmitAnswerResult;
}

// ── Complete ──────────────────────────────────────────────────────────────────

export interface AttemptSummary {
  attempt_id: string;
  attempt_no: number;
  completed_at: string;
  num_questions: number;
  num_correct: number;
}

/**
 * Finalize an attempt: stamps completion and returns the aggregate score
 * (num_correct / num_questions) derived from the answer + question snapshots.
 * Idempotent — a repeat call returns the stored summary unchanged.
 */
export async function completeAttempt(
  client: SupabaseClient,
  attemptId: string
): Promise<AttemptSummary> {
  const data = unwrap(
    await client.rpc("complete_attempt", { p_attempt_id: attemptId })
  );
  return data as unknown as AttemptSummary;
}

// ── Reveal-gated review ─────────────────────────────────────────────────────────

/** Per-question review detail — present only when the review is revealed. */
export interface AttemptReviewQuestion {
  question_id: string;
  was_correct: boolean | null;
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

/**
 * Fetch the reveal-gated review for one of the caller's own attempts. Per-question
 * correctness / correct options / explanations are returned ONLY when the student
 * has no attempts left (finite max_attempts fully used); otherwise only the
 * aggregate score is exposed. Never leaks the answer key while retakes remain.
 */
export async function getAttemptReview(
  client: SupabaseClient,
  attemptId: string
): Promise<AttemptReview> {
  const data = unwrap(
    await client.rpc("get_attempt_review", { p_attempt_id: attemptId })
  );
  return data as unknown as AttemptReview;
}
