/**
 * Scheduling-window hard cutoff — attempt-level enforcement (Epic 2A.2).
 *
 * `test/classes/classes.int.test.ts` covers the assignment-side window
 * (validation, the schedule setter, read gating on `not_assigned`). This file
 * covers what happens to an ATTEMPT already in flight when the window closes:
 * `submit_answer` force-finalizing in place, `complete_attempt` backdating,
 * the reveal gate widening once no retake remains, and the
 * `close_expired_attempt_windows` cron sweep as the backstop for attempts
 * nobody came back to interact with.
 *
 * Every action runs through the actor DSL (`test/helpers/testbed`), so each
 * RPC's `auth.uid()` check is real; `testbed.admin.closeExpiredAttemptWindows`
 * calls the service-role-only sweep RPC directly, matching how the cron job
 * route itself invokes it.
 *
 * Runs at the integration/gate step (owns DB application). Skipped when the
 * local DB is unreachable so unit suites still pass without Supabase running.
 */
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
    // No window at assignment time, so the attempt can start normally.
    await teacher.assignQuiz(quiz, { to: biology });
    const attempt = await student.startAttempt(quiz, { in: biology });

    // Close the window now, mid-attempt, before any answer is submitted.
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
    // The answer never got recorded — unanswered counts wrong, by omission.
    expect(row!.num_correct).toBe(0);

    // A second submit on the now-completed attempt gets the ordinary
    // rejection, not another window_closed.
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

    // Still open, 1 of 3 attempts used: no reveal yet.
    expect((await attempt.review()).revealed).toBe(false);

    // Close the window — no retake remains even though the cap isn't
    // exhausted, so the gate must open exactly like an exhausted cap would.
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

    // Nobody ever calls submit_answer or complete_attempt again — the sweep
    // is the only thing that will ever close this attempt.
    const first = await testbed.admin.closeExpiredAttemptWindows();
    expect(first.closed).toBe(1);

    const row = await testbed.db.attemptRow(attempt);
    expect(row!.completed_at).not.toBeNull();
    expect(new Date(row!.completed_at!).getTime()).toBe(new Date(closedAt).getTime());

    // A second run must not double-process (or error on) an already-closed attempt.
    const second = await testbed.admin.closeExpiredAttemptWindows();
    expect(second.closed).toBe(0);
  });

  it("close_expired_attempt_windows does not touch attempts with no window or one that hasn't closed", async () => {
    const openQuiz = await teacher.authorQuiz({
      baseLanguage: "he",
      questions: [trueFalse(10)],
    });
    await teacher.assignQuiz(openQuiz, { to: biology }); // no window at all
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
