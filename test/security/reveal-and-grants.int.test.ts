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
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

function oneQuestion(explanation?: string) {
  return singleChoice({
    prompt: "שאלה",
    at: 10,
    explanation,
    correct: "נכון",
    distractors: ["לא"],
  });
}

async function studentCanReadTable(
  student: Student,
  table: string,
  columns: string
): Promise<boolean> {
  const { data } = await student.client.from(table).select(columns);
  return (data ?? []).length > 0;
}

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

  it("a student cannot read answers.was_correct or answer_selections directly", async () => {
    const quiz = await teacher.authorQuiz({ questions: [oneQuestion()] });
    const [onlyQuestion] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints", maxAttempts: null });
    await classroom.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: classroom });
    await attempt.answerCorrectly(onlyQuestion);

    expect(await studentCanReadTable(student, "answers", "was_correct")).toBe(false);
    expect(await studentCanReadTable(student, "answer_selections", "option_id")).toBe(false);
  });

  it("get_attempt_review reveals per-question detail only once attempts are exhausted (single-attempt)", async () => {
    const quiz = await teacher.authorQuiz({ questions: [oneQuestion("the-explanation")] });
    const [onlyQuestion] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints", maxAttempts: 1 });
    await classroom.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: classroom });

    const pre = await attempt.review();
    expect(pre.revealed).toBe(false);
    expect(pre.completed).toBe(false);

    await attempt.answerCorrectly(onlyQuestion);
    await attempt.complete();

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

  it("still returns the real prompt/options after the assignment is unpublished", async () => {
    // Regression: get_attempt_review used to be joined, client-side, against a
    // SECOND read (get_quiz_for_student) that requires the assignment to still
    // be live. Once a teacher unpublished (or the window closed) after the
    // student finished, that second read raised not_assigned, was swallowed,
    // and every question rendered as "removed" — nothing was actually deleted.
    const quiz = await teacher.authorQuiz({ questions: [oneQuestion("the-explanation")] });
    const [onlyQuestion] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints", maxAttempts: 1 });
    await classroom.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: classroom });
    await attempt.answerCorrectly(onlyQuestion);
    await attempt.complete();

    const before = await attempt.review();
    expect(before.revealed).toBe(true);

    await teacher.setQuizPublished(quiz, { in: classroom, published: false });

    const after = await attempt.review();
    expect(after.revealed).toBe(true);
    expect(after.questions).toHaveLength(1);
    const reviewed = after.questions![0];
    expect(reviewed.prompt).toBe("שאלה");
    expect(reviewed.options.map((o) => o.text).sort()).toEqual(["לא", "נכון"]);
    expect(reviewed.correct_option_ids).toEqual(onlyQuestion.correctIds);
  });

  it("unlimited attempts NEVER reveal per-question detail — score only", async () => {
    const quiz = await teacher.authorQuiz({ questions: [oneQuestion()] });
    const [onlyQuestion] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints", maxAttempts: null });
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
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints", maxAttempts: 2 });
    await classroom.enroll(student);

    const firstAttempt = await student.startAttempt(quiz, { in: classroom });
    await firstAttempt.answer(onlyQuestion, onlyQuestion.distractorIds);
    await firstAttempt.complete();
    const midReview = await firstAttempt.review();
    expect(midReview.revealed).toBe(false);
    expect(midReview.completed).toBe(true);
    expect(midReview.questions).toBeUndefined();

    const lastAttempt = await student.startAttempt(quiz, { in: classroom });
    await lastAttempt.answerCorrectly(onlyQuestion);
    await lastAttempt.complete();
    const lastReview = await lastAttempt.review();
    expect(lastReview.revealed).toBe(true);
    expect(lastReview.questions).toHaveLength(1);
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

    await expect(reviewAttemptAs(teacher, attempt)).rejects.toMatchObject({
      code: "not_your_attempt",
    });
  });

  it("a deactivated teacher cannot self-reactivate (write deactivated_at)", async () => {
    // Deactivate at the DB level (not via the ban path) so the teacher's still-valid
    // GoTrue session models a token issued before deactivation.
    await getPool().query(
      "UPDATE public.profiles SET deactivated_at = now() WHERE id=$1",
      [teacher.id]
    );

    const selfReactivation = await teacher.client
      .from("profiles")
      .update({ deactivated_at: null })
      .eq("id", teacher.id)
      .select("id");

    expect(selfReactivation.error).not.toBeNull();

    const stored = await getPool().query<{ deactivated_at: string | null }>(
      "SELECT deactivated_at FROM public.profiles WHERE id=$1",
      [teacher.id]
    );
    expect(stored.rows[0].deactivated_at).not.toBeNull();
  });

  it("the quiz owner cannot hard-DELETE a quiz", async () => {
    const quiz = await teacher.authorQuiz({ questions: [oneQuestion()] });

    const deletion = await teacher.client
      .from("quizzes")
      .delete()
      .eq("id", quiz.id)
      .select("id");
    expect(deletion.error).not.toBeNull();

    expect(await testbed.db.quizRow(quiz)).not.toBeNull();
  });

  it("the anon role cannot EXECUTE the student-facing RPCs", async () => {
    const anon = createAnonClient() as unknown as SupabaseClient;
    const anyId = classroom.id;
    const securityDefinerRpcs: [string, Record<string, unknown>][] = [
      ["get_quiz_for_student", { p_class_id: anyId, p_quiz_id: anyId }],
      ["start_or_resume_attempt", { p_class_id: anyId, p_quiz_id: anyId }],
      ["submit_answer", { p_attempt_id: anyId, p_question_id: anyId, p_option_ids: [] }],
      ["complete_attempt", { p_attempt_id: anyId }],
      ["get_tutor_mode", { p_class_id: anyId, p_quiz_id: anyId }],
      ["list_shared_quizzes", {}],
      ["get_quiz_for_preview", { p_quiz_id: anyId }],
      ["list_my_quizzes", {}],
      ["list_student_feed", {}],
      ["class_quiz_analytics", { p_class_id: anyId, p_quiz_id: anyId }],
    ];
    for (const [rpcName, args] of securityDefinerRpcs) {
      const { error } = await anon.rpc(rpcName, args);
      expect(error, `anon should not execute ${rpcName}`).not.toBeNull();
      expect(error?.code, `anon's ${rpcName} rejection should be a grant denial`).toBe(
        "42501"
      );
    }
  });
});
