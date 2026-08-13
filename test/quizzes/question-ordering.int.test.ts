/**
 * Question ordering — questions are sequenced by VIDEO TIME, not by the order the
 * teacher happened to write them in.
 *
 * `questions.order_index` is assigned `max + 1` on insert, so it records authoring
 * order. Every read used to sort by it first, which put a question authored late
 * but positioned early AFTER a later one. For a teacher that was an unsorted
 * list; for a student the player gates the video at the next unanswered
 * question's timestamp, so the gate landed behind the playhead and snapped the
 * video backwards.
 *
 * The reproduction is deliberately the reported one: author at 0:30, then 1:30,
 * then 0:30 again. Each case asserts through the real RPC, because the RPC — not
 * the table — is what decides order.
 *
 * Runs at the integration/gate step. Skipped when the local stack is unreachable.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPool, closePool } from "../helpers/db";
import {
  freshTestbed,
  singleChoice,
  type Testbed,
  type School,
  type Teacher,
  type Student,
  type Classroom,
  type Quiz,
} from "../helpers/testbed";
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

/** Authored at 0:30, then 1:30, then 0:30 — the sequence that surfaced the bug. */
const AUTHORED_OUT_OF_TIME_ORDER = [
  singleChoice({ prompt: "first-at-0:30", at: 30, correct: "a", distractors: ["b"] }),
  singleChoice({ prompt: "at-1:30", at: 90, correct: "a", distractors: ["b"] }),
  singleChoice({ prompt: "second-at-0:30", at: 30, correct: "a", distractors: ["b"] }),
];

const IN_TIME_ORDER = ["first-at-0:30", "second-at-0:30", "at-1:30"];

describe.skipIf(!online)("question ordering follows video time", () => {
  let testbed: Testbed;
  let school: School;
  let teacher: Teacher;
  let student: Student;
  let classroom: Classroom;
  let quiz: Quiz;

  beforeEach(async () => {
    testbed = await freshTestbed();
    school = await testbed.createSchool("Lincoln High");
    teacher = await school.enrollTeacher({ name: "Ada" });
    student = await school.enrollStudent({ name: "Ben" });
    classroom = await teacher.openClass({ name: "Biology", language: "he" });
    quiz = await teacher.authorQuiz({ questions: AUTHORED_OUT_OF_TIME_ORDER });
    await teacher.assignQuiz(quiz, { to: classroom });
    await classroom.enroll(student);
  });

  afterAll(closePool);

  it("lists a teacher's questions in video order, not the order they were written", async () => {
    const view = await teacher.editorView(quiz);

    expect(view.questions.map((q) => q.prompt)).toEqual(IN_TIME_ORDER);
  });

  it("serves a student's questions in video order", async () => {
    const view = await student.viewQuiz(quiz, { in: classroom });

    expect(view.questions.map((q) => q.prompt)).toEqual(IN_TIME_ORDER);
  });

  it("never puts a checkpoint behind the one before it", async () => {
    const view = await student.viewQuiz(quiz, { in: classroom });

    const positions = view.questions.map((q) => q.position_seconds);
    const ascending = [...positions].sort((a, b) => a - b);
    // The player gates the video at each checkpoint in turn, so a position that
    // decreased would seek a student backwards mid-quiz.
    expect(positions).toEqual(ascending);
  });

  it("ranks the attempt snapshot by time so a mid-attempt retime cannot reshuffle it", async () => {
    const attempt = await student.startAttempt(quiz, { in: classroom });

    const rows = await getPool().query<{ prompt: string }>(
      `SELECT qt.prompt
         FROM public.attempt_questions aq
         JOIN public.questions q ON q.id = aq.question_id
         JOIN public.question_translations qt
           ON qt.question_id = q.id AND qt.language = 'he'
        WHERE aq.attempt_id = $1
        ORDER BY aq.order_index`,
      [attempt.id]
    );

    // The snapshot carries its OWN order, so get_attempt_review needs no
    // knowledge of position_seconds to replay the attempt correctly.
    expect(rows.rows.map((r) => r.prompt)).toEqual(IN_TIME_ORDER);
  });

  it("keeps authoring order as the tiebreak between two questions at the same second", async () => {
    const view = await teacher.editorView(quiz);
    const sameSecond = view.questions.filter((q) => q.position_seconds === 30);

    // Both sit at 0:30; the one written first stays first.
    expect(sameSecond.map((q) => q.prompt)).toEqual(["first-at-0:30", "second-at-0:30"]);
  });
});
