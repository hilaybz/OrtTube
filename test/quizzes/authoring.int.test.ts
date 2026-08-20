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
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

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

/** A video row's title/duration, as backfill tests need to inspect both. */
async function videoMeta(
  youtubeId: string
): Promise<{ title: string | null; duration_seconds: number | null }> {
  const res = await getPool().query<{ title: string | null; duration_seconds: number | null }>(
    "SELECT title, duration_seconds FROM public.videos WHERE youtube_video_id=$1",
    [youtubeId]
  );
  return res.rows[0];
}

/** The stored quiz title (null once cleared — the UI then shows the video's). */
async function quizTitle(quizId: string): Promise<string | null> {
  const res = await getPool().query<{ title: string | null }>(
    "SELECT title FROM public.quizzes WHERE id=$1",
    [quizId]
  );
  return res.rows[0].title;
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

  it("list_my_quizzes carries the quiz's duration fields (issue #80)", async () => {
    const quiz = await teacher.authorQuiz({ title: "Timed Quiz" });
    await teacher.client.rpc("update_quiz", {
      p_quiz_id: quiz.id,
      p_time_restricted: true,
      p_duration_minutes: 7,
    });

    const listed = (await teacher.myQuizzes()).find((q) => q.quiz_id === quiz.id)!;
    expect(listed.time_restricted).toBe(true);
    expect(listed.duration_minutes).toBe(7);
    // `authorQuiz`'s fixture always sets p_duration_seconds: 600.
    expect(listed.duration_seconds).toBe(600);
  });

  // `update_quiz` is a partial patch, so NULL means "field not provided". That
  // made the title impossible to unset: clearing the box saved null, coalesce
  // kept the old value, and the teacher was stuck with a title they had deleted.
  // An empty string is the one way to say "no title", which is a real state —
  // the UI falls back to the video's title.
  describe("update_quiz title semantics", () => {
    it("clears the title when given an empty string", async () => {
      const quiz = await teacher.authorQuiz({ title: "Chapter One" });

      const { error } = await teacher.client.rpc("update_quiz", {
        p_quiz_id: quiz.id,
        p_title: "",
      });

      expect(error).toBeNull();
      expect(await quizTitle(quiz.id)).toBeNull();
    });

    it("treats a whitespace-only title as cleared", async () => {
      const quiz = await teacher.authorQuiz({ title: "Chapter One" });

      await teacher.client.rpc("update_quiz", { p_quiz_id: quiz.id, p_title: "   " });

      expect(await quizTitle(quiz.id)).toBeNull();
    });

    it("leaves the title untouched when it is not part of the patch", async () => {
      const quiz = await teacher.authorQuiz({ title: "Chapter One" });

      // Changing only visibility must not disturb the title.
      await teacher.client.rpc("update_quiz", {
        p_quiz_id: quiz.id,
        p_visibility: "shared",
      });

      expect(await quizTitle(quiz.id)).toBe("Chapter One");
    });

    it("stores a new title trimmed", async () => {
      const quiz = await teacher.authorQuiz({ title: "Chapter One" });

      await teacher.client.rpc("update_quiz", {
        p_quiz_id: quiz.id,
        p_title: "  Chapter Two  ",
      });

      expect(await quizTitle(quiz.id)).toBe("Chapter Two");
    });
  });

  // `time_restricted`/`duration_minutes` (issue #80): a teacher-stated cap,
  // settable at creation and editable afterward. `duration_minutes` is only
  // ever non-null while restricted — enforced both by a DB CHECK constraint
  // and by both RPCs raising `invalid_duration` for an inconsistent pair.
  describe("quiz duration (issue #80)", () => {
    it("creates a restricted quiz and round-trips it via get_quiz_for_author", async () => {
      const quiz = await teacher.authorQuiz({ title: "Timed Quiz" });
      const { error } = await teacher.client.rpc("update_quiz", {
        p_quiz_id: quiz.id,
        p_time_restricted: true,
        p_duration_minutes: 12,
      });
      expect(error).toBeNull();

      const view = await teacher.editorView(quiz);
      expect(view.time_restricted).toBe(true);
      expect(view.duration_minutes).toBe(12);
    });

    it("a newly authored quiz starts unrestricted with no stored minutes", async () => {
      const quiz = await teacher.authorQuiz({ title: "Untimed Quiz" });
      const view = await teacher.editorView(quiz);
      expect(view.time_restricted).toBe(false);
      expect(view.duration_minutes).toBeNull();
    });

    it("create_quiz_for_video rejects time_restricted without a positive minute count", async () => {
      const { error } = await teacher.client.rpc("create_quiz_for_video", {
        p_youtube_id: `yt-${Math.random().toString(36).slice(2)}`,
        p_video_title: "A Video",
        p_duration_seconds: 600,
        p_base_language: "he",
        p_quiz_title: "Bad Duration",
        p_time_restricted: true,
        p_duration_minutes: null,
      });
      expect(error?.message).toBe("invalid_duration");
    });

    it("create_quiz_for_video rejects a zero/negative minute count even when restricted", async () => {
      const { error } = await teacher.client.rpc("create_quiz_for_video", {
        p_youtube_id: `yt-${Math.random().toString(36).slice(2)}`,
        p_video_title: "A Video",
        p_duration_seconds: 600,
        p_base_language: "he",
        p_quiz_title: "Bad Duration",
        p_time_restricted: true,
        p_duration_minutes: 0,
      });
      expect(error?.message).toBe("invalid_duration");
    });

    it("update_quiz rejects turning restriction on without a positive minute count", async () => {
      const quiz = await teacher.authorQuiz();
      const { error } = await teacher.client.rpc("update_quiz", {
        p_quiz_id: quiz.id,
        p_time_restricted: true,
      });
      expect(error?.message).toBe("invalid_duration");

      // The rejected call must not have partially applied.
      const view = await teacher.editorView(quiz);
      expect(view.time_restricted).toBe(false);
    });

    it("toggling back to unrestricted clears the stored minute count", async () => {
      const quiz = await teacher.authorQuiz();
      await teacher.client.rpc("update_quiz", {
        p_quiz_id: quiz.id,
        p_time_restricted: true,
        p_duration_minutes: 20,
      });

      const { error } = await teacher.client.rpc("update_quiz", {
        p_quiz_id: quiz.id,
        p_time_restricted: false,
      });
      expect(error).toBeNull();

      const view = await teacher.editorView(quiz);
      expect(view.time_restricted).toBe(false);
      expect(view.duration_minutes).toBeNull();
    });

    it("leaves the duration untouched when time_restricted is not part of the patch", async () => {
      const quiz = await teacher.authorQuiz();
      await teacher.client.rpc("update_quiz", {
        p_quiz_id: quiz.id,
        p_time_restricted: true,
        p_duration_minutes: 15,
      });

      // A title-only edit must not disturb the duration.
      await teacher.client.rpc("update_quiz", { p_quiz_id: quiz.id, p_title: "Renamed" });

      const view = await teacher.editorView(quiz);
      expect(view.time_restricted).toBe(true);
      expect(view.duration_minutes).toBe(15);
    });
  });

  // Only the FIRST quiz on a video used to set its title/duration — a fetch
  // failure on that one call left the field null forever, since a later quiz on
  // the same video was a no-op upsert. `create_quiz_for_video` now backfills
  // whichever column is currently null on each subsequent call.
  describe("create_quiz_for_video video metadata backfill", () => {
    it("backfills a null title/duration from a later quiz on the same video", async () => {
      const youtubeId = `yt-backfill-${Math.random().toString(36).slice(2)}`;

      // First quiz: simulates the metadata fetch having failed.
      const first = await teacher.client.rpc("create_quiz_for_video", {
        p_youtube_id: youtubeId,
        p_video_title: null,
        p_duration_seconds: null,
        p_base_language: "he",
        p_quiz_title: "First",
      });
      expect(first.error).toBeNull();
      expect(await videoMeta(youtubeId)).toEqual({ title: null, duration_seconds: null });

      // Second quiz on the SAME video: this fetch succeeded.
      const second = await teacher.client.rpc("create_quiz_for_video", {
        p_youtube_id: youtubeId,
        p_video_title: "Real Title",
        p_duration_seconds: 400,
        p_base_language: "he",
        p_quiz_title: "Second",
      });
      expect(second.error).toBeNull();
      expect(await videoMeta(youtubeId)).toEqual({
        title: "Real Title",
        duration_seconds: 400,
      });

      // Both quizzes still point at the ONE shared video row (dedup by
      // youtube_video_id) — the backfill must not have created a second row.
      expect(first.data.video_id).toBe(second.data.video_id);
    });

    it("never overwrites existing metadata with a later null", async () => {
      const youtubeId = `yt-preserve-${Math.random().toString(36).slice(2)}`;

      await teacher.client.rpc("create_quiz_for_video", {
        p_youtube_id: youtubeId,
        p_video_title: "Established Title",
        p_duration_seconds: 555,
        p_base_language: "he",
        p_quiz_title: "First",
      });

      // A later quiz whose OWN metadata fetch failed must not blank out what is
      // already stored — coalesce always prefers the existing value.
      await teacher.client.rpc("create_quiz_for_video", {
        p_youtube_id: youtubeId,
        p_video_title: null,
        p_duration_seconds: null,
        p_base_language: "he",
        p_quiz_title: "Second",
      });

      expect(await videoMeta(youtubeId)).toEqual({
        title: "Established Title",
        duration_seconds: 555,
      });
    });
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
