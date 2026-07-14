/**
 * Inspector: out-of-band reads for assertions.
 *
 * Wraps service-role / `pg` reads used ONLY to assert on state the DSL cannot
 * (or should not) surface through an actor — membership rows, pending invites,
 * assignment settings, answer keys, attempt snapshots. Never used to DRIVE the
 * system under test. Exposed to tests as `testbed.db`.
 */
import { getPool } from "../db";
import type { Classroom } from "./classroom";
import type { Student } from "./student";
import type { Quiz, AuthoredQuestion } from "./quiz";
import type { Attempt } from "./attempt";

export class Inspector {
  /** Whether the student currently has a membership row in the class. */
  async isMember(classroom: Classroom, student: Student): Promise<boolean> {
    const res = await getPool().query(
      "SELECT 1 FROM public.class_members WHERE class_id=$1 AND student_id=$2",
      [classroom.id, student.id]
    );
    return res.rowCount === 1;
  }

  /** Whether a membership row exists for a raw student id (e.g. a just-signed-up invitee). */
  async hasMemberId(classroom: Classroom, studentId: string): Promise<boolean> {
    const res = await getPool().query(
      "SELECT 1 FROM public.class_members WHERE class_id=$1 AND student_id=$2",
      [classroom.id, studentId]
    );
    return res.rowCount === 1;
  }

  /** Whether a pending invite for `email` exists on the class. */
  async hasPendingInvite(classroom: Classroom, email: string): Promise<boolean> {
    const res = await getPool().query(
      "SELECT 1 FROM public.class_invites WHERE class_id=$1 AND email=$2",
      [classroom.id, email]
    );
    return res.rowCount === 1;
  }

  /** The stored assignment settings for a class/quiz pair (or null if unassigned). */
  async assignment(
    classroom: Classroom,
    quiz: Quiz
  ): Promise<{ tutor_mode: string; max_attempts: number | null } | null> {
    const res = await getPool().query<{
      tutor_mode: string;
      max_attempts: number | null;
    }>(
      "SELECT tutor_mode, max_attempts FROM public.class_quizzes WHERE class_id=$1 AND quiz_id=$2",
      [classroom.id, quiz.id]
    );
    return res.rows[0] ?? null;
  }

  /** Map<questionId, correctOptionIds[]> for a quiz (live options only). */
  async answerKeyFor(quiz: Quiz): Promise<Map<string, string[]>> {
    const res = await getPool().query<{ id: string; question_id: string }>(
      `SELECT o.id, o.question_id
         FROM public.question_options o
         JOIN public.questions q ON q.id = o.question_id
        WHERE q.quiz_id = $1
          AND o.is_correct = true
          AND o.deleted_at IS NULL
          AND q.deleted_at IS NULL`,
      [quiz.id]
    );
    const key = new Map<string, string[]>();
    for (const row of res.rows) {
      const list = key.get(row.question_id) ?? [];
      list.push(row.id);
      key.set(row.question_id, list);
    }
    return key;
  }

  /** The `was_correct` snapshot recorded for a question in an attempt (null if unanswered). */
  async wasCorrect(attempt: Attempt, q: AuthoredQuestion): Promise<boolean | null> {
    const res = await getPool().query<{ was_correct: boolean }>(
      "SELECT was_correct FROM public.answers WHERE attempt_id=$1 AND question_id=$2",
      [attempt.id, q.id]
    );
    return res.rowCount ? res.rows[0].was_correct : null;
  }

  /** The number of questions frozen into an attempt's snapshot at start. */
  async snapshotSize(attempt: Attempt): Promise<number> {
    const res = await getPool().query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.attempt_questions WHERE attempt_id=$1",
      [attempt.id]
    );
    return res.rows[0].n;
  }

  /** The number of attempt rows recorded for a quiz. */
  async attemptCount(quiz: Quiz): Promise<number> {
    const res = await getPool().query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.attempts WHERE quiz_id=$1",
      [quiz.id]
    );
    return res.rows[0].n;
  }

  /** The stored quiz row (owner/visibility/lineage/video), or null if missing. */
  async quizRow(quiz: Quiz | string): Promise<{
    author_id: string;
    video_id: string;
    school_id: string;
    visibility: string;
    cloned_from_id: string | null;
    base_language: string;
    title: string | null;
    deleted_at: string | null;
  } | null> {
    const id = typeof quiz === "string" ? quiz : quiz.id;
    const res = await getPool().query(
      `SELECT author_id, video_id, school_id, visibility, cloned_from_id,
              base_language, title, deleted_at
         FROM public.quizzes WHERE id=$1`,
      [id]
    );
    return (
      (res.rows[0] as {
        author_id: string;
        video_id: string;
        school_id: string;
        visibility: string;
        cloned_from_id: string | null;
        base_language: string;
        title: string | null;
        deleted_at: string | null;
      }) ?? null
    );
  }

  /** Whether the profile for a user id still exists. */
  async profileExists(userId: string): Promise<boolean> {
    const res = await getPool().query(
      "SELECT 1 FROM public.profiles WHERE id=$1",
      [userId]
    );
    return res.rowCount === 1;
  }

  /** Whether the auth user for an id still exists. */
  async authUserExists(userId: string): Promise<boolean> {
    const res = await getPool().query("SELECT 1 FROM auth.users WHERE id=$1", [
      userId,
    ]);
    return res.rowCount === 1;
  }

  /** The raw pg pool, for a bespoke assertion the typed reads above don't cover. */
  pool() {
    return getPool();
  }
}
