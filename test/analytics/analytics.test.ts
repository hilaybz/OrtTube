/**
 * Analytics integration tests — the compute-on-read RPCs (`quiz_stats`,
 * `question_stats`, `class_stats`, `tutor_stats`) end-to-end against a live local
 * Supabase with the v2 schema applied (the gate applies all migrations first).
 *
 * Told as a story through the actor DSL (`test/helpers/testbed.ts`): a teacher
 * authors a two-question quiz, assigns it to a class of three students who attempt
 * it with hand-picked outcomes, and then reads her owner-only analytics. Every
 * asserted number is hand-computable from the fixture below.
 *
 * Two behaviours have NO clean domain-action equivalent and are seeded out-of-band
 * via small local helpers (noted where used):
 *   - an ANONYMIZED attempt (`student_id IS NULL`, a departed student) that must
 *     still count toward totals/averages without attribution, and
 *   - that same attempt HISTORICALLY choosing a distractor the teacher later
 *     soft-deleted, so the distribution still surfaces the retired option.
 * Analytics themselves are always read through an authenticated teacher client so
 * the RPCs' `auth.uid()` owner checks are real.
 *
 * Skipped when the local DB is unreachable so unit suites still pass offline.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool, closePool } from "../helpers/db";
import {
  freshTestbed,
  singleChoice,
  multiChoice,
  type Testbed,
  type Teacher,
  type Classroom,
  type Quiz,
  type AuthoredQuestion,
  type QuizOption,
} from "../helpers/testbed";
import { AnalyticsError } from "@/lib/analytics";

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
const online = await dbReachable();

/**
 * Seed a COMPLETED attempt with no student (`student_id IS NULL`) — modelling a
 * departed/anonymized learner whose attempt still counts toward attempt-based
 * totals and averages. Written via raw `pg` because the attempt flow always runs
 * as a signed-in student; there is no domain action that produces an anonymized
 * attempt, and its answers may reference soft-deleted options (see below).
 */
