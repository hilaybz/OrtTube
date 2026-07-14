/**
 * Attempts integration tests — server-authoritative attempts & grading (spec §3.5).
 *
 * Written as a story through the actor DSL (`test/helpers/testbed`): a teacher
 * authors a quiz with a real answer key, assigns it to a class, and a student
 * starts/answers/completes attempts — every action running through that actor's
 * AUTHENTICATED (RLS-subject) client so each RPC's `auth.uid()` member/owner check
 * is real. Out-of-band `testbed.db` reads assert on state the student API never
 * exposes (the `was_correct` snapshot, the frozen question snapshot).
 *
 * Covers the attempts acceptance list: the read RPC never returns is_correct;
 * non-members are denied; resolved language + per-row fallback to base; start
 * snapshots the live question set; abandoned attempts resume; max_attempts counts
 * only completed attempts; single grading; multi exact-set grading;
 * already_answered; editing the quiz mid-attempt does not change num_questions;
 * scores come from was_correct snapshots.
 *
 * Runs at the integration/gate step (owns DB application). Skipped when the local
 * DB is unreachable so unit suites still pass without Supabase running.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPool, closePool } from "../helpers/db";
import {
  freshTestbed,
  singleChoice,
  multiChoice,
  type Testbed,
  type School,
  type Teacher,
  type Student,
  type Classroom,
} from "../helpers/testbed";

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
const online = await dbReachable();

/** A two-option single-choice question: `correct` right, one distractor. */
const trueFalse = (at: number, order = 0) =>
  singleChoice({ prompt: `q${order}`, at, order, correct: "a", distractors: ["b"] });

