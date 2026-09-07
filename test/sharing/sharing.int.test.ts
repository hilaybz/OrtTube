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
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

async function sharedListAs(actor: Actor): Promise<SharedQuizRow[]> {
  const { data, error } = await actor.client.rpc("list_shared_quizzes", {});
  if (error) throw new QuizError(error.message);
  return (data as unknown as SharedQuizRow[]) ?? [];
}

async function cloneAs(actor: Actor, source: Quiz): Promise<void> {
  const { error } = await actor.client.rpc("clone_quiz", {
    p_source_quiz_id: source.id,
  });
  if (error) throw new QuizError(error.message);
}

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

  it("list_shared_quizzes returns same-school shared quizzes; excludes private", async () => {
    const shared = await authorQuizWithQuestion(teacher, { title: "Public One" });
    await shared.makeShared();
    await authorQuizWithQuestion(teacher, { title: "Private One" });

    const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });

    const catalog = await peerTeacher.sharedQuizzes();
    const ids = catalog.map((row) => row.quiz_id);
    expect(ids).toContain(shared.id);
    expect(catalog.every((row) => row.visibility === "shared")).toBe(true);
    expect(catalog.find((row) => row.quiz_id === shared.id)!.is_own).toBe(false);
  });

  it("list_shared_quizzes carries the quiz's duration fields (issue #80)", async () => {
    const shared = await authorQuizWithQuestion(teacher, { title: "Timed & Shared" });
    await shared.makeShared();
    await teacher.client.rpc("update_quiz", {
      p_quiz_id: shared.id,
      p_time_restricted: true,
      p_duration_minutes: 8,
    });

    const peerTeacher = await lincoln.enrollTeacher({ name: "Iris" });
    const row = (await peerTeacher.sharedQuizzes()).find((r) => r.quiz_id === shared.id)!;
    expect(row.time_restricted).toBe(true);
    expect(row.duration_minutes).toBe(8);
    // `authorQuiz`'s fixture always sets p_duration_seconds: 600 — a null
    // video length (the real-world failure case) is covered by
    // classes.int.test.ts's student-feed duration test instead.
    expect(row.duration_seconds).toBe(600);
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

  it("a same-school teacher deep-clones a shared quiz into a private copy", async () => {
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

    expect(await testbed.db.quizRow(clone)).toMatchObject({
      author_id: cloner.id,
      video_id: source.videoId,
      visibility: "private",
      cloned_from_id: source.id,
      base_language: "he",
      title: "Original",
      school_id: lincoln.id,
    });

    expect(await videoCount(source.videoId!)).toBe(1);

    const clonedQuestions = await questionsOf(clone.id);
    expect(clonedQuestions).toHaveLength(1);
    const clonedQuestion = clonedQuestions[0];
    expect(clonedQuestion.id).not.toBe(sourceQuestion.id);
    expect(clonedQuestion).toMatchObject({ kind: "single", position_seconds: 42 });

    const clonedTranslations = await questionTranslationsOf(clonedQuestion.id);
    expect(clonedTranslations.map((t) => t.language)).toEqual(["en", "he"]);
    expect(clonedTranslations.find((t) => t.language === "en")!.prompt).toBe(
      "What is X? (en)"
    );

    const clonedOptions = await liveOptionsOf(clonedQuestion.id);
    expect(clonedOptions).toHaveLength(4);
    expect(clonedOptions.filter((o) => o.is_correct)).toHaveLength(1);
    const sourceOptionIds = new Set(sourceQuestion.options.map((o) => o.id));
    expect(clonedOptions.every((o) => !sourceOptionIds.has(o.id))).toBe(true);

    expect(await optionTranslationCountOf(clonedQuestion.id)).toBe(8);
  });

  it("clone copies only NON-DELETED questions and options", async () => {
    const source = await authorQuizWithQuestion(teacher);
    await source.makeShared();
    const [mainQuestion] = source.questions;

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

    const clonedQuestions = await questionsOf(clone.id);
    expect(clonedQuestions).toHaveLength(1);
    expect(await liveOptionsOf(clonedQuestions[0].id)).toHaveLength(4);
  });

  it("clone does NOT copy attempts/answers (clean copy)", async () => {
    const source = await authorQuizWithQuestion(teacher);
    await source.makeShared();

    const biology = await teacher.openClass({ name: "Biology", language: "he" });
    await biology.enroll(student);
    await teacher.assignQuiz(source, { to: biology });
    await student.startAttempt(source, { in: biology });
    expect(await testbed.db.attemptCount(source)).toBe(1);

    const clone = await teacher.clone(source);
    expect(await testbed.db.attemptCount(clone)).toBe(0);
  });

  it("an owner can clone their OWN private quiz", async () => {
    const source = await authorQuizWithQuestion(teacher);
    const clone = await teacher.clone(source);
    expect(await testbed.db.quizRow(clone)).toMatchObject({
      cloned_from_id: source.id,
      visibility: "private",
    });
  });

  it("editing a clone leaves the source quiz untouched", async () => {
    const source = await teacher.authorQuiz({
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
          ],
        }),
      ],
    });
    await source.makeShared();
    const sourceBefore = await testbed.db.structureOf(source);

    const cloner = await lincoln.enrollTeacher({ name: "Grace" });
    const clone = await cloner.clone(source);

    const [sourceQuestion] = source.questions;
    const [clonedQuestion] = clone.questions;
    expect(clonedQuestion.id).not.toBe(sourceQuestion.id);
    const sourceOptionIds = new Set(sourceQuestion.optionIds);
    expect(clonedQuestion.optionIds.filter((id) => sourceOptionIds.has(id))).toEqual(
      []
    );

    await cloner.reviseQuestion(clonedQuestion, {
      prompt: "What is X, really?",
      explanation: "Because Z.",
      options: [
        { text: "clone option 0", correct: false },
        { text: "clone option 1", correct: false },
        { text: "clone option 2", correct: true },
      ],
    });
    await cloner.addQuestion(
      clone,
      singleChoice({
        prompt: "A clone-only question",
        at: 120,
        order: 1,
        correct: "yes",
        distractors: ["no"],
      })
    );
    await clone.rename("Grace's Adaptation");

    const cloneAfter = await testbed.db.structureOf(clone);
    expect(cloneAfter.map((q) => q.prompt)).toEqual([
      "What is X, really?",
      "A clone-only question",
    ]);
    expect(cloneAfter[0].options.map((o) => o.text)).toEqual([
      "clone option 0",
      "clone option 1",
      "clone option 2",
    ]);
    expect(
      cloneAfter[0].options.filter((o) => o.isCorrect).map((o) => o.text)
    ).toEqual(["clone option 2"]);

    expect(await testbed.db.structureOf(source)).toEqual(sourceBefore);
    expect(await testbed.db.quizRow(source)).toMatchObject({
      title: "Original",
      visibility: "shared",
      author_id: teacher.id,
    });
  });

  it("editing the source leaves an existing clone untouched", async () => {
    const source = await teacher.authorQuiz({
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
          ],
        }),
        singleChoice({
          prompt: "What is Y?",
          at: 90,
          order: 1,
          correct: "yes",
          distractors: ["no"],
        }),
      ],
    });
    await source.makeShared();

    const cloner = await lincoln.enrollTeacher({ name: "Grace" });
    const clone = await cloner.clone(source);
    const cloneBefore = await testbed.db.structureOf(clone);
    expect(cloneBefore).toHaveLength(2);

    const [firstQuestion, secondQuestion] = source.questions;
    await teacher.reviseQuestion(firstQuestion, {
      prompt: "Reworked prompt",
      explanation: "Reworked explanation.",
      options: [
        { text: "source option 0", correct: true },
        { text: "source option 1", correct: false },
        { text: "source option 2", correct: false },
      ],
    });
    await secondQuestion.softDelete();
    await teacher.addQuestion(
      source,
      singleChoice({
        prompt: "A source-only question",
        at: 150,
        order: 2,
        correct: "yes",
        distractors: ["no"],
      })
    );
    await source.rename("Reworked Original");
    await source.makePrivate();

    const sourceAfter = await testbed.db.structureOf(source);
    expect(sourceAfter.map((q) => q.prompt)).toEqual([
      "Reworked prompt",
      "A source-only question",
    ]);
    expect(
      sourceAfter[0].options.filter((o) => o.isCorrect).map((o) => o.text)
    ).toEqual(["source option 0"]);

    expect(await testbed.db.structureOf(clone)).toEqual(cloneBefore);
    expect(await testbed.db.quizRow(clone)).toMatchObject({
      title: "Original",
      visibility: "private",
      cloned_from_id: source.id,
      author_id: cloner.id,
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
    const source = await authorQuizWithQuestion(teacher);
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
