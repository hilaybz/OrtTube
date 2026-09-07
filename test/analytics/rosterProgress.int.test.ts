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
import { AnalyticsError } from "@/lib/analytics";
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

describe.skipIf(!online)("roster analytics (per-student progress)", () => {
  let teacher: Teacher;
  let peerTeacher: Teacher;
  let alice: Student;
  let bob: Student;
  let carol: Student;
  let classroom: Classroom;
  let quizA: Quiz;
  let quizB: Quiz;
  let a1: AuthoredQuestion;
  let a2: AuthoredQuestion;

  beforeEach(async () => {
    const testbed: Testbed = await freshTestbed();
    const school = await testbed.createSchool("Roster School");

    teacher = await school.enrollTeacher({ name: "Tara" });
    peerTeacher = await school.enrollTeacher({ name: "Pat" });
    alice = await school.enrollStudent({ name: "Alice" });
    bob = await school.enrollStudent({ name: "Bob" });
    carol = await school.enrollStudent({ name: "Carol" });

    quizA = await teacher.authorQuiz({
      baseLanguage: "he",
      title: "Quiz A",
      questions: [
        singleChoice({ prompt: "A-Q1", at: 100, order: 0, correct: "A1a", distractors: ["A1b"] }),
        singleChoice({ prompt: "A-Q2", at: 200, order: 1, correct: "A2a", distractors: ["A2b"] }),
      ],
    });
    a1 = quizA.questions[0];
    a2 = quizA.questions[1];

    quizB = await teacher.authorQuiz({
      baseLanguage: "he",
      title: "Quiz B",
      questions: [
        singleChoice({ prompt: "B-Q1", at: 100, order: 0, correct: "B1a", distractors: ["B1b"] }),
      ],
    });

    classroom = await teacher.openClass({ name: "Class", language: "he" });
    await classroom.enroll(alice);
    await classroom.enroll(bob);
    await classroom.enroll(carol);
    await teacher.assignQuiz(quizA, { to: classroom, tutor: "hints", maxAttempts: null });
    await teacher.assignQuiz(quizB, { to: classroom, tutor: "hints", maxAttempts: null });

    const aliceAttempt = await alice.startAttempt(quizA, { in: classroom });
    await aliceAttempt.answerCorrectly(a1);
    await aliceAttempt.answerCorrectly(a2);
    await aliceAttempt.complete();

    const bob1 = await bob.startAttempt(quizA, { in: classroom });
    await bob1.answer(a1, [a1.optionByText("A1b").id]);
    await bob1.answer(a2, [a2.optionByText("A2b").id]);
    await bob1.complete();
    const bob2 = await bob.startAttempt(quizA, { in: classroom });
    await bob2.answerCorrectly(a1);
    await bob2.answer(a2, [a2.optionByText("A2b").id]);
    await bob2.complete();

  }, 60_000);

  afterAll(async () => {
    await closePool();
  });

  describe("class_roster_progress", () => {
    it("reports per-student scores, best-of-multiple attempts, and rollups", async () => {
      const report = await teacher.rosterProgress(classroom);
      expect(report.class_id).toBe(classroom.id);

      expect(report.summary.member_count).toBe(3);
      expect(report.summary.total_assigned).toBe(2);
      expect(report.summary.possible_completions).toBe(6);
      expect(report.summary.quizzes_completed_total).toBe(2);
      expect(Number(report.summary.average_best_score)).toBeCloseTo(0.75, 6);

      expect(report.members).toHaveLength(3);
      const memberOf = (s: Student) =>
        report.members.find((m) => m.student_id === s.id)!;
      const quizOf = (m: (typeof report.members)[number], q: Quiz) =>
        m.quizzes.find((x) => x.quiz_id === q.id)!;

      const aliceRow = memberOf(alice);
      expect(aliceRow.display_name).toBe("Alice");
      expect(aliceRow.email).toBe(alice.email);
      expect(aliceRow.total_assigned).toBe(2);
      expect(aliceRow.quizzes_completed).toBe(1);
      expect(Number(aliceRow.average_best_score)).toBeCloseTo(1.0, 6);
      const aliceA = quizOf(aliceRow, quizA);
      expect(aliceA.title).toBe("Quiz A");
      expect(aliceA.completed).toBe(true);
      expect(aliceA.attempt_count).toBe(1);
      expect(aliceA.best_num_correct).toBe(2);
      expect(aliceA.best_num_questions).toBe(2);
      expect(Number(aliceA.best_score)).toBeCloseTo(1.0, 6);
      const aliceB = quizOf(aliceRow, quizB);
      expect(aliceB.completed).toBe(false);
      expect(aliceB.attempt_count).toBe(0);
      expect(aliceB.best_score).toBeNull();

      const bobRow = memberOf(bob);
      expect(bobRow.quizzes_completed).toBe(1);
      expect(Number(bobRow.average_best_score)).toBeCloseTo(0.5, 6);
      const bobA = quizOf(bobRow, quizA);
      expect(bobA.completed).toBe(true);
      expect(bobA.attempt_count).toBe(2);
      expect(bobA.best_num_correct).toBe(1);
      expect(Number(bobA.best_score)).toBeCloseTo(0.5, 6);

      const carolRow = memberOf(carol);
      expect(carolRow.quizzes_completed).toBe(0);
      expect(carolRow.average_best_score).toBeNull();
      expect(quizOf(carolRow, quizA).completed).toBe(false);
      expect(quizOf(carolRow, quizA).attempt_count).toBe(0);
    });

    it("denies a non-owner teacher (not_owner)", async () => {
      await expect(peerTeacher.rosterProgress(classroom)).rejects.toBeInstanceOf(
        AnalyticsError
      );
      await expect(peerTeacher.rosterProgress(classroom)).rejects.toMatchObject({
        code: "not_owner",
      });
    });
  });

  describe("student_quiz_progress (drill-down)", () => {
    it("lists a single student's per-quiz attempts with scores", async () => {
      const report = await teacher.studentProgress(classroom, bob);
      expect(report.class_id).toBe(classroom.id);
      expect(report.student_id).toBe(bob.id);
      expect(report.display_name).toBe("Bob");
      expect(report.email).toBe(bob.email);

      expect(report.quizzes).toHaveLength(2);
      const qA = report.quizzes.find((q) => q.quiz_id === quizA.id)!;
      expect(qA.completed).toBe(true);
      expect(qA.attempt_count).toBe(2);
      expect(Number(qA.best_score)).toBeCloseTo(0.5, 6);
      expect(qA.attempts).toHaveLength(2);
      expect(qA.attempts[0].attempt_no).toBe(1);
      expect(Number(qA.attempts[0].score)).toBeCloseTo(0, 6);
      expect(qA.attempts[1].attempt_no).toBe(2);
      expect(Number(qA.attempts[1].score)).toBeCloseTo(0.5, 6);

      const qB = report.quizzes.find((q) => q.quiz_id === quizB.id)!;
      expect(qB.completed).toBe(false);
      expect(qB.attempt_count).toBe(0);
      expect(qB.attempts).toHaveLength(0);
    });

    it("denies a non-owner teacher (not_owner)", async () => {
      await expect(
        peerTeacher.studentProgress(classroom, bob)
      ).rejects.toBeInstanceOf(AnalyticsError);
      await expect(
        peerTeacher.studentProgress(classroom, bob)
      ).rejects.toMatchObject({ code: "not_owner" });
    });
  });
});