describe.skipIf(!online)("attempts & grading", () => {
  let testbed: Testbed;
  let lincoln: School;
  let teacher: Teacher;
  let student: Student;
  let biology: Classroom;

  beforeEach(async () => {
    testbed = await freshTestbed();
    lincoln = await testbed.createSchool("Lincoln High");
    teacher = await lincoln.enrollTeacher({ name: "Ada" });
    student = await lincoln.enrollStudent({ name: "Ben" });
    biology = await teacher.openClass({ name: "Biology", language: "he" });
  });

  afterAll(async () => {
    await closePool();
  });

  it("denies a non-member the answer-free read", async () => {
    const quiz = await teacher.authorQuiz({
      questions: [
        singleChoice({ prompt: "מה?", at: 10, correct: "נכון", distractors: ["לא"] }),
      ],
    });
    await teacher.assignQuiz(quiz, { to: biology });

    // `student` is NOT enrolled in `biology`.
    await expect(student.viewQuiz(quiz, { in: biology })).rejects.toMatchObject({
      code: "not_member",
    });
  });

  it("never returns is_correct and exposes only id/order_index/text on options", async () => {
    const quiz = await teacher.authorQuiz({
      questions: [
        singleChoice({ prompt: "שאלה", at: 10, correct: "א", distractors: ["ב"] }),
      ],
    });
    await teacher.assignQuiz(quiz, { to: biology });
    await biology.enroll(student);

    const served = await student.viewQuiz(quiz, { in: biology });

    expect(JSON.stringify(served)).not.toContain("is_correct");
    // t3 (A3): the answer-free payload must ALSO carry no explanation (it can
    // reveal the answer — explanations come only via get_attempt_review).
    expect(JSON.stringify(served)).not.toContain("explanation");
    expect(served.questions[0]).not.toHaveProperty("explanation");
    expect(served.questions).toHaveLength(1);
    const option = served.questions[0].options[0];
    expect(Object.keys(option).sort()).toEqual(["id", "order_index", "text"]);
  });

  it("serves a question soft-deleted mid-attempt to the in-progress attempt so the student can reach 100% (t7/C2)", async () => {
    const quiz = await teacher.authorQuiz({
      questions: [trueFalse(10, 0), trueFalse(20, 1)],
    });
    const [firstQuestion, secondQuestion] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });
    await biology.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: biology }); // snapshot = 2

    // Teacher soft-deletes the second question AFTER the attempt started.
    await teacher.removeQuestion(secondQuestion);

    // The in-progress attempt still serves BOTH questions (frozen snapshot),
    // including the since-soft-deleted one.
    const served = await student.viewQuiz(quiz, { in: biology });
    expect(served.questions.map((q) => q.id).sort()).toEqual(
      [firstQuestion.id, secondQuestion.id].sort()
    );

    // The student can answer both and reach a perfect score.
    await attempt.answerCorrectly(firstQuestion);
    await attempt.answerCorrectly(secondQuestion);
    const summary = await attempt.complete();
    expect(summary.num_questions).toBe(2);
    expect(summary.num_correct).toBe(2);
  });

  it("serves only the live set for a preview with no active attempt (C2)", async () => {
    const quiz = await teacher.authorQuiz({
      questions: [trueFalse(10, 0), trueFalse(20, 1)],
    });
    const [firstQuestion, secondQuestion] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });
    await biology.enroll(student);

    // Soft-delete the second question with NO attempt in progress.
    await teacher.removeQuestion(secondQuestion);

    const served = await student.viewQuiz(quiz, { in: biology });
    expect(served.questions.map((q) => q.id)).toEqual([firstQuestion.id]);
  });

  it("resolves to the student's language and falls back to base per-row", async () => {
    // Q0 has an 'en' translation; Q1 does not (must fall back to he).
    const quiz = await teacher.authorQuiz({
      baseLanguage: "he",
      questions: [
        singleChoice({
          prompt: "שאלה עברית",
          at: 10,
          order: 0,
          correct: "כן",
          distractors: ["לא"],
          promptLangs: { en: "English question" },
          optionLangs: { כן: { en: "yes" }, לא: { en: "no" } },
        }),
        singleChoice({
          prompt: "שאלה שנייה",
          at: 20,
          order: 1,
          correct: "אמת",
          distractors: ["שקר"],
        }),
      ],
    });
    await teacher.assignQuiz(quiz, { to: biology });
    await biology.enroll(student);
    await student.setPreferredLanguage("en");

    const served = await student.viewQuiz(quiz, { in: biology });

    expect(served.resolved_language).toBe("en");
    expect(served.served_complete).toBe(false); // Q1 lacked 'en'
    expect(served.questions[0].prompt).toBe("English question");
    expect(served.questions[0].options.map((o) => o.text)).toEqual(["yes", "no"]);
    expect(served.questions[1].prompt).toBe("שאלה שנייה"); // base fallback
  });

  it("starts, snapshots the question set, then resumes the same attempt", async () => {
    const quiz = await teacher.authorQuiz({
      questions: [trueFalse(10, 0), trueFalse(20, 1)],
    });
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });
    await biology.enroll(student);

    const started = await student.startAttempt(quiz, { in: biology });
    expect(started.resumed).toBe(false);
    expect(started.attemptNo).toBe(1);
    expect(started.answeredQuestionIds).toEqual([]);

    expect(await testbed.db.snapshotSize(started)).toBe(2);

    const resumed = await student.startAttempt(quiz, { in: biology });
    expect(resumed.resumed).toBe(true);
    expect(resumed.id).toBe(started.id);
  });

  it("grades single-choice server-side and reports the score from snapshots", async () => {
    const quiz = await teacher.authorQuiz({
      questions: [
        singleChoice({ prompt: "q", at: 10, correct: "right", distractors: ["wrong"] }),
      ],
    });
    const [q] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });
    await biology.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: biology });

    // Correct pick.
    await attempt.answerCorrectly(q);
    expect(await testbed.db.wasCorrect(attempt, q)).toBe(true);

    const summary = await attempt.complete();
    expect(summary.num_questions).toBe(1);
    expect(summary.num_correct).toBe(1);
  });

  it("rejects a single-choice submission that is not exactly one option", async () => {
    const quiz = await teacher.authorQuiz({ questions: [trueFalse(10, 0)] });
    const [q] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });
    await biology.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: biology });

    await expect(attempt.answer(q, q.optionIds)).rejects.toMatchObject({
      code: "invalid_selection_count",
    });
  });

  it("grades multi-select only on an exact set match", async () => {
    const quiz = await teacher.authorQuiz({
      questions: [
        multiChoice({ prompt: "q", at: 10, correct: ["a", "b"], distractors: ["c"] }),
      ],
    });
    const [q] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });
    await biology.enroll(student);

    // Exact set → correct.
    const exact = await student.startAttempt(quiz, { in: biology });
    await exact.answerCorrectly(q);
    expect(await testbed.db.wasCorrect(exact, q)).toBe(true);
    await exact.complete();

    // Subset (missing one correct) → incorrect.
    const subset = await student.startAttempt(quiz, { in: biology });
    await subset.answer(q, [q.correctIds[0]]);
    expect(await testbed.db.wasCorrect(subset, q)).toBe(false);
    await subset.complete();

    // Superset (correct + a distractor) → incorrect.
    const superset = await student.startAttempt(quiz, { in: biology });
    await superset.answer(q, [...q.correctIds, q.distractorIds[0]]);
    expect(await testbed.db.wasCorrect(superset, q)).toBe(false);
  });

  it("rejects a duplicate answer for the same question", async () => {
    const quiz = await teacher.authorQuiz({ questions: [trueFalse(10, 0)] });
    const [q] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });
    await biology.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: biology });

    await attempt.answerCorrectly(q);
    await expect(attempt.answer(q, [q.optionIds[1]])).rejects.toMatchObject({
      code: "already_answered",
    });
  });

  it("counts only completed attempts against max_attempts; abandoned ones resume", async () => {
    const quiz = await teacher.authorQuiz({ questions: [trueFalse(10, 0)] });
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: 1 }); // one attempt allowed
    await biology.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: biology });
    // Not completed → a second call resumes rather than being blocked.
    const resumed = await student.startAttempt(quiz, { in: biology });
    expect(resumed.id).toBe(attempt.id);

    await attempt.complete();
    // Now the single allowed (completed) attempt is used up.
    await expect(student.startAttempt(quiz, { in: biology })).rejects.toMatchObject({
      code: "no_attempts_left",
    });
  });

  it("does not change an in-progress attempt's num_questions when the quiz is edited", async () => {
    const quiz = await teacher.authorQuiz({
      questions: [trueFalse(10, 0), trueFalse(20, 1)],
    });
    const [firstQuestion, secondQuestion] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });
    await biology.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: biology }); // snapshot = 2

    // Teacher edits mid-attempt: soft-delete Q1, add a brand-new question.
    await teacher.removeQuestion(secondQuestion);
    await teacher.addQuestion(quiz, trueFalse(30, 2));

    await attempt.answerCorrectly(firstQuestion);
    const summary = await attempt.complete();
    expect(summary.num_questions).toBe(2); // frozen snapshot, not the edited count
    expect(summary.num_correct).toBe(1);
  });

  it("keeps the was_correct snapshot when the answer key is edited afterwards", async () => {
    const quiz = await teacher.authorQuiz({ questions: [trueFalse(10, 0)] });
    const [q] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });
    await biology.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: biology });
    await attempt.answerCorrectly(q);

    // Teacher flips the answer key after the answer was recorded. The flip runs in
    // ONE transaction so the deferred single-correct constraint validates only the
    // final (still-valid) state rather than the invalid mid-flip.
    await q.flipCorrectTo(q.distractorIds[0]);

    const summary = await attempt.complete();
    expect(summary.num_correct).toBe(1); // snapshot preserved
  });

  it("rejects submitting a question that is not in the attempt snapshot", async () => {
    const quiz = await teacher.authorQuiz({ questions: [trueFalse(10, 0)] });
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });
    await biology.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: biology });

    // A question created AFTER the snapshot is not part of this attempt.
    const lateQuestion = await teacher.addQuestion(quiz, trueFalse(20, 1));
    await expect(
      attempt.answer(lateQuestion, [lateQuestion.firstCorrect])
    ).rejects.toMatchObject({ code: "question_not_in_attempt" });
  });

  it("guards against acting on another student's attempt", async () => {
    const quiz = await teacher.authorQuiz({ questions: [trueFalse(10, 0)] });
    const [q] = quiz.questions;
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });
    await biology.enroll(student);

    const attempt = await student.startAttempt(quiz, { in: biology });

    // The teacher (a different auth.uid) may not submit into the student's attempt.
    await expect(
      attempt.answerAs(teacher, q, [q.firstCorrect])
    ).rejects.toMatchObject({ code: "not_your_attempt" });
  });
});
