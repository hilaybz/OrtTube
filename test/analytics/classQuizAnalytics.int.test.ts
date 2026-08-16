/**
 * `class_quiz_analytics(class_id, quiz_id)` — the per-(class, quiz) analytic
 * `class_stats`/`question_stats` don't provide alone (see `docs/data-model.md`
 * and `supabase/migrations/138_class_quiz_analytics.sql`). Scored from each
 * student's LATEST completed attempt only, never best-of and never every
 * retake, so a class's reported average always matches the sum of what each
 * student is individually shown.
 *
 * Skipped when the local DB is unreachable so unit suites still pass offline.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool } from "../helpers/db";
import {
  freshTestbed,
  singleChoice,
  type Testbed,
  type Teacher,
  type Classroom,
  type Quiz,
} from "../helpers/testbed";
import { AnalyticsError } from "@/lib/analytics";
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

function twoQuestions() {
  return [
    singleChoice({
      prompt: "Q1",
      at: 10,
      order: 0,
      correct: "A",
      distractors: ["B"],
    }),
    singleChoice({
      prompt: "Q2",
      at: 20,
      order: 1,
      correct: "C",
      distractors: ["D"],
    }),
  ];
}

describe.skipIf(!online)("class_quiz_analytics", () => {
  let testbed: Testbed;
  let teacher: Teacher;
  let peerTeacher: Teacher;
  let classroom: Classroom;
  let quiz: Quiz;

  beforeAll(async () => {
    testbed = await freshTestbed();
    const school = await testbed.createSchool("Class Quiz Analytics School");

    teacher = await school.enrollTeacher({ name: "Tara" });
    peerTeacher = await school.enrollTeacher({ name: "Pat" });

    quiz = await teacher.authorQuiz({ baseLanguage: "he", questions: twoQuestions() });

    classroom = await teacher.openClass({ name: "Class A", language: "he" });
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints", maxAttempts: null });
  }, 60_000);

  afterAll(async () => {
    await closePool();
  });

  it("scoring uses the latest completed attempt per student, class isolation, and distribution buckets", async () => {
    const school = await testbed.createSchool("Latest-Attempt School");
    const t = await school.enrollTeacher({ name: "Owner" });
    const q = await t.authorQuiz({ baseLanguage: "he", questions: twoQuestions() });
    const [a1, a2] = q.questions;

    const classA = await t.openClass({ name: "A", language: "he" });
    const classB = await t.openClass({ name: "B", language: "he" });
    await t.assignQuiz(q, { to: classA, tutor: "hints", maxAttempts: null });
    await t.assignQuiz(q, { to: classB, tutor: "hints", maxAttempts: null });

    const retaker = await school.enrollStudent({ name: "Retaker" });
    const perfect = await school.enrollStudent({ name: "Perfect" });
    const otherClassStudent = await school.enrollStudent({ name: "Other" });
    await classA.enroll(retaker);
    await classA.enroll(perfect);
    await classB.enroll(otherClassStudent);

    // retaker: first attempt 0/2, retakes and gets 2/2 — only the LATEST
    // (2/2) should count toward the average/distribution/option counts.
    const firstAttempt = await retaker.startAttempt(q, { in: classA });
    await firstAttempt.answer(a1, [a1.optionByText("B").id]);
    await firstAttempt.answer(a2, [a2.optionByText("D").id]);
    await firstAttempt.complete();
    const secondAttempt = await retaker.startAttempt(q, { in: classA });
    await secondAttempt.answerAllCorrectly();
    await secondAttempt.complete();

    // perfect: single attempt, 2/2 — lands in the top score bucket.
    const perfectAttempt = await perfect.startAttempt(q, { in: classA });
    await perfectAttempt.answerAllCorrectly();
    await perfectAttempt.complete();

    // otherClassStudent: attempts the SAME quiz but in classB — must not
    // bleed into classA's analytics.
    const otherAttempt = await otherClassStudent.startAttempt(q, { in: classB });
    await otherAttempt.answer(a1, [a1.optionByText("B").id]);
    await otherAttempt.answer(a2, [a2.optionByText("D").id]);
    await otherAttempt.complete();

    const analytics = await t.classQuizAnalytics(classA, q);
    expect(analytics.class_id).toBe(classA.id);
    expect(analytics.quiz_id).toBe(q.id);
    expect(analytics.member_count).toBe(2); // retaker, perfect — classA roster only
    expect(analytics.students_completed).toBe(2); // one row per student, not per attempt
    expect(analytics.attempt_count).toBe(3); // retaker's 2 attempts + perfect's 1, classA only
    expect(analytics.completion_count).toBe(3);
    // Both counted students' LATEST attempt is a perfect 2/2 -> average 1.0.
    expect(Number(analytics.average_score)).toBeCloseTo(1, 6);

    // Distribution: both students land in the top (80-100%) bucket, all
    // five buckets present, no phantom 6th bucket for the perfect score.
    expect(analytics.score_distribution).toHaveLength(5);
    const top = analytics.score_distribution[4];
    expect(top.bucket_min).toBeCloseTo(0.8, 6);
    expect(top.bucket_max).toBeCloseTo(1, 6);
    expect(top.count).toBe(2);
    const totalAcrossBuckets = analytics.score_distribution.reduce(
      (sum, b) => sum + b.count,
      0
    );
    expect(totalAcrossBuckets).toBe(2);

    // Per-question/option counts also reflect only the latest attempts: Q1's
    // correct option "A" was chosen by both students on their LATEST try
    // (the retaker's discarded first attempt chose "B", which must not count).
    const question1 = analytics.questions.find((qq) => qq.question_id === a1.id)!;
    const optionA = question1.options.find((o) => o.text === "A")!;
    const optionB = question1.options.find((o) => o.text === "B")!;
    expect(optionA.selection_count).toBe(2);
    expect(optionB.selection_count).toBe(0);
    expect(question1.correct_pct).toBeCloseTo(1, 6);

    // classB's attempt must not appear anywhere in classA's analytics.
    const classBAnalytics = await t.classQuizAnalytics(classB, q);
    expect(classBAnalytics.students_completed).toBe(1);
    expect(classBAnalytics.average_score).toBeCloseTo(0, 6);
  }, 60_000);

  it("a quiz with zero attempts returns a null average and an all-zero distribution", async () => {
    const analytics = await teacher.classQuizAnalytics(classroom, quiz);
    expect(analytics.students_completed).toBe(0);
    expect(analytics.average_score).toBeNull();
    expect(analytics.score_distribution).toHaveLength(5);
    for (const bucket of analytics.score_distribution) {
      expect(bucket.count).toBe(0);
    }
  });

  it("denies a teacher who does not own the class (not_owner), before checking assignment", async () => {
    // peerTeacher owns neither the class nor the quiz; not_owner must fire
    // regardless of whether the quiz id passed is even assigned anywhere.
    await expect(
      peerTeacher.classQuizAnalytics(classroom, quiz)
    ).rejects.toMatchObject({ code: "not_owner" });
  });

  it("raises not_assigned for the owner passing a quiz not assigned to that class", async () => {
    const unassignedQuiz = await teacher.authorQuiz({
      baseLanguage: "he",
      questions: twoQuestions(),
    });
    await expect(
      teacher.classQuizAnalytics(classroom, unassignedQuiz)
    ).rejects.toMatchObject({ code: "not_assigned" });
  });

  it("both errors are AnalyticsError instances", async () => {
    await expect(
      peerTeacher.classQuizAnalytics(classroom, quiz)
    ).rejects.toBeInstanceOf(AnalyticsError);
  });
});
