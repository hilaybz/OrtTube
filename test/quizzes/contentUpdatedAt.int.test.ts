/**
 * `quizzes.content_updated_at` — the analytics cutoff the triggers in
 * `147_quiz_content_updated_at.sql` maintain.
 *
 * The stamp decides which attempts every teacher-facing analytic counts, so what
 * matters here is not only that a real edit moves it but that the things which are
 * NOT edits leave it alone. Two authoring paths in the editor resend a complete,
 * unmodified question payload — dragging a checkpoint marker (there is no
 * position-only endpoint) and pressing Save with nothing changed — so a stamp that
 * moved on every `upsert_question` call would silently discard a term of analytics
 * on a marker nudge. The no-op cases below are the regression guard for that.
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
  type Quiz,
  type AuthoredQuestion,
} from "../helpers/testbed";
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

describe.skipIf(!online)("quizzes.content_updated_at", () => {
  let testbed: Testbed;
  let teacher: Teacher;
  let quiz: Quiz;
  let q1: AuthoredQuestion;

  beforeEach(async () => {
    testbed = await freshTestbed();
    const school = await testbed.createSchool("Cutoff School");
    teacher = await school.enrollTeacher({ name: "Tara" });

    quiz = await teacher.authorQuiz({
      baseLanguage: "he",
      title: "Original title",
      questions: [
        singleChoice({ prompt: "Q1", at: 30, order: 0, correct: "A", distractors: ["B", "C"] }),
        singleChoice({ prompt: "Q2", at: 60, order: 1, correct: "D", distractors: ["E"] }),
      ],
    });
    q1 = quiz.questions[0];
  }, 60_000);

  afterAll(async () => {
    await closePool();
  });

  /** The stamp as of now — every assertion below is a before/after comparison. */
  function stamp(): Promise<Date | null> {
    return testbed.db.contentUpdatedAt(quiz);
  }

  describe("what moves the stamp", () => {
    it("is set by authoring, since creating questions is what makes a quiz", async () => {
      expect(await stamp()).toBeInstanceOf(Date);
    });

    it("moves when a question's prompt text is rewritten", async () => {
      const before = await stamp();
      await teacher.reviseQuestion(q1, { prompt: "Q1 rewritten" });
      const after = await stamp();
      expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    });

    it("moves when a checkpoint is retimed — the same question is harder earlier", async () => {
      const before = await stamp();
      await teacher.reviseQuestion(q1, { at: 5 });
      const after = await stamp();
      expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    });

    it("moves when the answer key changes", async () => {
      const before = await stamp();
      await q1.flipCorrectTo(q1.distractorIds[0]);
      const after = await stamp();
      expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    });

    it("moves when an option's text is rewritten", async () => {
      const before = await stamp();
      await teacher.reviseQuestion(q1, {
        options: [
          { text: "A (clearer)", correct: true },
          { text: "B", correct: false },
          { text: "C", correct: false },
        ],
      });
      const after = await stamp();
      expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    });

    it("moves when a question is soft-deleted", async () => {
      const before = await stamp();
      await q1.softDelete();
      const after = await stamp();
      expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    });

    it("moves when an option is soft-deleted", async () => {
      const before = await stamp();
      await teacher.removeOption(q1.distractorIds[0]);
      const after = await stamp();
      expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    });

    it("moves when a question is added to a quiz that already collected results", async () => {
      const before = await stamp();
      await teacher.addQuestion(
        quiz,
        singleChoice({ prompt: "Q3", at: 90, order: 2, correct: "F", distractors: ["G"] })
      );
      const after = await stamp();
      expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    });
  });

  describe("what leaves the stamp alone", () => {
    it("does not move when the identical question payload is resent", async () => {
      // Exactly what a marker drag that lands where it started, or a Save with
      // nothing edited, sends: every field replayed unchanged. This is the whole
      // reason the triggers compare OLD to NEW instead of firing on every write.
      const before = await stamp();
      await teacher.reviseQuestion(q1, {});
      expect((await stamp())!.getTime()).toBe(before!.getTime());
    });

    it("does not move when only the quiz title changes", async () => {
      const before = await stamp();
      await teacher.setTitle(quiz, "Renamed");
      expect((await stamp())!.getTime()).toBe(before!.getTime());
    });

    it("does not move when only visibility changes", async () => {
      const before = await stamp();
      await teacher.setVisibility(quiz, "shared");
      expect((await stamp())!.getTime()).toBe(before!.getTime());
    });

    it("does not move when a non-base-language translation is written", async () => {
      // Asserted with a direct write rather than through an actor: the guard being
      // tested is the trigger's base-language check, and the translate job's own
      // path would prove only that one caller happens to avoid it. A machine
      // rendering of an unchanged question invalidates nothing, so bumping here
      // would reset a teacher's analytics on every translation run.
      const before = await stamp();
      await testbed.db
        .pool()
        .query(
          `INSERT INTO public.question_translations
             (question_id, language, prompt, explanation, source)
           VALUES ($1, 'en', 'Q1 in English', NULL, 'translated')
           ON CONFLICT (question_id, language) DO UPDATE SET prompt = EXCLUDED.prompt`,
          [q1.id]
        );
      expect((await stamp())!.getTime()).toBe(before!.getTime());
    });

    it("does not move when an option's non-base-language text is written", async () => {
      const before = await stamp();
      await testbed.db
        .pool()
        .query(
          `INSERT INTO public.option_translations (option_id, language, text)
           VALUES ($1, 'en', 'A in English')
           ON CONFLICT (option_id, language) DO UPDATE SET text = EXCLUDED.text`,
          [q1.firstCorrect]
        );
      expect((await stamp())!.getTime()).toBe(before!.getTime());
    });
  });

  it("never moves backwards", async () => {
    // Guards the `content_updated_at < now()` predicate in `_touch_quiz_content`:
    // `now()` is transaction start, so a slow edit committing late must not pull
    // the cutoff back over a newer one and resurrect attempts already excluded.
    await teacher.reviseQuestion(q1, { prompt: "first" });
    const first = await stamp();
    await teacher.reviseQuestion(q1, { prompt: "second" });
    const second = await stamp();
    expect(second!.getTime()).toBeGreaterThanOrEqual(first!.getTime());
  });

  it("is not writable by the teacher directly, only by the triggers", async () => {
    // `authenticated` holds UPDATE on `quizzes` and owns the row under RLS, so
    // without the column-level revoke a teacher could clear the cutoff over REST
    // and make stale analytics read as current.
    const before = await stamp();
    await expect(
      teacher.writeQuizColumnDirectly(quiz, { content_updated_at: null })
    ).rejects.toThrow();
    expect((await stamp())!.getTime()).toBe(before!.getTime());
  });
});