async function seedAnonymizedCompletedAttempt(opts: {
  quiz: Quiz;
  classroom: Classroom;
  numCorrect: number;
  numQuestions: number;
  answers: {
    question: AuthoredQuestion;
    wasCorrect: boolean;
    chose: QuizOption[];
  }[];
}): Promise<void> {
  const pool = getPool();
  const attempt = await pool.query<{ id: string }>(
    `INSERT INTO public.attempts
       (student_id, class_id, quiz_id, attempt_no, completed_at, num_correct, num_questions)
     VALUES (NULL, $1, $2, 1, now(), $3, $4)
     RETURNING id`,
    [opts.classroom.id, opts.quiz.id, opts.numCorrect, opts.numQuestions]
  );
  const attemptId = attempt.rows[0].id;
  for (const answer of opts.answers) {
    const answerRow = await pool.query<{ id: string }>(
      `INSERT INTO public.answers (attempt_id, question_id, was_correct)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [attemptId, answer.question.id, answer.wasCorrect]
    );
    for (const option of answer.chose) {
      await pool.query(
        `INSERT INTO public.answer_selections (answer_id, option_id) VALUES ($1, $2)`,
        [answerRow.rows[0].id, option.id]
      );
    }
  }
}

describe.skipIf(!online)("analytics (compute-on-read)", () => {
  let testbed: Testbed;
  let teacher: Teacher; // owns the quiz + class
  let peerTeacher: Teacher; // same school, but NOT the owner
  let quiz: Quiz;
  let classroom: Classroom;
  let singleQ: AuthoredQuestion; // the single-choice question (@100s)
  let multiQ: AuthoredQuestion; // the multi-choice question (@300s)

  beforeAll(async () => {
    testbed = await freshTestbed();
    const school = await testbed.createSchool("Analytics School");

    teacher = await school.enrollTeacher({ name: "Tara" });
    peerTeacher = await school.enrollTeacher({ name: "Pat" });
    const perfectScorer = await school.enrollStudent({ name: "Maya" });
    const halfScorer = await school.enrollStudent({ name: "Noa" });
    const nonFinisher = await school.enrollStudent({ name: "Omri" });

    // A two-question quiz: single-choice (one correct of four) + multi-choice
    // (two correct of three). Option texts double as their stable handles below.
    quiz = await teacher.authorQuiz({
      baseLanguage: "he",
      title: "Test Quiz",
      questions: [
        singleChoice({
          prompt: "Q1 prompt",
          at: 100,
          order: 0,
          correct: "O1a",
          distractors: ["O1b", "O1c", "O1d"],
        }),
        multiChoice({
          prompt: "Q2 prompt",
          at: 300,
          order: 1,
          correct: ["O2a", "O2b"],
          distractors: ["O2c"],
        }),
      ],
    });
    singleQ = quiz.questions[0];
    multiQ = quiz.questions[1];

    // The teacher retires distractor O1c. A historical anonymized attempt still
    // chose it (seeded below), so question_stats must keep reporting it.
    await teacher.removeOption(singleQ.optionByText("O1c"));

    classroom = await teacher.openClass({ name: "Test Class", language: "he" });
    await classroom.enroll(perfectScorer);
    await classroom.enroll(halfScorer);
    await classroom.enroll(nonFinisher);
    await teacher.assignQuiz(quiz, {
      to: classroom,
      tutor: "hints",
      maxAttempts: null,
    });

    // perfectScorer: completes 2/2 (both questions right).
    const perfectAttempt = await perfectScorer.startAttempt(quiz, { in: classroom });
    await perfectAttempt.answerCorrectly(singleQ); // picks O1a
    await perfectAttempt.answerCorrectly(multiQ); // picks O2a + O2b
    await perfectAttempt.complete();

    // halfScorer: completes 1/2 — wrong on Q1 (picks O1b), right on Q2.
    const halfAttempt = await halfScorer.startAttempt(quiz, { in: classroom });
    await halfAttempt.answer(singleQ, [singleQ.optionByText("O1b").id]);
    await halfAttempt.answerCorrectly(multiQ);
    await halfAttempt.complete();

    // nonFinisher: starts but never completes.
    await nonFinisher.startAttempt(quiz, { in: classroom });

    // Anonymized attempt: completed 0/2 — chose the soft-deleted O1c on Q1 and
    // the wrong O2c on Q2. Counts toward totals but carries no student.
    await seedAnonymizedCompletedAttempt({
      quiz,
      classroom,
      numCorrect: 0,
      numQuestions: 2,
      answers: [
        {
          question: singleQ,
          wasCorrect: false,
          chose: [singleQ.optionByText("O1c")],
        },
        {
          question: multiQ,
          wasCorrect: false,
          chose: [multiQ.optionByText("O2c")],
        },
      ],
    });

    // Tutor interactions.
    // A question was on screen (Q1) while perfectScorer asked -> flagged.
    await testbed.seed.logTutorQuestion({
      student: perfectScorer,
      classroom,
      quiz,
      duringAttempt: perfectAttempt,
      onQuestion: singleQ,
      positionSeconds: 100,
      prompt: "what is the answer?",
      aiResponse: "let's think about it",
    });
    // No question on screen while halfScorer asked -> not flagged.
    await testbed.seed.logTutorQuestion({
      student: halfScorer,
      classroom,
      quiz,
      positionSeconds: 50,
      prompt: "can you explain this part?",
      aiResponse: "sure",
    });
    // Anonymized student, Q2 on screen -> flagged.
    await testbed.seed.logTutorQuestion({
      student: null,
      classroom,
      quiz,
      onQuestion: multiQ,
      positionSeconds: 300,
      prompt: "just tell me",
      aiResponse: "I can help you reason",
    });
  }, 60_000);

  afterAll(async () => {
    await closePool();
  });

  // ── quiz_stats ────────────────────────────────────────────────────────────

  describe("quiz_stats", () => {
    it("counts attempts/completions and averages score (anonymized attempts count)", async () => {
      const stats = await teacher.quizStats(quiz);
      expect(stats.quiz_id).toBe(quiz.id);
      expect(stats.attempt_count).toBe(4); // perfect, half, nonFinisher, anonymized
      expect(stats.completion_count).toBe(3); // all but nonFinisher completed
      // (1.0 + 0.5 + 0.0) / 3 = 0.5 — the anonymized attempt still counts.
      expect(Number(stats.average_score)).toBeCloseTo(0.5, 6);
    });

    it("denies a non-owner teacher", async () => {
      await expect(peerTeacher.quizStats(quiz)).rejects.toBeInstanceOf(
        AnalyticsError
      );
    });
  });

  // ── question_stats ──────────────────────────────────────────────────────────

  describe("question_stats", () => {
    it("reports correct% and a distractor distribution including soft-deleted options", async () => {
      const report = await teacher.questionStats(quiz);
      expect(report.quiz_id).toBe(quiz.id);
      expect(report.base_language).toBe("he");
      expect(report.questions).toHaveLength(2);

      const single = report.questions.find((q) => q.question_id === singleQ.id)!;
      expect(single.kind).toBe("single");
      expect(single.prompt).toBe("Q1 prompt");
      expect(single.total_answers).toBe(3); // perfect, half, anonymized
      expect(single.correct_count).toBe(1); // only perfect
      expect(Number(single.correct_pct)).toBeCloseTo(1 / 3, 6);

      // The distribution must include the soft-deleted O1c with its selection.
      const optionOf = (option: QuizOption) =>
        single.options.find((o) => o.option_id === option.id)!;

      const o1c = optionOf(singleQ.optionByText("O1c"));
      expect(o1c).toBeDefined();
      expect(o1c.deleted).toBe(true);
      expect(o1c.selection_count).toBe(1); // chosen by the anonymized attempt

      const o1a = optionOf(singleQ.optionByText("O1a"));
      expect(o1a.is_correct).toBe(true);
      expect(o1a.selection_count).toBe(1); // chosen by perfect
      const o1b = optionOf(singleQ.optionByText("O1b"));
      expect(o1b.selection_count).toBe(1); // chosen by half
      const o1d = optionOf(singleQ.optionByText("O1d"));
      expect(o1d.selection_count).toBe(0);

      const multi = report.questions.find((q) => q.question_id === multiQ.id)!;
      expect(multi.kind).toBe("multi");
      expect(multi.total_answers).toBe(3);
      expect(multi.correct_count).toBe(2); // perfect, half
      const o2a = multi.options.find(
        (o) => o.option_id === multiQ.optionByText("O2a").id
      )!;
      expect(o2a.selection_count).toBe(2);
      const o2c = multi.options.find(
        (o) => o.option_id === multiQ.optionByText("O2c").id
      )!;
      expect(o2c.selection_count).toBe(1);
    });

    it("denies a non-owner teacher", async () => {
      await expect(peerTeacher.questionStats(quiz)).rejects.toBeInstanceOf(
        AnalyticsError
      );
    });
  });

  // ── class_stats ─────────────────────────────────────────────────────────────

  describe("class_stats", () => {
    it("reports attempt-based completion (anonymized counts) and roster-based coverage", async () => {
      const stats = await teacher.classStats(classroom);
      expect(stats.class_id).toBe(classroom.id);
      expect(stats.current_member_count).toBe(3); // perfect, half, nonFinisher

      expect(stats.quizzes).toHaveLength(1);
      const classQuiz = stats.quizzes[0];
      expect(classQuiz.quiz_id).toBe(quiz.id);
      expect(classQuiz.attempt_count).toBe(4);
      expect(classQuiz.completion_count).toBe(3); // attempt-based, includes anonymized
      expect(Number(classQuiz.average_score)).toBeCloseTo(0.5, 6);
      // Roster-based: only current members perfect & half completed (nonFinisher
      // didn't; the anonymized attempt has no member).
      expect(classQuiz.members_completed).toBe(2);
      expect(classQuiz.current_member_count).toBe(3);
    });

    it("denies a non-owner teacher", async () => {
      await expect(peerTeacher.classStats(classroom)).rejects.toBeInstanceOf(
        AnalyticsError
      );
    });
  });

  // ── tutor_stats ─────────────────────────────────────────────────────────────

  describe("tutor_stats", () => {
    it("counts tutor volume and flags likely answer-extraction attempts (quiz scope)", async () => {
      const stats = await teacher.tutorStats({ quiz });
      expect(stats.scope).toBe("quiz");
      expect(stats.total_questions).toBe(3);
      expect(stats.distinct_students).toBe(2); // perfect, half (anonymized excluded)
      expect(stats.anonymized_count).toBe(1); // the anonymized ask
      expect(stats.answer_extraction_count).toBe(2); // the two asks with a question on screen
      expect(stats.answer_extraction_attempts).toHaveLength(2);
      for (const row of stats.answer_extraction_attempts) {
        expect(row.question_id).not.toBeNull();
      }
    });

    it("works in class scope too", async () => {
      const stats = await teacher.tutorStats({ class: classroom });
      expect(stats.scope).toBe("class");
      expect(stats.total_questions).toBe(3);
      expect(stats.answer_extraction_count).toBe(2);
    });

    it("denies a non-owner teacher", async () => {
      await expect(peerTeacher.tutorStats({ quiz })).rejects.toBeInstanceOf(
        AnalyticsError
      );
    });
  });
});
