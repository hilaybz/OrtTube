/**
 * Authoring integration tests — quiz/question/option authoring RPCs (spec §3.4).
 *
 * Every action runs through an actor's AUTHENTICATED (RLS-subject) client via the
 * actor DSL (`test/helpers/testbed`), so each RPC's `auth.uid()` owner check is
 * real. Covers: atomic create_quiz_for_video, base translations written by
 * upsert_question, single/multi correctness guards, soft-delete prechecks,
 * ownership enforcement, and list_my_quizzes.
 *
 * Runs at the integration/gate step (owns DB application). Skipped when the local
 * DB is unreachable so unit suites still pass without Supabase running.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPool, closePool } from "../helpers/db";
import {
  freshTestbed,
  singleChoice,
  question,
  type Actor,
  type Testbed,
  type School,
  type Teacher,
  type Quiz,
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

// ── Out-of-band reads used only for assertions ────────────────────────────────

/** Whether the canonical video row backing a quiz exists. */
async function videoExists(videoId: string): Promise<boolean> {
  const res = await getPool().query("SELECT 1 FROM public.videos WHERE id=$1", [videoId]);
  return res.rowCount === 1;
}

/** Every stored translation row for a question (all languages). */
async function questionTranslations(questionId: string) {
  const res = await getPool().query(
    "SELECT prompt, explanation, source, language FROM public.question_translations WHERE question_id=$1",
    [questionId]
  );
  return res.rows;
}

/** How many option-text rows a question has in a given language. */
async function optionTranslationCount(questionId: string, language: string): Promise<number> {
  const res = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.option_translations ot
     JOIN public.question_options qo ON qo.id = ot.option_id
     WHERE qo.question_id=$1 AND ot.language=$2`,
    [questionId, language]
  );
  return res.rows[0].n;
}

/** The soft-delete marker on an option (null while live). */
async function optionDeletedAt(optionId: string): Promise<string | null> {
  const res = await getPool().query<{ deleted_at: string | null }>(
    "SELECT deleted_at FROM public.question_options WHERE id=$1",
    [optionId]
  );
  return res.rows[0].deleted_at;
}

/** Attempt to author a quiz AS the given actor — used to exercise the role guard. */
function tryCreateQuizAs(actor: Actor) {
  return actor.client.rpc("create_quiz_for_video", {
    p_youtube_id: "yt-x",
    p_video_title: "V",
    p_duration_seconds: 100,
    p_base_language: "he",
    p_quiz_title: "Q",
  });
}

describe.skipIf(!online)("authoring RPCs", () => {
  let testbed: Testbed;
  let school: School;
  let teacher: Teacher;

  beforeEach(async () => {
    testbed = await freshTestbed();
    school = await testbed.createSchool("Riverside High");
    teacher = await school.enrollTeacher({ name: "Ada" });
  });

  afterAll(async () => {
    await closePool();
  });

  it("create_quiz_for_video creates the video + quiz atomically", async () => {
    const quiz = await teacher.authorQuiz();

    const row = await testbed.db.quizRow(quiz);
    expect(row).not.toBeNull();
    expect(row!.author_id).toBe(teacher.id);
    expect(await videoExists(quiz.videoId!)).toBe(true);
  });

  it("a student cannot create a quiz (not_authorized)", async () => {
    const student = await school.enrollStudent({ name: "Ben" });
    const { error } = await tryCreateQuizAs(student);
    expect(error?.message).toContain("not_authorized");
  });

  it("upsert_question writes structural rows + base translations", async () => {
    const quiz = await teacher.authorQuiz();
    const authored = await teacher.addQuestion(
      quiz,
      singleChoice({
        prompt: "What is X?",
        at: 42,
        explanation: "Because Y.",
        correct: "option 1",
        distractors: ["option 0", "option 2", "option 3"],
      })
    );
    expect(typeof authored.id).toBe("string");

    const translations = await questionTranslations(authored.id);
    expect(translations).toHaveLength(1);
    expect(translations[0]).toMatchObject({
      language: "he",
      source: "authored",
      prompt: "What is X?",
    });

    expect(authored.options).toHaveLength(4);
    expect(authored.correctIds).toHaveLength(1);

    expect(await optionTranslationCount(authored.id, "he")).toBe(4);
  });

  it("rejects a single question without exactly one correct", async () => {
    const quiz = await teacher.authorQuiz();
    await expect(
      teacher.addQuestion(
        quiz,
        question({
          kind: "single",
          prompt: "?",
          at: 10,
          options: [
            { text: "option 0", correct: true },
            { text: "option 1", correct: true },
            { text: "option 2", correct: false },
            { text: "option 3", correct: false },
          ],
        })
      )
    ).rejects.toThrow("single_needs_exactly_one_correct");
  });

  it("rejects a multi question with zero correct", async () => {
    const quiz = await teacher.authorQuiz();
    await expect(
      teacher.addQuestion(
        quiz,
        question({
          kind: "multi",
          prompt: "?",
          at: 10,
          options: [
            { text: "option 0", correct: false },
            { text: "option 1", correct: false },
            { text: "option 2", correct: false },
            { text: "option 3", correct: false },
          ],
        })
      )
    ).rejects.toThrow("needs_at_least_one_correct");
  });

  it("soft_delete_option blocks removing the last correct, allows a wrong one", async () => {
    const quiz = await teacher.authorQuiz();
    const authored = await teacher.addQuestion(
      quiz,
      singleChoice({
        prompt: "?",
        at: 10,
        correct: "the answer",
        distractors: ["wrong a", "wrong b", "wrong c"],
      })
    );
    const correctOption = authored.options.find((o) => o.isCorrect)!;
    const wrongOption = authored.options.find((o) => !o.isCorrect)!;

    await expect(teacher.removeOption(correctOption)).rejects.toThrow(
      "cannot_remove_last_correct"
    );

    await teacher.removeOption(wrongOption);
    expect(await optionDeletedAt(wrongOption.id)).not.toBeNull();
  });

  it("a non-owner teacher cannot author on someone else's quiz", async () => {
    const quiz = await teacher.authorQuiz();
    const peerTeacher = await school.enrollTeacher({ name: "Grace" });
    await expect(
      peerTeacher.addQuestion(
        quiz,
        singleChoice({
          prompt: "sneaky",
          at: 5,
          correct: "yes",
          distractors: ["no"],
        })
      )
    ).rejects.toThrow("not_owner");
  });

  it("list_my_quizzes returns own quizzes with counts; soft-delete hides them", async () => {
    const quiz = await teacher.authorQuiz({
      title: "Library Quiz",
      questions: [
        singleChoice({ prompt: "?", at: 5, correct: "yes", distractors: ["no"] }),
      ],
    });

    const library = await teacher.myQuizzes();
    const listed = library.find((q) => q.quiz_id === quiz.id)!;
    expect(listed).toBeTruthy();
    expect(Number(listed.question_count)).toBe(1);

    await quiz.softDelete();
    const afterDelete = await teacher.myQuizzes();
    expect(afterDelete.some((q) => q.quiz_id === quiz.id)).toBe(false);
  });

  it("students have no direct read of the answer key (RLS)", async () => {
    const quiz = await teacher.authorQuiz({
      questions: [
        singleChoice({ prompt: "?", at: 5, correct: "yes", distractors: ["no"] }),
      ],
    });
    const student = await school.enrollStudent({ name: "Ben" });

    const { data } = await student.client.from("question_options").select("id, is_correct");
    // RLS gives students no rows on the structural answer key.
    expect(data ?? []).toHaveLength(0);
  });
});
