/**
 * Security integration tests — answer-leak / reveal gate / privilege hardening.
 *
 * Every action runs through an actor's AUTHENTICATED (RLS-subject) client via the
 * actor DSL (`test/helpers/testbed`), so every grant / RLS / RPC check is real.
 * Covers: students cannot read answers.was_correct / answer_selections directly;
 * get_attempt_review enforces the reveal gate; a deactivated teacher cannot
 * self-reactivate; the quiz owner cannot hard-DELETE a quiz; and the anon role
 * cannot EXECUTE the SECURITY DEFINER RPCs.
 *
 * Skipped when the local DB is unreachable so unit suites still pass offline.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPool, closePool, createAnonClient } from "../helpers/db";
import {
  freshTestbed,
  singleChoice,
  type Testbed,
  type School,
  type Teacher,
  type Student,
  type Classroom,
  type Attempt,
} from "../helpers/testbed";
import { getAttemptReview } from "@/lib/attempts";

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
const online = await dbReachable();

/** One single-choice question with a base-language prompt + explanation. */
function oneQuestion(explanation?: string) {
  return singleChoice({
    prompt: "שאלה",
    at: 10,
    explanation,
    correct: "נכון",
    distractors: ["לא"],
  });
}

/**
 * Whether the student's own RLS-subject client can directly read any row from a
 * table it has no grant on (an answer-leak probe — a denial surfaces as zero rows).
 */
async function studentCanReadTable(
  student: Student,
  table: string,
  columns: string
): Promise<boolean> {
  const { data } = await student.client.from(table).select(columns);
  return (data ?? []).length > 0;
}

/** Fetch an attempt's review AS a given actor — used to exercise the ownership guard. */
function reviewAttemptAs(actor: Teacher | Student, attempt: Attempt) {
  return getAttemptReview(actor.client, attempt.id);
}

