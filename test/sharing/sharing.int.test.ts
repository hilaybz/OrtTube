/**
 * Sharing integration tests — the shared catalog (`list_shared_quizzes`) and
 * deep-copy cloning (`clone_quiz`) (spec §3.4, decision 13).
 *
 * Every action runs through an actor's AUTHENTICATED (RLS-subject) client via the
 * actor DSL (`test/helpers/testbed.ts`), so each RPC's `auth.uid()` gate is real.
 * Covers: the same-school shared browse surface, teacher-only visibility, deep-copy
 * clone (questions/options/translations, cloned_from_id, reused video, private
 * visibility), soft-deleted rows excluded, attempts/answers not copied,
 * owner-clones-own-private, and cross-school denial.
 *
 * Runs at the integration/gate step (owns DB application). Skipped when the local
 * DB is unreachable so unit suites still pass without Supabase running.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPool, closePool } from "../helpers/db";
import { QuizError } from "@/lib/quiz";
import {
  freshTestbed,
  singleChoice,
  question,
  type Testbed,
  type School,
  type Teacher,
  type Student,
  type Quiz,
  type AuthoredQuestion,
  type Actor,
  type SharedQuizRow,
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

// ── Actor-agnostic RPC helpers ────────────────────────────────────────────────
// The DSL exposes `sharedQuizzes()` / `clone()` only on Teacher (the only role
// allowed to use them). These thin helpers run the same RPCs as ANY actor so the
// teacher-only visibility and student-denial paths stay expressible as a story.

/** Read the shared catalog as any actor (students must get an empty list). */
async function sharedListAs(actor: Actor): Promise<SharedQuizRow[]> {
  const { data, error } = await actor.client.rpc("list_shared_quizzes", {});
  if (error) throw new QuizError(error.message);
  return (data as unknown as SharedQuizRow[]) ?? [];
}

/** Attempt to clone as any actor, surfacing the RPC's stable rejection code. */
async function cloneAs(actor: Actor, source: Quiz): Promise<void> {
  const { error } = await actor.client.rpc("clone_quiz", {
    p_source_quiz_id: source.id,
  });
  if (error) throw new QuizError(error.message);
}

// ── Out-of-band structural reads (assert the deep copy) ───────────────────────
// The DSL cannot surface a freshly-cloned quiz's raw structure, so these read it
// directly for assertions only — never to drive the system under test.

async function videoCount(videoId: string): Promise<number> {
  const res = await getPool().query<{ n: number }>(
    "SELECT count(*)::int AS n FROM public.videos WHERE id=$1",
    [videoId]
  );
  return res.rows[0].n;
}

async function questionsOf(
  quizId: string
): Promise<Array<{ id: string; kind: string; position_seconds: number }>> {
  const res = await getPool().query<{
    id: string;
    kind: string;
    position_seconds: number;
  }>("SELECT id, kind, position_seconds FROM public.questions WHERE quiz_id=$1", [
    quizId,
  ]);
  return res.rows;
}

async function questionTranslationsOf(
  questionId: string
): Promise<Array<{ language: string; prompt: string; source: string }>> {
  const res = await getPool().query<{
    language: string;
    prompt: string;
    source: string;
  }>(
    "SELECT language, prompt, source FROM public.question_translations WHERE question_id=$1 ORDER BY language",
    [questionId]
  );
  return res.rows;
}

async function liveOptionsOf(
  questionId: string
): Promise<Array<{ id: string; is_correct: boolean }>> {
  const res = await getPool().query<{ id: string; is_correct: boolean }>(
    "SELECT id, is_correct FROM public.question_options WHERE question_id=$1 ORDER BY order_index",
    [questionId]
  );
  return res.rows;
}

