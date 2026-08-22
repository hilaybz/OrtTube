/**
 * The analytics hub's five new readers, end-to-end against a live local
 * Supabase: `teacher_analytics_search`, `class_analytics_overview`,
 * `student_analytics`, `quiz_analytics_overview` and `tutor_questions_page`
 * (migrations 141–145).
 *
 * These exist because the pre-hub surface could not answer the hub's questions:
 * a student was reachable only per class, a quiz had no cross-class rollup, the
 * tutor log had no paging, and nothing searched a teacher's own entities. So the
 * assertions here are mostly about the two things that make them trustworthy:
 *
 *   1. **Scope.** Every reader answers for the CALLER'S OWN entities and nothing
 *      else — a peer teacher in the same school is denied `not_owner`, and a
 *      student who belongs to a class the caller does not own is not "empty", it
 *      is denied.
 *   2. **One scoring basis.** Every score is each student's LATEST completed
 *      attempt — the grade that student is shown — so the class view, the student
 *      view, the quiz view and `class_quiz_analytics` cannot report different
 *      averages for the same work. The world below deliberately contains a
 *      retake whose first attempt is WORSE, which is what would expose a reader
 *      that quietly averaged best-of or every attempt.
 *
 * Told through the actor DSL: one school, one owning teacher with two classes and
 * two quizzes, one student in both classes, and a peer teacher who owns nothing.
 *
 * Skipped when the local stack is unreachable so unit suites still pass offline.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool } from "../helpers/db";
import {
  freshTestbed,
  singleChoice,
  type Classroom,
  type Quiz,
  type Student,
  type Teacher,
  type Testbed,
} from "../helpers/testbed";
import { AnalyticsError } from "@/lib/analytics";
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

/** Raw invoker for the bad-argument cases the typed wrappers cannot express. */
type RpcInvoker = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;

function twoQuestions(prefix: string) {
  return [
    singleChoice({
      prompt: `${prefix}-Q1`,
      at: 10,
      order: 0,
      correct: "A",
      distractors: ["B"],
    }),
    singleChoice({
      prompt: `${prefix}-Q2`,
      at: 20,
      order: 1,
      correct: "C",
      distractors: ["D"],
    }),
  ];
}