describe.skipIf(!online)("security — answer leak, reveal gate, privileges", () => {
  let testbed: Testbed;
  let school: School;
  let teacher: Teacher;
  let student: Student;
  let classroom: Classroom;

  beforeEach(async () => {
    testbed = await freshTestbed();
    school = await testbed.createSchool("Lincoln High");
    teacher = await school.enrollTeacher({ name: "Ada" });
    student = await school.enrollStudent({ name: "Ben" });
    classroom = await teacher.openClass({ name: "Biology", language: "he" });
  });

  afterAll(async () => {
    await closePool();
  });

  // ── Direct answer-key reads are denied ──
  it("a student cannot read answers.was_correct or answer_selections directly", async () => {
    const quiz = await teacher.authorQuiz({ questions: [oneQuestion()] });
    const [onlyQuestion] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints", maxAttempts: null });
    await classroom.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: classroom });
    await attempt.answerCorrectly(onlyQuestion);

    // Direct selects must be denied (no table grant) → the student sees no rows.
    expect(await studentCanReadTable(student, "answers", "was_correct")).toBe(false);
    expect(await studentCanReadTable(student, "answer_selections", "option_id")).toBe(false);
  });

  // ── Reveal gate — per-question detail only once attempts are exhausted ──
  it("get_attempt_review reveals per-question detail only once attempts are exhausted (single-attempt)", async () => {
    const quiz = await teacher.authorQuiz({ questions: [oneQuestion("the-explanation")] });
    const [onlyQuestion] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints", maxAttempts: 1 }); // single attempt → reveals on finish
    await classroom.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: classroom });

    // Before completion → nothing revealed, not even a score.
    const pre = await attempt.review();
    expect(pre.revealed).toBe(false);
    expect(pre.completed).toBe(false);

    await attempt.answerCorrectly(onlyQuestion);
    await attempt.complete();

    // Attempts exhausted (1 of 1) → full per-question review.
    const review = await attempt.review();
    expect(review.revealed).toBe(true);
    expect(review.num_correct).toBe(1);
    expect(review.num_questions).toBe(1);
    expect(review.questions).toHaveLength(1);
    const reviewed = review.questions![0];
    expect(reviewed.question_id).toBe(onlyQuestion.id);
    expect(reviewed.was_correct).toBe(true);
    expect(reviewed.explanation).toBe("the-explanation");
    expect(reviewed.correct_option_ids).toEqual(onlyQuestion.correctIds);
    expect(reviewed.selected_option_ids).toEqual(onlyQuestion.correctIds);
  });

  it("unlimited attempts NEVER reveal per-question detail — score only", async () => {
    const quiz = await teacher.authorQuiz({ questions: [oneQuestion()] });
    const [onlyQuestion] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints", maxAttempts: null }); // unlimited
    await classroom.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: classroom });
    await attempt.answer(onlyQuestion, onlyQuestion.distractorIds);
    await attempt.complete();

    const review = await attempt.review();
    expect(review.revealed).toBe(false);
    expect(review.completed).toBe(true);
    expect(review.num_correct).toBe(0);
    expect(review.num_questions).toBe(1);
    expect(review.questions).toBeUndefined();
  });

  it("multi-attempt reveals only after the LAST allowed attempt", async () => {
    const quiz = await teacher.authorQuiz({ questions: [oneQuestion()] });
    const [onlyQuestion] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints", maxAttempts: 2 }); // two attempts
    await classroom.enroll(student);

    // Attempt 1 → completed, but one attempt remains → score only.
    const firstAttempt = await student.startAttempt(quiz, { in: classroom });
    await firstAttempt.answer(onlyQuestion, onlyQuestion.distractorIds);
    await firstAttempt.complete();
    const midReview = await firstAttempt.review();
    expect(midReview.revealed).toBe(false);
    expect(midReview.completed).toBe(true);
    expect(midReview.questions).toBeUndefined();

    // Attempt 2 → the last one → both attempts now reveal.
    const lastAttempt = await student.startAttempt(quiz, { in: classroom });
    await lastAttempt.answerCorrectly(onlyQuestion);
    await lastAttempt.complete();
    const lastReview = await lastAttempt.review();
    expect(lastReview.revealed).toBe(true);
    expect(lastReview.questions).toHaveLength(1);
    // The earlier attempt is now revealable too (no attempts remain).
    const firstReviewAgain = await firstAttempt.review();
    expect(firstReviewAgain.revealed).toBe(true);
  });

  it("get_attempt_review rejects another student's attempt", async () => {
    const quiz = await teacher.authorQuiz({ questions: [oneQuestion()] });
    const [onlyQuestion] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints", maxAttempts: 1 });
    await classroom.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: classroom });
    await attempt.answerCorrectly(onlyQuestion);
    await attempt.complete();

    // The teacher (different auth.uid) may not review the student's attempt.
    await expect(reviewAttemptAs(teacher, attempt)).rejects.toMatchObject({
      code: "not_your_attempt",
    });
  });

  // ── A deactivated teacher cannot self-reactivate ──
  it("a deactivated teacher cannot self-reactivate (write deactivated_at)", async () => {
    // Deactivate at the DB level (not via the ban path) so the teacher's still-valid
    // GoTrue session models a token issued before deactivation.
    await getPool().query(
      "UPDATE public.profiles SET deactivated_at = now() WHERE id=$1",
      [teacher.id]
    );

    // Token still valid: the teacher tries to clear their own deactivation.
    const selfReactivation = await teacher.client
      .from("profiles")
      .update({ deactivated_at: null })
      .eq("id", teacher.id)
      .select("id");

    // The column REVOKE (012) + immutability trigger (014) reject the write.
    expect(selfReactivation.error).not.toBeNull();

    // And the DB value is unchanged — the teacher stays deactivated.
    const stored = await getPool().query<{ deactivated_at: string | null }>(
      "SELECT deactivated_at FROM public.profiles WHERE id=$1",
      [teacher.id]
    );
    expect(stored.rows[0].deactivated_at).not.toBeNull();
  });

  // ── A quiz owner cannot hard-DELETE a quiz ──
  it("the quiz owner cannot hard-DELETE a quiz", async () => {
    const quiz = await teacher.authorQuiz({ questions: [oneQuestion()] });

    const deletion = await teacher.client
      .from("quizzes")
      .delete()
      .eq("id", quiz.id)
      .select("id");
    expect(deletion.error).not.toBeNull();

    // The quiz (and its cascade of content) survives.
    expect(await testbed.db.quizRow(quiz)).not.toBeNull();
  });

  // ── The anon role cannot EXECUTE the SECURITY DEFINER RPCs ──
  it("the anon role cannot EXECUTE the student-facing RPCs", async () => {
    const anon = createAnonClient() as unknown as SupabaseClient;
    // Placeholder id — the point is the EXECUTE grant is denied before any lookup.
    const anyId = classroom.id;
    const securityDefinerRpcs: [string, Record<string, unknown>][] = [
      ["get_quiz_for_student", { p_class_id: anyId, p_quiz_id: anyId }],
      ["start_or_resume_attempt", { p_class_id: anyId, p_quiz_id: anyId }],
      ["submit_answer", { p_attempt_id: anyId, p_question_id: anyId, p_option_ids: [] }],
      ["complete_attempt", { p_attempt_id: anyId }],
      ["get_tutor_mode", { p_class_id: anyId, p_quiz_id: anyId }],
      ["list_shared_quizzes", {}],
      ["list_my_quizzes", {}],
      ["list_assigned_for_student", {}],
    ];
    for (const [rpcName, args] of securityDefinerRpcs) {
      const { error } = await anon.rpc(rpcName, args);
      expect(error, `anon should not execute ${rpcName}`).not.toBeNull();
    }
  });
});
