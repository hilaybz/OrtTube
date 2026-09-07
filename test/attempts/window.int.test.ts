import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { closePool } from "../helpers/db";
import {
  freshTestbed,
  singleChoice,
  type Testbed,
  type School,
  type Teacher,
  type Student,
  type Classroom,
  type Quiz,
} from "../helpers/testbed";
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

const trueFalse = (at: number) =>
  singleChoice({ prompt: "q", at, order: 0, correct: "a", distractors: ["b"] });

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}
function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

describe.skipIf(!online)("scheduling window — attempt finalization", () => {
  let testbed: Testbed;
  let lincoln: School;
  let teacher: Teacher;
  let student: Student;
  let biology: Classroom;
  let quiz: Quiz;

  beforeEach(async () => {
    testbed = await freshTestbed();
    lincoln = await testbed.createSchool("Lincoln High");
    teacher = await lincoln.enrollTeacher({ name: "Ada" });
    student = await lincoln.enrollStudent({ name: "Ben" });
    biology = await teacher.openClass({ name: "Biology", language: "he" });
    quiz = await teacher.authorQuiz({ baseLanguage: "he", questions: [trueFalse(10)] });
    await biology.enroll(student);
  });

  afterAll(async () => {
    await closePool();
  });

  it("submit_answer force-finalizes the attempt when the window has closed — and the write survives the thrown error", async () => {
    await teacher.assignQuiz(quiz, { to: biology });
    const attempt = await student.startAttempt(quiz, { in: biology });

    const closedAt = isoAgo(1000);
    await teacher.setSchedule(quiz, {
      in: biology,
      availableFrom: null,
      availableUntil: closedAt,
    });

    await expect(attempt.answerCorrectly(quiz.questions[0])).rejects.toMatchObject({
      code: "window_closed",
    });

    // This is the regression test for "raise rolls back the UPDATE that
    // closed the attempt": the finalizing write must have committed despite
    // the thrown error, or the attempt would be stuck open forever.
    const row = await testbed.db.attemptRow(attempt);
    expect(row!.completed_at).not.toBeNull();
    expect(new Date(row!.completed_at!).getTime()).toBe(new Date(closedAt).getTime());
    expect(row!.num_questions).toBe(1);
    expect(row!.num_correct).toBe(0);

    await expect(attempt.answerCorrectly(quiz.questions[0])).rejects.toMatchObject({
      code: "attempt_completed",
    });
  });

  it("complete_attempt backdates completed_at to the window's close, not wall-clock now()", async () => {
    await teacher.assignQuiz(quiz, { to: biology });
    const attempt = await student.startAttempt(quiz, { in: biology });
    const closedAt = isoAgo(5000);
    await teacher.setSchedule(quiz, {
      in: biology,
      availableFrom: null,
      availableUntil: closedAt,
    });

    const summary = await attempt.complete();
    expect(new Date(summary.completed_at).getTime()).toBe(new Date(closedAt).getTime());
  });

  it("get_attempt_review reveals once the window has closed, even with attempts remaining", async () => {
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: 3 });
    const attempt = await student.startAttempt(quiz, { in: biology });
    await attempt.answerCorrectly(quiz.questions[0]);
    await attempt.complete();

    expect((await attempt.review()).revealed).toBe(false);

    await teacher.setSchedule(quiz, {
      in: biology,
      availableFrom: null,
      availableUntil: isoAgo(1000),
    });
    expect((await attempt.review()).revealed).toBe(true);
  });

  it("close_expired_attempt_windows finalizes an abandoned attempt and is idempotent", async () => {
    await teacher.assignQuiz(quiz, { to: biology });
    const attempt = await student.startAttempt(quiz, { in: biology });
    const closedAt = isoAgo(2000);
    await teacher.setSchedule(quiz, {
      in: biology,
      availableFrom: null,
      availableUntil: closedAt,
    });

    const first = await testbed.admin.closeExpiredAttemptWindows();
    expect(first.closed).toBe(1);

    const row = await testbed.db.attemptRow(attempt);
    expect(row!.completed_at).not.toBeNull();
    expect(new Date(row!.completed_at!).getTime()).toBe(new Date(closedAt).getTime());

    const second = await testbed.admin.closeExpiredAttemptWindows();
    expect(second.closed).toBe(0);
  });

  it("close_expired_attempt_windows does not touch attempts with no window or one that hasn't closed", async () => {
    const openQuiz = await teacher.authorQuiz({
      baseLanguage: "he",
      questions: [trueFalse(10)],
    });
    await teacher.assignQuiz(openQuiz, { to: biology });
    const openAttempt = await student.startAttempt(openQuiz, { in: biology });

    const futureQuiz = await teacher.authorQuiz({
      baseLanguage: "he",
      questions: [trueFalse(10)],
    });
    await teacher.assignQuiz(futureQuiz, { to: biology, availableUntil: isoIn(3600_000) });
    const futureAttempt = await student.startAttempt(futureQuiz, { in: biology });

    const result = await testbed.admin.closeExpiredAttemptWindows();
    expect(result.closed).toBe(0);
    expect((await testbed.db.attemptRow(openAttempt))!.completed_at).toBeNull();
    expect((await testbed.db.attemptRow(futureAttempt))!.completed_at).toBeNull();
  });
});