async function optionTranslationCountOf(questionId: string): Promise<number> {
  const res = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.option_translations ot
       JOIN public.question_options qo ON qo.id = ot.option_id
      WHERE qo.question_id=$1`,
    [questionId]
  );
  return res.rows[0].n;
}

/**
 * Append one extra (later soft-deletable) option to a live question via upsert
 * merge, returning the new option's id. `upsert_question` merges by option_id, so
 * we re-pass the existing options (with their ids) untouched plus the new one;
 * omitting the ids would append duplicates and break the single-correct guard.
 */
async function appendExtraOption(
  teacher: Teacher,
  quiz: Quiz,
  target: AuthoredQuestion,
  spec: {
    kind: "single" | "multi";
    positionSeconds: number;
    orderIndex: number;
    basePrompt: string;
    baseExplanation: string | null;
    text: string;
  }
): Promise<string> {
  const keptOptions = target.options.map((o) => ({
    option_id: o.id,
    is_correct: o.isCorrect,
    order_index: o.orderIndex,
    base_text: o.baseText,
  }));
  const appendedIndex = keptOptions.length;
  const { error } = await teacher.client.rpc("upsert_question", {
    p_quiz_id: quiz.id,
    p_question_id: target.id,
    p_kind: spec.kind,
    p_position_seconds: spec.positionSeconds,
    p_order_index: spec.orderIndex,
    p_base_prompt: spec.basePrompt,
    p_base_explanation: spec.baseExplanation,
    p_options: [
      ...keptOptions,
      { is_correct: false, order_index: appendedIndex, base_text: spec.text },
    ],
    p_source: "authored",
  });
  if (error) throw new Error(`append option failed: ${error.message}`);
  const res = await getPool().query<{ id: string }>(
    "SELECT id FROM public.question_options WHERE question_id=$1 AND order_index=$2",
    [target.id, appendedIndex]
  );
  return res.rows[0].id;
}

describe.skipIf(!online)("sharing & clone RPCs", () => {
  let testbed: Testbed;
  let lincoln: School;
  let teacher: Teacher;
  let student: Student;

  beforeEach(async () => {
    testbed = await freshTestbed();
    lincoln = await testbed.createSchool("Lincoln High");
    teacher = await lincoln.enrollTeacher({ name: "Ada" });
    student = await lincoln.enrollStudent({ name: "Ben" });
  });

  afterAll(async () => {
    await closePool();
  });

  /** Author a quiz owned by `author` with one single-choice question. */
  function authorQuizWithQuestion(
    author: Teacher,
    opts: { title?: string; baseLanguage?: "he" | "en" } = {}
  ): Promise<Quiz> {
    return author.authorQuiz({
      baseLanguage: opts.baseLanguage ?? "he",
      title: opts.title ?? "Shared Quiz",
      questions: [
        singleChoice({
          prompt: "What is X?",
          at: 42,
          explanation: "Because Y.",
          correct: "option 1",
          distractors: ["option 0", "option 2", "option 3"],
        }),
      ],
    });
  }

  // ── list_shared_quizzes ─────────────────────────────────────────────────────

  it("list_shared_quizzes returns same-school shared quizzes; excludes private", async () => {
    const shared = await authorQuizWithQuestion(teacher, { title: "Public One" });
    await shared.makeShared();
    await authorQuizWithQuestion(teacher, { title: "Private One" }); // stays private

    const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });

    const catalog = await peerTeacher.sharedQuizzes();
    const ids = catalog.map((row) => row.quiz_id);
    expect(ids).toContain(shared.id);
    expect(catalog.every((row) => row.visibility === "shared")).toBe(true);
    // A peer teacher sees it as not-own.
    expect(catalog.find((row) => row.quiz_id === shared.id)!.is_own).toBe(false);
  });

  it("list_shared_quizzes hides soft-deleted shared quizzes", async () => {
    const shared = await authorQuizWithQuestion(teacher);
    await shared.makeShared();
    await shared.softDelete();

    const catalog = await teacher.sharedQuizzes();
    expect(catalog.map((row) => row.quiz_id)).not.toContain(shared.id);
  });

  it("students get an empty shared list (teacher-only reads)", async () => {
    const shared = await authorQuizWithQuestion(teacher);
    await shared.makeShared();

    const catalog = await sharedListAs(student);
    expect(catalog).toHaveLength(0);
  });

  it("a different school does not see another school's shared quizzes", async () => {
    const shared = await authorQuizWithQuestion(teacher);
    await shared.makeShared();

    const otherSchool = await testbed.createSchool("School B");
    const otherSchoolTeacher = await otherSchool.enrollTeacher({ name: "Rhea" });

    const catalog = await otherSchoolTeacher.sharedQuizzes();
    expect(catalog.map((row) => row.quiz_id)).not.toContain(shared.id);
  });

  // ── clone_quiz ──────────────────────────────────────────────────────────────

  it("a same-school teacher deep-clones a shared quiz into a private copy", async () => {
    // Author the source with a question carrying both base (he) and an extra
    // target-language (en) translation on the prompt and every option, so we can
    // assert the clone copies the full translation set.
    const source = await teacher.authorQuiz({
      baseLanguage: "he",
      title: "Original",
      questions: [
        question({
          kind: "single",
          prompt: "What is X?",
          at: 42,
          explanation: "Because Y.",
          options: [
            { text: "option 0", correct: false },
            { text: "option 1", correct: true },
            { text: "option 2", correct: false },
            { text: "option 3", correct: false },
          ],
          promptLangs: { en: "What is X? (en)" },
          optionLangs: {
            "option 0": { en: "option 0 (en)" },
            "option 1": { en: "option 1 (en)" },
            "option 2": { en: "option 2 (en)" },
            "option 3": { en: "option 3 (en)" },
          },
        }),
      ],
    });
    await source.makeShared();
    const [sourceQuestion] = source.questions;

    const cloner = await lincoln.enrollTeacher({ name: "Grace" });
    const clone = await cloner.clone(source);
    expect(clone.id).not.toBe(source.id);

    // New quiz: owned by the cloner, private, cloned_from_id set, SAME video reused.
    expect(await testbed.db.quizRow(clone)).toMatchObject({
      author_id: cloner.id,
      video_id: source.videoId,
      visibility: "private",
      cloned_from_id: source.id,
      base_language: "he",
      title: "Original",
      school_id: lincoln.id,
    });

    // Video reused, not duplicated.
    expect(await videoCount(source.videoId!)).toBe(1);

    // One question copied, with a NEW id.
    const clonedQuestions = await questionsOf(clone.id);
    expect(clonedQuestions).toHaveLength(1);
    const clonedQuestion = clonedQuestions[0];
    expect(clonedQuestion.id).not.toBe(sourceQuestion.id);
    expect(clonedQuestion).toMatchObject({ kind: "single", position_seconds: 42 });

    // Question translations copied for BOTH languages.
    const clonedTranslations = await questionTranslationsOf(clonedQuestion.id);
    expect(clonedTranslations.map((t) => t.language)).toEqual(["en", "he"]);
    expect(clonedTranslations.find((t) => t.language === "en")!.prompt).toBe(
      "What is X? (en)"
    );

    // Options copied (4), exactly one correct, with NEW ids + their translations.
    const clonedOptions = await liveOptionsOf(clonedQuestion.id);
    expect(clonedOptions).toHaveLength(4);
    expect(clonedOptions.filter((o) => o.is_correct)).toHaveLength(1);
    const sourceOptionIds = new Set(sourceQuestion.options.map((o) => o.id));
    expect(clonedOptions.every((o) => !sourceOptionIds.has(o.id))).toBe(true);

    // 4 options × 2 languages (he + en).
    expect(await optionTranslationCountOf(clonedQuestion.id)).toBe(8);
  });

  it("clone copies only NON-DELETED questions and options", async () => {
    const source = await authorQuizWithQuestion(teacher);
    await source.makeShared();
    const [mainQuestion] = source.questions;

    // Add a second question then soft-delete it → must not be cloned.
    const doomedQuestion = await teacher.addQuestion(
      source,
      singleChoice({
        prompt: "gone?",
        at: 100,
        order: 1,
        correct: "keep",
        distractors: ["a", "b", "c"],
      })
    );
    await doomedQuestion.softDelete();

    // Add a 5th option to the FIRST question then soft-delete it (a wrong one).
    const doomedOptionId = await appendExtraOption(teacher, source, mainQuestion, {
      kind: "single",
      positionSeconds: 42,
      orderIndex: 0,
      basePrompt: "What is X?",
      baseExplanation: "Because Y.",
      text: "option 4 (to delete)",
    });
    await teacher.removeOption(doomedOptionId);

    const clone = await teacher.clone(source);

    // Only the one live question is cloned.
    const clonedQuestions = await questionsOf(clone.id);
    expect(clonedQuestions).toHaveLength(1);
    // Only 4 live options cloned (the soft-deleted 5th is dropped).
    expect(await liveOptionsOf(clonedQuestions[0].id)).toHaveLength(4);
  });

  it("clone does NOT copy attempts/answers (clean copy)", async () => {
    const source = await authorQuizWithQuestion(teacher);
    await source.makeShared();

    // Give the source a real attempt: assign it to a class the student is in.
    const biology = await teacher.openClass({ name: "Biology", language: "he" });
    await biology.enroll(student);
    await teacher.assignQuiz(source, { to: biology });
    await student.startAttempt(source, { in: biology });
    expect(await testbed.db.attemptCount(source)).toBe(1);

    const clone = await teacher.clone(source);
    expect(await testbed.db.attemptCount(clone)).toBe(0);
  });

  it("an owner can clone their OWN private quiz", async () => {
    const source = await authorQuizWithQuestion(teacher); // stays private
    const clone = await teacher.clone(source);
    expect(await testbed.db.quizRow(clone)).toMatchObject({
      cloned_from_id: source.id,
      visibility: "private",
    });
  });

  it("a non-same-school teacher cannot read or clone a shared quiz", async () => {
    const source = await authorQuizWithQuestion(teacher);
    await source.makeShared();

    const otherSchool = await testbed.createSchool("School C");
    const otherSchoolTeacher = await otherSchool.enrollTeacher({ name: "Rhea" });

    await expect(otherSchoolTeacher.clone(source)).rejects.toThrow("not_authorized");
  });

  it("a same-school teacher cannot clone another teacher's PRIVATE quiz", async () => {
    const source = await authorQuizWithQuestion(teacher); // stays private
    const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });

    await expect(peerTeacher.clone(source)).rejects.toThrow("not_authorized");
  });

  it("a student cannot clone (not_authorized)", async () => {
    const source = await authorQuizWithQuestion(teacher);
    await source.makeShared();

    await expect(cloneAs(student, source)).rejects.toThrow("not_authorized");
  });

  it("clone_quiz raises quiz_not_found / quiz_deleted", async () => {
    await expect(
      teacher.clone("00000000-0000-0000-0000-000000000000")
    ).rejects.toThrow("quiz_not_found");

    const source = await authorQuizWithQuestion(teacher);
    await source.softDelete();
    await expect(teacher.clone(source)).rejects.toThrow("quiz_deleted");
  });
});
