/**
 * Preview integration tests — `get_quiz_for_preview` (backlog 1.3 / issue
 * #13). Gated exactly like `clone_quiz` (owner, or `shared` + same school),
 * but unlike `get_quiz_for_author` it is NOT owner-only, and unlike a
 * correctness-free read it DOES return `is_correct` + `explanation` — see
 * the migration's own comment for why that's the deliberate design.
 *
 * Runs at the integration/gate step. Skipped when the local DB is unreachable.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { closePool } from "../helpers/db";
import { QuizError } from "@/lib/quiz";
import {
  freshTestbed,
  singleChoice,
  type Testbed,
  type School,
  type Teacher,
  type Student,
  type Quiz,
  type Actor,
} from "../helpers/testbed";
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

/** The raw jsonb shape `get_quiz_for_preview` returns. */
interface PreviewRow {
  quiz_id: string;
  title: string | null;
  base_language: string;
  visibility: string;
  author_name: string | null;
  video: {
    youtube_video_id: string;
    title: string | null;
    channel_name: string | null;
  };
  questions: Array<{
    id: string;
    prompt: string | null;
    explanation: string | null;
    options: Array<{ id: string; is_correct: boolean; text: string | null }>;
  }>;
}

/** Preview as any actor, surfacing the RPC's stable rejection code. */
async function previewAs(actor: Actor, quizId: string): Promise<PreviewRow> {
  const { data, error } = await actor.client.rpc("get_quiz_for_preview", {
    p_quiz_id: quizId,
  });
  if (error) throw new QuizError(error.message);
  return data as unknown as PreviewRow;
}

describe.skipIf(!online)("get_quiz_for_preview", () => {
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
    opts: { title?: string } = {}
  ): Promise<Quiz> {
    return author.authorQuiz({
      baseLanguage: "he",
      title: opts.title ?? "Preview Me",
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

  it("the owner can preview their own quiz (private or shared), full content included", async () => {
    const quiz = await authorQuizWithQuestion(teacher); // stays private
    const preview = await previewAs(teacher, quiz.id);

    expect(preview.quiz_id).toBe(quiz.id);
    expect(preview.questions).toHaveLength(1);
    expect(preview.questions[0].prompt).toBe("What is X?");
    expect(preview.questions[0].explanation).toBe("Because Y.");
    const correct = preview.questions[0].options.filter((o) => o.is_correct);
    expect(correct.map((o) => o.text)).toEqual(["option 1"]);
  });

  it("a same-school teacher previews a shared quiz — the answer key and explanation ARE included", async () => {
    const quiz = await authorQuizWithQuestion(teacher);
    await quiz.makeShared();
    const peer = await lincoln.enrollTeacher({ name: "Grace" });

    const preview = await previewAs(peer, quiz.id);
    expect(preview.questions[0].explanation).toBe("Because Y.");
    // Builder order: [correct, ...distractors] → option 1 (correct) is first.
    expect(preview.questions[0].options.map((o) => o.is_correct)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(preview.questions[0].options.filter((o) => o.is_correct)).toHaveLength(1);
  });

  it("includes the video's channel name and the author's display name", async () => {
    const quiz = await authorQuizWithQuestion(teacher);
    await quiz.makeShared();
    const peer = await lincoln.enrollTeacher({ name: "Grace" });

    const preview = await previewAs(peer, quiz.id);
    expect(preview.author_name).toBe("Ada");
    expect(preview.video.youtube_video_id).toBeTruthy();
  });

  it("a same-school teacher CANNOT preview another teacher's private quiz", async () => {
    const quiz = await authorQuizWithQuestion(teacher); // stays private
    const peer = await lincoln.enrollTeacher({ name: "Grace" });

    await expect(previewAs(peer, quiz.id)).rejects.toThrow("not_authorized");
  });

  it("a different-school teacher cannot preview even a shared quiz (tenant isolation)", async () => {
    const quiz = await authorQuizWithQuestion(teacher);
    await quiz.makeShared();

    const otherSchool = await testbed.createSchool("School B");
    const otherTeacher = await otherSchool.enrollTeacher({ name: "Rhea" });

    await expect(previewAs(otherTeacher, quiz.id)).rejects.toThrow("not_authorized");
  });

  it("a student cannot preview (not_authorized)", async () => {
    const quiz = await authorQuizWithQuestion(teacher);
    await quiz.makeShared();

    await expect(previewAs(student, quiz.id)).rejects.toThrow("not_authorized");
  });

  it("raises quiz_not_found / quiz_deleted", async () => {
    await expect(
      previewAs(teacher, "00000000-0000-0000-0000-000000000000")
    ).rejects.toThrow("quiz_not_found");

    const quiz = await authorQuizWithQuestion(teacher);
    await quiz.softDelete();
    await expect(previewAs(teacher, quiz.id)).rejects.toThrow("quiz_deleted");
  });
});
