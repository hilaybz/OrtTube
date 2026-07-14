/**
 * Tutor integration tests — the `get_tutor_mode` SECURITY DEFINER RPC and
 * `tutor_questions` logging (spec §5, §3.6). Every action runs through an actor's
 * AUTHENTICATED (RLS-subject) client via the actor DSL (`test/helpers/testbed`),
 * so the RPC's `auth.uid()` membership check is real.
 *
 * Covers: membership gate (member vs non-member), assignment gate, per-class
 * mode + language/video context returned, students have no direct SELECT on
 * class_quizzes, and that the service client can log a tutor_questions row with
 * the full set of FKs (and anonymises it when the student is deleted).
 *
 * Runs at the integration/gate step (owns DB application). Skipped when the local
 * DB is unreachable so unit suites still pass without Supabase running.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getPool, closePool } from "../helpers/db";
import {
  freshTestbed,
  type Testbed,
  type School,
  type Teacher,
  type Student,
  type Classroom,
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

/** A logged tutor-interaction row, read out-of-band for assertions. */
interface TutorLogRow {
  student_id: string | null;
  class_id: string;
  quiz_id: string;
  video_id: string;
  position_seconds: number | null;
  prompt: string;
  ai_response: string;
}

/**
 * Read the tutor_questions rows matching one FK (out-of-band assertion helper —
 * students have no direct grant on the table). `column` is a fixed union, so the
 * interpolation is safe.
 */
async function tutorLogWhere(
  column: "student_id" | "quiz_id",
  value: string
): Promise<TutorLogRow[]> {
  const res = await getPool().query<TutorLogRow>(
    `SELECT student_id, class_id, quiz_id, video_id, position_seconds, prompt, ai_response
       FROM public.tutor_questions WHERE ${column}=$1`,
    [value]
  );
  return res.rows;
}

describe.skipIf(!online)("tutor — get_tutor_mode + logging", () => {
  let testbed: Testbed;
  let school: School;
  let teacher: Teacher;
  let student: Student;
  let classroom: Classroom;

  beforeEach(async () => {
    testbed = await freshTestbed();
    school = await testbed.createSchool("Lincoln High");
    teacher = await school.enrollTeacher({ name: "Ada" });
    student = await school.enrollStudent({ name: "Ben" });
    classroom = await teacher.openClass({ name: "Biology", language: "he" });
    await classroom.enroll(student);
  });

  afterAll(async () => {
    await closePool();
  });

  it("returns mode + language + video context for an enrolled member", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints" });

    const context = await student.tutorContext(quiz, { in: classroom });
    expect(context.tutor_mode).toBe("hints");
    expect(context.class_language).toBe("he");
    expect(context.base_language).toBe("he");
    expect(context.video_id).toBe(quiz.videoId);
    expect(context.youtube_video_id).toBe(quiz.youtubeId);
  });

  it("returns tutor_mode 'off' so the route can refuse", async () => {
    const quiz = await teacher.authorQuiz();
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "off" });

    const context = await student.tutorContext(quiz, { in: classroom });
    expect(context.tutor_mode).toBe("off");
  });

  it("reflects the student's preferred_language in the context", async () => {
    await student.setPreferredLanguage("ar");
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints" });

    const context = await student.tutorContext(quiz, { in: classroom });
    expect(context.preferred_language).toBe("ar");
  });

  it("rejects a non-member with not_member", async () => {
    const quiz = await teacher.authorQuiz();
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints" });

    const outsider = await school.enrollStudent({ name: "Outsider" });
    await expect(
      outsider.tutorContext(quiz, { in: classroom })
    ).rejects.toThrow(/not_member/);
  });

  it("rejects an unassigned quiz with not_assigned", async () => {
    const quiz = await teacher.authorQuiz();
    // Deliberately NOT assigned to the class.
    await expect(
      student.tutorContext(quiz, { in: classroom })
    ).rejects.toThrow(/not_assigned/);
  });

  it("students have no direct SELECT on class_quizzes", async () => {
    const quiz = await teacher.authorQuiz();
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints" });

    // RLS (owner-only SELECT) → the student cannot see the assignment row.
    expect(await student.canSeeAssignment(quiz, { in: classroom })).toBe(false);
  });

  it("logs a tutor_questions row via the service client with full FKs", async () => {
    const quiz = await teacher.authorQuiz();
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints" });

    await testbed.seed.logTutorQuestion({
      student,
      classroom,
      quiz,
      positionSeconds: 42,
      prompt: "What is photosynthesis?",
      aiResponse: "It converts light into chemical energy.",
    });

    const logged = await tutorLogWhere("student_id", student.id);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      student_id: student.id,
      class_id: classroom.id,
      quiz_id: quiz.id,
      video_id: quiz.videoId,
      position_seconds: 42,
    });
  });

  it("anonymizes tutor_questions.student_id when the student is deleted", async () => {
    const quiz = await teacher.authorQuiz();
    await teacher.assignQuiz(quiz, { to: classroom, tutor: "hints" });

    await testbed.seed.logTutorQuestion({
      student,
      classroom,
      quiz,
      positionSeconds: 10,
      prompt: "q",
      aiResponse: "a",
    });

    // Hard-delete the auth user → profiles cascades → FK sets student_id NULL.
    await testbed.admin.hardDeleteAuthUser(student);

    const logged = await tutorLogWhere("quiz_id", quiz.id);
    expect(logged).toHaveLength(1);
    expect(logged[0].student_id).toBeNull();
  });
});
