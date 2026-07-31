/**
 * Tutor-prompts (topic-cluster feed) integration tests — the owner-checked
 * `tutor_prompts_in_scope` RPC read, end-to-end against a live local Supabase
 * with the v2 schema applied.
 *
 * This exercises only the DB read (`fetchTutorPrompts`), NOT the AI clustering
 * step, so no Claude call is ever made. Told through the actor DSL: a teacher
 * authors two quizzes and assigns both to a class; students' tutor prompts are
 * seeded on one quiz (the other is left promptless for the empty-scope case).
 *
 * Coverage:
 *   - owner sees the prompts in scope (quiz + class);
 *   - a promptless scope returns an empty prompt list;
 *   - a non-owner teacher is denied (`not_owner`, SQLSTATE 42501);
 *   - passing both scopes or neither raises `invalid_args` (SQLSTATE 22023).
 *
 * Skipped when the local DB is unreachable so unit suites still pass offline.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPool, closePool } from "../helpers/db";
import {
  freshTestbed,
  singleChoice,
  type Testbed,
  type Teacher,
  type Student,
  type Classroom,
  type Quiz,
} from "../helpers/testbed";
import { AnalyticsError } from "@/lib/analytics";
import { fetchTutorPrompts } from "@/lib/analyticsTopics";

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
const online = await dbReachable();

// Raw RPC invoker for the bad-scope cases (both/neither), which `fetchTutorPrompts`
// cannot express — it always sends exactly one scope. Mirrors the un-parameterised
// `.rpc` cast used in `lib/analyticsTopics.ts`.
type RpcInvoker = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;

describe.skipIf(!online)("tutor prompts in scope (topic-cluster feed)", () => {
  let teacher: Teacher; // owns the class + quizzes
  let peerTeacher: Teacher; // same school, NOT the owner
  let alice: Student;
  let classroom: Classroom;
  let quizWithPrompts: Quiz; // has seeded tutor prompts
  let quizEmpty: Quiz; // assigned but no prompts

  beforeEach(async () => {
    const testbed: Testbed = await freshTestbed();
    const school = await testbed.createSchool("Topics School");

    teacher = await school.enrollTeacher({ name: "Tara" });
    peerTeacher = await school.enrollTeacher({ name: "Pat" });
    alice = await school.enrollStudent({ name: "Alice" });

    quizWithPrompts = await teacher.authorQuiz({
      baseLanguage: "he",
      title: "Quiz A",
      questions: [
        singleChoice({ prompt: "A-Q1", at: 100, order: 0, correct: "A1a", distractors: ["A1b"] }),
      ],
    });

    quizEmpty = await teacher.authorQuiz({
      baseLanguage: "he",
      title: "Quiz B",
      questions: [
        singleChoice({ prompt: "B-Q1", at: 100, order: 0, correct: "B1a", distractors: ["B1b"] }),
      ],
    });

    classroom = await teacher.openClass({ name: "Class", language: "he" });
    await classroom.enroll(alice);
    await teacher.assignQuiz(quizWithPrompts, { to: classroom, tutor: "hints", maxAttempts: null });
    await teacher.assignQuiz(quizEmpty, { to: classroom, tutor: "hints", maxAttempts: null });

    // Two prompts on Quiz A (one named-student, one anonymized); none on Quiz B.
    await testbed.seed.logTutorQuestion({
      student: alice,
      classroom,
      quiz: quizWithPrompts,
      positionSeconds: 50,
      prompt: "can you explain this part?",
      aiResponse: "sure",
    });
    await testbed.seed.logTutorQuestion({
      student: null,
      classroom,
      quiz: quizWithPrompts,
      positionSeconds: 80,
      prompt: "what does this word mean?",
      aiResponse: "let's reason about it",
    });
  }, 60_000);

  afterAll(async () => {
    await closePool();
  });

  it("returns the prompts in scope for the owner (quiz scope)", async () => {
    const result = await fetchTutorPrompts(teacher.client, { quizId: quizWithPrompts.id });
    expect(result.scope).toBe("quiz");
    expect(result.prompts).toHaveLength(2);
    expect(new Set(result.prompts.map((p) => p.prompt))).toEqual(
      new Set(["can you explain this part?", "what does this word mean?"])
    );
  });

  it("returns the prompts in scope for the owner (class scope)", async () => {
    const result = await fetchTutorPrompts(teacher.client, { classId: classroom.id });
    expect(result.scope).toBe("class");
    expect(result.prompts).toHaveLength(2);
  });

  it("returns an empty prompt list for a promptless scope", async () => {
    const result = await fetchTutorPrompts(teacher.client, { quizId: quizEmpty.id });
    expect(result.scope).toBe("quiz");
    expect(result.prompts).toEqual([]);
  });

  it("denies a non-owner teacher (not_owner)", async () => {
    await expect(
      fetchTutorPrompts(peerTeacher.client, { quizId: quizWithPrompts.id })
    ).rejects.toBeInstanceOf(AnalyticsError);
    await expect(
      fetchTutorPrompts(peerTeacher.client, { quizId: quizWithPrompts.id })
    ).rejects.toMatchObject({ code: "not_owner" });
  });

  it("rejects both scopes or neither with invalid_args", async () => {
    const rpc = teacher.client.rpc.bind(teacher.client) as unknown as RpcInvoker;

    const both = await rpc("tutor_prompts_in_scope", {
      p_quiz_id: quizWithPrompts.id,
      p_class_id: classroom.id,
    });
    expect(both.error?.code).toBe("22023");

    const neither = await rpc("tutor_prompts_in_scope", {
      p_quiz_id: null,
      p_class_id: null,
    });
    expect(neither.error?.code).toBe("22023");
  });
});
