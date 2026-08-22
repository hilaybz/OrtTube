/**
 * The analytics cutoff end to end: after a teacher edits a quiz's questions or
 * answers, every teacher-facing analytic counts only attempts started since that
 * edit (`148_analytics_since_content_edit.sql`).
 *
 * The story is one class, one quiz, one student:
 *
 *   1. Ada completes the quiz 2/2 under the original wording.
 *   2. The teacher rewrites Q1's prompt, which moves `content_updated_at`.
 *   3. Every analytic now reads empty — the old attempt is no longer comparable,
 *      because `answers.was_correct` is a snapshot against the wording and answer
 *      key as they stood.
 *   4. Ada attempts again, and only that attempt counts.
 *
 * The cut is whole ATTEMPTS, not individual answers: `attempt_questions` freezes
 * only which questions an attempt contains, while prompt text and `is_correct` are
 * read live, so an attempt in flight during an edit really does see the new
 * version and cannot be partly counted.
 *
 * Progress is cut alongside performance, deliberately — so the last case here
 * pins the flip side, that nothing on the STUDENT's side is filtered: Ada keeps
 * seeing her own result, because hiding it would ask her to redo work she has
 * already done and may have no retake left for.
 *
 * Skipped when the local DB is unreachable so unit suites still pass offline.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool } from "../helpers/db";
import {
  freshTestbed,
  singleChoice,
  type Testbed,
  type Teacher,
  type Student,
  type Classroom,
  type Quiz,
  type AuthoredQuestion,
} from "../helpers/testbed";
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

describe.skipIf(!online)("analytics cutoff after a content edit", () => {
  let testbed: Testbed;
  let teacher: Teacher;
  let ada: Student;
  let classroom: Classroom;
  let quiz: Quiz;
  let q1: AuthoredQuestion;
  let q2: AuthoredQuestion;

  beforeEach(async () => {
    testbed = await freshTestbed();
    const school = await testbed.createSchool("Cutoff Analytics School");
    teacher = await school.enrollTeacher({ name: "Tara" });
    ada = await school.enrollStudent({ name: "Ada" });

    quiz = await teacher.authorQuiz({
      baseLanguage: "he",
      title: "Cutoff Quiz",
      questions: [
        singleChoice({ prompt: "Q1", at: 30, order: 0, correct: "A", distractors: ["B"] }),
        singleChoice({ prompt: "Q2", at: 60, order: 1, correct: "C", distractors: ["D"] }),
      ],
    });
    q1 = quiz.questions[0];
    q2 = quiz.questions[1];

    classroom = await teacher.openClass({ name: "Class", language: "he" });
    await classroom.enroll(ada);
    // Unlimited attempts so the post-edit retake below is possible at all — with
    // `maxAttempts: 1` an edit would leave the student unable to regenerate any
    // data, which is the consequence the editor warns about.
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints", maxAttempts: null });

    const first = await ada.startAttempt(quiz, { in: classroom });
    await first.answerCorrectly(q1);
    await first.answerCorrectly(q2);
    await first.complete();
  }, 60_000);

  afterAll(async () => {
    await closePool();
  });

  it("counts the pre-edit attempt until the quiz is edited", async () => {
    const stats = await teacher.quizStats(quiz);
    expect(stats.attempt_count).toBe(1);
    expect(stats.completion_count).toBe(1);
    expect(stats.average_score).toBeCloseTo(1);
    expect(stats.excluded_attempt_count).toBe(0);
  });

  describe("once the teacher rewrites a question", () => {
    beforeEach(async () => {
      await teacher.reviseQuestion(q1, { prompt: "Q1 rewritten" });
    });

    it("stops counting it in quiz_stats, and says how many it is hiding", async () => {
      const stats = await teacher.quizStats(quiz);
      expect(stats.attempt_count).toBe(0);
      expect(stats.completion_count).toBe(0);
      expect(stats.average_score).toBeNull();
      expect(stats.excluded_attempt_count).toBe(1);
    });

    it("stops counting it per question, so a correct% cannot describe old wording", async () => {
      const report = await teacher.questionStats(quiz);
      for (const question of report.questions) {
        expect(question.total_answers).toBe(0);
        expect(question.correct_pct).toBeNull();
      }
    });

    it("stops counting it in class_stats", async () => {
      const stats = await teacher.classStats(classroom);
      const row = stats.quizzes.find((entry) => entry.quiz_id === quiz.id)!;
      expect(row.attempt_count).toBe(0);
      expect(row.completion_count).toBe(0);
      expect(row.members_completed).toBe(0);
      expect(row.average_score).toBeNull();
      expect(row.excluded_attempt_count).toBe(1);
    });

    it("stops counting it in class_quiz_analytics", async () => {
      const analytics = await teacher.classQuizAnalytics(classroom, quiz);
      expect(analytics.students_completed).toBe(0);
      expect(analytics.attempt_count).toBe(0);
      expect(analytics.average_score).toBeNull();
      expect(analytics.excluded_attempt_count).toBe(1);
      // Five bands are always present; every one of them is now empty.
      expect(analytics.score_distribution).toHaveLength(5);
      expect(analytics.score_distribution.every((band) => band.count === 0)).toBe(true);
    });

    it("shows the member as not-started in roster progress — the chosen consequence", async () => {
      const report = await teacher.rosterProgress(classroom);
      const member = report.members.find((m) => m.student_id === ada.id)!;
      const row = member.quizzes.find((entry) => entry.quiz_id === quiz.id)!;
      expect(row.completed).toBe(false);
      expect(row.attempt_count).toBe(0);
      expect(row.best_score).toBeNull();
      expect(member.quizzes_completed).toBe(0);
    });

    it("still shows the student her own result — student reads are never cut", async () => {
      const state = await ada.attemptState(quiz, { in: classroom });
      expect(state.attempt_count).toBe(1);
      expect(state.completed_count).toBe(1);
      expect(state.last_num_correct).toBe(2);
    });

    it("counts a fresh attempt started after the edit", async () => {
      const second = await ada.startAttempt(quiz, { in: classroom });
      await second.answerCorrectly(q1);
      await second.answer(q2, [q2.distractorIds[0]]);
      await second.complete();

      const stats = await teacher.quizStats(quiz);
      expect(stats.attempt_count).toBe(1);
      expect(stats.completion_count).toBe(1);
      expect(stats.average_score).toBeCloseTo(0.5);
      // The pre-edit attempt is hidden, not gone.
      expect(stats.excluded_attempt_count).toBe(1);
    });
  });

  it("keeps counting the attempt when only the title changes", async () => {
    await teacher.setTitle(quiz, "Renamed, not re-authored");
    const stats = await teacher.quizStats(quiz);
    expect(stats.attempt_count).toBe(1);
    expect(stats.excluded_attempt_count).toBe(0);
  });

  it("keeps counting the attempt when an unchanged question payload is resent", async () => {
    // The marker-drag / no-op-Save replay. If this ever starts failing, the
    // triggers' OLD-vs-NEW comparison has been lost and a nudge destroys a term.
    await teacher.reviseQuestion(q1, {});
    const stats = await teacher.quizStats(quiz);
    expect(stats.attempt_count).toBe(1);
    expect(stats.excluded_attempt_count).toBe(0);
  });

  it("tells the editor how many attempts a further edit would stop counting", async () => {
    const view = await teacher.editorView(quiz);
    expect(view.analytics_attempt_count).toBe(1);
    expect(view.content_updated_at).not.toBeNull();

    await teacher.reviseQuestion(q1, { prompt: "Q1 rewritten" });
    // Nothing is feeding analytics any more, so the editor stops warning.
    const after = await teacher.editorView(quiz);
    expect(after.analytics_attempt_count).toBe(0);
  });
});