describe.skipIf(!online)("analytics hub readers", () => {
  let testbed: Testbed;
  let owner: Teacher;
  let peer: Teacher;
  let alpha: Classroom;
  let beta: Classroom;
  let quizOne: Quiz;
  let quizTwo: Quiz;
  let alice: Student;
  let bob: Student;
  let carol: Student;
  /** Enrolled in the peer teacher's class only — invisible to `owner`. */
  let stranger: Student;

  beforeAll(async () => {
    testbed = await freshTestbed();
    const school = await testbed.createSchool("Hub School");

    owner = await school.enrollTeacher({ name: "Ora" });
    peer = await school.enrollTeacher({ name: "Pini" });

    alice = await school.enrollStudent({ name: "Alice Adams" });
    bob = await school.enrollStudent({ name: "Bob Brown" });
    carol = await school.enrollStudent({ name: "Carol Clark" });
    stranger = await school.enrollStudent({ name: "Stan Stone" });

    quizOne = await owner.authorQuiz({
      baseLanguage: "he",
      title: "Photosynthesis",
      questions: twoQuestions("one"),
    });
    quizTwo = await owner.authorQuiz({
      baseLanguage: "he",
      title: "Respiration",
      questions: twoQuestions("two"),
    });

    alpha = await owner.openClass({ name: "Alpha", language: "he" });
    beta = await owner.openClass({ name: "Beta", language: "he" });
    await alpha.enroll(alice);
    await alpha.enroll(bob);
    await beta.enroll(alice);
    await beta.enroll(carol);

    // quizOne runs in both classes; quizTwo only in Alpha.
    await owner.assignQuiz(quizOne, { to: alpha, tutor: "hints", maxAttempts: null });
    await owner.assignQuiz(quizOne, { to: beta, tutor: "hints", maxAttempts: null });
    await owner.assignQuiz(quizTwo, { to: alpha, tutor: "hints", maxAttempts: null });

    const peerClass = await peer.openClass({ name: "Peer Class", language: "he" });
    await peerClass.enroll(stranger);

    const [q1a, q1b] = quizOne.questions;

    // Alice in Alpha: a FAILED first attempt, then a perfect retake. Only the
    // latest (2/2) may count anywhere.
    const aliceFirst = await alice.startAttempt(quizOne, { in: alpha });
    await aliceFirst.answer(q1a, [q1a.optionByText("B").id]);
    await aliceFirst.answer(q1b, [q1b.optionByText("D").id]);
    await aliceFirst.complete();
    const aliceRetake = await alice.startAttempt(quizOne, { in: alpha });
    await aliceRetake.answerAllCorrectly();
    await aliceRetake.complete();

    // Bob in Alpha: one attempt, half right.
    const bobAttempt = await bob.startAttempt(quizOne, { in: alpha });
    await bobAttempt.answerCorrectly(q1a);
    await bobAttempt.answer(q1b, [q1b.optionByText("D").id]);
    await bobAttempt.complete();

    // Alice in Beta, same quiz: half right — must stay out of Alpha's numbers.
    const aliceBeta = await alice.startAttempt(quizOne, { in: beta });
    await aliceBeta.answerCorrectly(q1a);
    await aliceBeta.answer(q1b, [q1b.optionByText("D").id]);
    await aliceBeta.complete();

    // Carol never attempts anything.

    await testbed.seed.logTutorQuestion({
      student: alice,
      classroom: alpha,
      quiz: quizOne,
      positionSeconds: 12,
      prompt: "why does the leaf turn yellow?",
      aiResponse: "let's think about chlorophyll",
      onQuestion: q1a, // flagged: asked while a question was on screen
    });
    await testbed.seed.logTutorQuestion({
      student: alice,
      classroom: alpha,
      quiz: quizOne,
      positionSeconds: 30,
      prompt: "can you explain the last part again?",
      aiResponse: "sure",
    });
    await testbed.seed.logTutorQuestion({
      student: bob,
      classroom: alpha,
      quiz: quizTwo,
      positionSeconds: 5,
      prompt: "what is respiration?",
      aiResponse: "here you go",
    });
  }, 120_000);

  afterAll(async () => {
    await closePool();
  });

  // ── teacher_analytics_search ──────────────────────────────────────────────

  describe("teacher_analytics_search", () => {
    it("lists the teacher's own classes, with roster and quiz counts", async () => {
      const result = await owner.searchAnalytics("class");
      expect(result.scope).toBe("class");
      expect(result.total).toBe(2);
      expect(result.results.map((r) => r.name)).toEqual(["Alpha", "Beta"]);

      const alphaHit = result.results.find((r) => r.id === alpha.id)!;
      expect(alphaHit.member_count).toBe(2);
      expect(alphaHit.quiz_count).toBe(2);
    });

    it("finds a student by partial name and reports the classes they are in", async () => {
      const result = await owner.searchAnalytics("student", { query: "ali" });
      expect(result.total).toBe(1);
      expect(result.results[0].id).toBe(alice.id);
      expect(result.results[0].class_count).toBe(2);
      expect(result.results[0].class_names).toBe("Alpha, Beta");
    });

    it("deduplicates a student who is in several of the teacher's classes", async () => {
      const result = await owner.searchAnalytics("student");
      // Alice, Bob, Carol — once each. Stan is in nobody's class but the peer's.
      expect(result.total).toBe(3);
      expect(result.results.filter((r) => r.id === alice.id)).toHaveLength(1);
      expect(result.results.map((r) => r.id)).not.toContain(stranger.id);
    });

    it("finds authored quizzes and counts the classes each is assigned to", async () => {
      const result = await owner.searchAnalytics("quiz", { query: "photo" });
      expect(result.total).toBe(1);
      expect(result.results[0].id).toBe(quizOne.id);
      expect(result.results[0].class_count).toBe(2);
      expect(result.results[0].question_count).toBe(2);
    });

    it("pages with a stable total", async () => {
      const first = await owner.searchAnalytics("student", { limit: 2, offset: 0 });
      const second = await owner.searchAnalytics("student", { limit: 2, offset: 2 });
      expect(first.total).toBe(3);
      expect(second.total).toBe(3);
      expect(first.results).toHaveLength(2);
      expect(second.results).toHaveLength(1);
      const ids = [...first.results, ...second.results].map((r) => r.id);
      expect(new Set(ids).size).toBe(3);
    });

    it("shows a peer teacher only their own entities", async () => {
      const classes = await peer.searchAnalytics("class");
      expect(classes.total).toBe(1);
      const quizzes = await peer.searchAnalytics("quiz");
      expect(quizzes.total).toBe(0);
      const students = await peer.searchAnalytics("student");
      expect(students.results.map((r) => r.id)).toEqual([stranger.id]);
    });

    it("rejects an unknown scope with invalid_args", async () => {
      const rpc = owner.client.rpc.bind(owner.client) as unknown as RpcInvoker;
      const { error } = await rpc("teacher_analytics_search", {
        p_scope: "teacher",
        p_query: null,
        p_limit: 10,
        p_offset: 0,
      });
      expect(error?.code).toBe("22023");
    });

    it("treats LIKE metacharacters in the query as literal text", async () => {
      const result = await owner.searchAnalytics("class", { query: "%" });
      expect(result.total).toBe(0);
    });
  });

  // ── class_analytics_overview ──────────────────────────────────────────────

  describe("class_analytics_overview", () => {
    it("scores each quiz from the student's latest attempt, not their best or all", async () => {
      const overview = await owner.classAnalytics(alpha);
      expect(overview.member_count).toBe(2);
      expect(overview.quiz_count).toBe(2);

      const one = overview.quizzes.find((q) => q.quiz_id === quizOne.id)!;
      // Alice's LATEST is 2/2 (her first attempt was 0/2); Bob's is 1/2.
      expect(Number(one.average_score)).toBeCloseTo(0.75, 6);
      expect(one.students_completed).toBe(2);
      expect(one.members_completed).toBe(2);
      expect(one.member_count).toBe(2);
      expect(one.question_count).toBe(2);

      const two = overview.quizzes.find((q) => q.quiz_id === quizTwo.id)!;
      expect(two.average_score).toBeNull();
      expect(two.members_completed).toBe(0);
    });

    it("keeps another class's attempts out of this class's numbers", async () => {
      const betaOverview = await owner.classAnalytics(beta);
      expect(betaOverview.member_count).toBe(2); // alice + carol
      const one = betaOverview.quizzes.find((q) => q.quiz_id === quizOne.id)!;
      // Only Alice's Beta attempt (1/2) counts here.
      expect(Number(one.average_score)).toBeCloseTo(0.5, 6);
      expect(one.students_completed).toBe(1);
    });

    it("distributes the counted results into five bands, all present", async () => {
      const overview = await owner.classAnalytics(alpha);
      expect(overview.score_distribution).toHaveLength(5);
      const counts = overview.score_distribution.map((b) => b.count);
      // Alice 2/2 -> top band; Bob 1/2 -> the 40–60% band. No phantom 6th band.
      expect(counts[4]).toBe(1);
      expect(counts[2]).toBe(1);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
    });

    it("reports the lifecycle fields the UI derives open/finished from", async () => {
      const overview = await owner.classAnalytics(alpha);
      for (const quiz of overview.quizzes) {
        expect(quiz.published).toBe(true);
        expect(quiz).toHaveProperty("available_from");
        expect(quiz).toHaveProperty("available_until");
      }
    });

    it("counts completions per day and tutor questions for the class", async () => {
      const overview = await owner.classAnalytics(alpha);
      const completions = overview.completions.reduce((sum, d) => sum + d.count, 0);
      // Alice's two attempts + Bob's one, all completed today.
      expect(completions).toBe(3);
      expect(overview.tutor_question_count).toBe(3);
    });

    it("denies a peer teacher (not_owner)", async () => {
      await expect(peer.classAnalytics(alpha)).rejects.toBeInstanceOf(AnalyticsError);
      await expect(peer.classAnalytics(alpha)).rejects.toMatchObject({
        code: "not_owner",
      });
    });
  });

  // ── student_analytics ────────────────────────────────────────────────────

  describe("student_analytics", () => {
    it("spans every class the caller owns that the student is in", async () => {
      const data = await owner.studentAnalytics(alice);
      expect(data.student_id).toBe(alice.id);
      expect(data.summary.class_count).toBe(2);
      expect(data.classes.map((c) => c.name)).toEqual(["Alpha", "Beta"]);
      // quizOne in Alpha + quizOne in Beta + quizTwo in Alpha.
      expect(data.quizzes).toHaveLength(3);
    });

    it("reports the grade the student was shown, beside their class's average", async () => {
      const data = await owner.studentAnalytics(alice);
      const inAlpha = data.quizzes.find(
        (q) => q.quiz_id === quizOne.id && q.class_id === alpha.id
      )!;
      expect(Number(inAlpha.latest_score)).toBeCloseTo(1, 6);
      expect(Number(inAlpha.best_score)).toBeCloseTo(1, 6);
      expect(Number(inAlpha.class_average_score)).toBeCloseTo(0.75, 6);
      expect(inAlpha.attempt_count).toBe(2);
      expect(inAlpha.completed).toBe(true);

      const inBeta = data.quizzes.find(
        (q) => q.quiz_id === quizOne.id && q.class_id === beta.id
      )!;
      expect(Number(inBeta.latest_score)).toBeCloseTo(0.5, 6);
      expect(Number(inBeta.class_average_score)).toBeCloseTo(0.5, 6);

      const untouched = data.quizzes.find((q) => q.quiz_id === quizTwo.id)!;
      expect(untouched.completed).toBe(false);
      expect(untouched.latest_score).toBeNull();
    });

    it("summarises the student against their peers on the same work", async () => {
      const data = await owner.studentAnalytics(alice);
      // Alice's latest attempts: 2/2 in Alpha and 1/2 in Beta -> 0.75.
      expect(Number(data.summary.average_score)).toBeCloseTo(0.75, 6);
      // Everyone else in those classes: only Bob's 1/2.
      expect(Number(data.summary.peer_average_score)).toBeCloseTo(0.5, 6);
      expect(data.summary.quizzes_completed).toBe(2);
      expect(data.summary.total_assigned).toBe(3);
      expect(data.summary.tutor_question_count).toBe(2);
    });

    it("reports a student with no attempts as assigned-but-unfinished", async () => {
      const data = await owner.studentAnalytics(carol);
      expect(data.summary.class_count).toBe(1);
      expect(data.summary.quizzes_completed).toBe(0);
      expect(data.summary.average_score).toBeNull();
      expect(data.quizzes.every((q) => !q.completed)).toBe(true);
    });

    it("denies a student who is in none of the caller's classes (not_owner)", async () => {
      await expect(owner.studentAnalytics(stranger)).rejects.toMatchObject({
        code: "not_owner",
      });
      await expect(peer.studentAnalytics(alice)).rejects.toMatchObject({
        code: "not_owner",
      });
    });

    it("denies an unknown uuid with the same not_owner, never a different error", async () => {
      await expect(
        owner.studentAnalytics("00000000-0000-0000-0000-000000000000")
      ).rejects.toMatchObject({ code: "not_owner" });
    });
  });

  // ── quiz_analytics_overview ──────────────────────────────────────────────

  describe("quiz_analytics_overview", () => {
    it("rolls the quiz up across every class it runs in", async () => {
      const data = await owner.quizAnalytics(quizOne);
      expect(data.title).toBe("Photosynthesis");
      expect(data.summary.class_count).toBe(2);
      // Alpha (alice, bob) + Beta (alice, carol).
      expect(data.summary.member_count).toBe(4);
      // One counted attempt each for alice@Alpha, bob@Alpha, alice@Beta.
      expect(data.summary.students_completed).toBe(3);
      expect(Number(data.summary.average_score)).toBeCloseTo((1 + 0.5 + 0.5) / 3, 6);
      expect(data.summary.question_count).toBe(2);
      expect(data.summary.tutor_question_count).toBe(2);
    });

    it("keeps the same student's two classes as two separate results", async () => {
      const data = await owner.quizAnalytics(quizOne);
      const alphaRow = data.classes.find((c) => c.class_id === alpha.id)!;
      const betaRow = data.classes.find((c) => c.class_id === beta.id)!;
      expect(alphaRow.students_completed).toBe(2);
      expect(Number(alphaRow.average_score)).toBeCloseTo(0.75, 6);
      expect(betaRow.students_completed).toBe(1);
      expect(Number(betaRow.average_score)).toBeCloseTo(0.5, 6);
      expect(alphaRow.is_own_class).toBe(true);
    });

    it("reports per-question difficulty in question order", async () => {
      const data = await owner.quizAnalytics(quizOne);
      expect(data.questions).toHaveLength(2);
      const [first, second] = data.questions;
      expect(first.order_index).toBeLessThan(second.order_index);
      // Q1: alice (retake) + bob + alice@Beta all correct -> 100%.
      expect(Number(first.correct_pct)).toBeCloseTo(1, 6);
      // Q2: only alice's retake was correct, of three answers.
      expect(Number(second.correct_pct)).toBeCloseTo(1 / 3, 6);
      expect(first.tutor_question_count).toBe(1);
    });

    it("reports an unassigned quiz as assigned nowhere rather than failing", async () => {
      const orphan = await owner.authorQuiz({
        baseLanguage: "he",
        title: "Unassigned",
        questions: twoQuestions("orphan"),
      });
      const data = await owner.quizAnalytics(orphan);
      expect(data.summary.class_count).toBe(0);
      expect(data.classes).toEqual([]);
      expect(data.summary.average_score).toBeNull();
      expect(data.score_distribution).toHaveLength(5);
    });

    it("denies a teacher who did not author the quiz (not_owner)", async () => {
      await expect(peer.quizAnalytics(quizOne)).rejects.toMatchObject({
        code: "not_owner",
      });
    });
  });

  // ── tutor_questions_page ─────────────────────────────────────────────────

  describe("tutor_questions_page", () => {
    it("returns one student's questions, attributed and flagged", async () => {
      const page = await owner.tutorQuestions({ student: alice });
      expect(page.total).toBe(2);
      expect(page.flagged_count).toBe(1);
      expect(page.rows).toHaveLength(2);
      expect(page.rows.every((r) => r.student_id === alice.id)).toBe(true);
      const flagged = page.rows.find((r) => r.flagged)!;
      expect(flagged.question_id).not.toBeNull();
      expect(flagged.question_prompt).toBe("one-Q1");
      expect(flagged.quiz_title).toBe("Photosynthesis");
      expect(flagged.class_name).toBe("Alpha");
    });

    it("offers only filters that have rows in the scope", async () => {
      const classScope = await owner.tutorQuestions({ classroom: alpha });
      expect(classScope.total).toBe(3);
      expect(classScope.quiz_filters.map((f) => f.quiz_id).sort()).toEqual(
        [quizOne.id, quizTwo.id].sort()
      );
      const forQuizOne = classScope.quiz_filters.find(
        (f) => f.quiz_id === quizOne.id
      )!;
      expect(forQuizOne.count).toBe(2);
    });

    it("intersects the scopes it is given", async () => {
      const both = await owner.tutorQuestions({ student: alice, quiz: quizOne });
      expect(both.total).toBe(2);
      const other = await owner.tutorQuestions({ student: alice, quiz: quizTwo });
      expect(other.total).toBe(0);
      expect(other.rows).toEqual([]);
    });

    it("pages newest first with a stable total", async () => {
      const first = await owner.tutorQuestions({ classroom: alpha }, { limit: 2 });
      const second = await owner.tutorQuestions(
        { classroom: alpha },
        { limit: 2, offset: 2 }
      );
      expect(first.total).toBe(3);
      expect(second.total).toBe(3);
      expect(first.rows).toHaveLength(2);
      expect(second.rows).toHaveLength(1);
      const times = [...first.rows, ...second.rows].map((r) =>
        new Date(r.created_at).getTime()
      );
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it("requires at least one scope (invalid_args)", async () => {
      const rpc = owner.client.rpc.bind(owner.client) as unknown as RpcInvoker;
      const { error } = await rpc("tutor_questions_page", {
        p_student_id: null,
        p_quiz_id: null,
        p_class_id: null,
        p_limit: 10,
        p_offset: 0,
      });
      expect(error?.code).toBe("22023");
    });

    it("denies every scope the caller does not own", async () => {
      await expect(peer.tutorQuestions({ classroom: alpha })).rejects.toMatchObject({
        code: "not_owner",
      });
      await expect(peer.tutorQuestions({ quiz: quizOne })).rejects.toMatchObject({
        code: "not_owner",
      });
      await expect(peer.tutorQuestions({ student: alice })).rejects.toMatchObject({
        code: "not_owner",
      });
    });
  });
});
