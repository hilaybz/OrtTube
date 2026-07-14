/**
 * Lifecycle integration tests — user-lifecycle primitives (spec §6.1).
 *
 * Every privileged action runs through the actor DSL (`test/helpers/testbed`):
 * `testbed.admin` drives the service-role lifecycle primitives (deactivate /
 * reassign / delete), actors author quizzes and take attempts as their real
 * RLS-subject selves, and `testbed.db` reads state back for assertions the DSL does
 * not surface.
 *
 *   • delete-user branches by role: student → hard-delete + anonymise;
 *     teacher owning content → must_reassign.
 *   • deactivate_teacher: stamps deactivated_at (idempotent) and strips the
 *     owner's RLS access while the class survives.
 *   • reassign_ownership: moves classes + quizzes to an active same-school
 *     teacher, with guards (self / deactivated target / cross-school / non-teacher).
 *   • POST /api/admin/delete-user: ADMIN_SECRET guard + role branching + errors.
 *
 * Runs at the integration/gate step (which owns DB application). Skipped when the
 * local DB is unreachable so unit suites still pass without Supabase running.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
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
import { POST as deleteUserRoute } from "@/app/api/admin/delete-user/route";

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const online = await dbReachable();

const UNKNOWN_USER_ID = "00000000-0000-0000-0000-000000000000";

// ── Out-of-band reads the actor DSL doesn't surface ───────────────────────────
// Small superuser reads used ONLY to assert on anonymisation / ownership state.

/** The recorded owner (`student_id`) of an attempt row — NULL once anonymised. */
async function attemptOwnerRow(testbed: Testbed, attemptId: string) {
  return testbed.db
    .pool()
    .query<{ student_id: string | null }>(
      "SELECT student_id FROM public.attempts WHERE id=$1",
      [attemptId]
    );
}

/** The recorded asker (`student_id`) of the tutor question logged for a quiz. */
async function tutorQuestionOwnerRow(testbed: Testbed, quiz: Quiz) {
  return testbed.db
    .pool()
    .query<{ student_id: string | null }>(
      "SELECT student_id FROM public.tutor_questions WHERE quiz_id=$1",
      [quiz.id]
    );
}

/** The `deactivated_at` stamp on a teacher's profile (NULL while active). */
async function deactivatedAtOf(testbed: Testbed, teacherId: string): Promise<string | null> {
  const res = await testbed.db
    .pool()
    .query<{ deactivated_at: string | null }>(
      "SELECT deactivated_at FROM public.profiles WHERE id=$1",
      [teacherId]
    );
  return res.rows[0]?.deactivated_at ?? null;
}

/** The current owning teacher id of a class (re-read after reassignment). */
async function classOwnerId(testbed: Testbed, classroom: Classroom): Promise<string> {
  const res = await testbed.db
    .pool()
    .query<{ teacher_id: string }>(
      "SELECT teacher_id FROM public.classes WHERE id=$1",
      [classroom.id]
    );
  return res.rows[0].teacher_id;
}

/** Whether the class row still exists (visible to the superuser inspector). */
async function classExists(testbed: Testbed, classroom: Classroom): Promise<boolean> {
  const res = await testbed.db
    .pool()
    .query("SELECT 1 FROM public.classes WHERE id=$1", [classroom.id]);
  return res.rowCount === 1;
}

describe.skipIf(!online)("lifecycle primitives", () => {
  let testbed: Testbed;
  let lincoln: School;
  let teacher: Teacher;
  let student: Student;
  let biology: Classroom;

  beforeEach(async () => {
    testbed = await freshTestbed();
    lincoln = await testbed.createSchool("Lincoln High");
    teacher = await lincoln.enrollTeacher({ name: "Ada" });
    student = await lincoln.enrollStudent({ name: "Ben" });
    biology = await teacher.openClass({ name: "Biology", language: "he" });
  });

  afterAll(async () => {
    await closePool();
  });

  // ── delete-user: student (hard-delete + anonymise) ─────────────────────────
  describe("deleteUser — student", () => {
    it("hard-deletes the student and anonymises behavioural rows", async () => {
      // Ada authors and assigns a quiz; Ben enrols, takes it, and asks the tutor —
      // leaving one attempt + one tutor question tied to him.
      const quiz = await teacher.authorQuiz({
        questions: [
          singleChoice({ prompt: "מה?", at: 10, correct: "נכון", distractors: ["לא"] }),
        ],
      });
      await teacher.assignQuiz(quiz, { to: biology });
      await biology.enroll(student);

      const attempt = await student.startAttempt(quiz, { in: biology });
      await attempt.answerAllCorrectly();
      await attempt.complete();
      await testbed.seed.logTutorQuestion({
        student,
        classroom: biology,
        quiz,
        duringAttempt: attempt,
        prompt: "why?",
        aiResponse: "because …",
      });

      const result = await testbed.admin.deleteUser(student);
      expect(result).toEqual({
        status: "deleted",
        role: "student",
        userId: student.id,
      });

      // PII gone: profile + auth user + membership removed.
      expect(await testbed.db.profileExists(student.id)).toBe(false);
      expect(await testbed.db.authUserExists(student.id)).toBe(false);
      expect(await testbed.db.isMember(biology, student)).toBe(false);

      // Behavioural rows survive with student_id NULLed (stats preserved).
      const att = await attemptOwnerRow(testbed, attempt.id);
      expect(att.rowCount).toBe(1);
      expect(att.rows[0].student_id).toBeNull();
      const tq = await tutorQuestionOwnerRow(testbed, quiz);
      expect(tq.rowCount).toBe(1);
      expect(tq.rows[0].student_id).toBeNull();
    });

    it("raises not_found for an unknown user id", async () => {
      await expect(
        testbed.admin.deleteUser(UNKNOWN_USER_ID)
      ).rejects.toMatchObject({ code: "not_found", status: 404 });
    });
  });

  // ── delete-user: teacher (must_reassign, then deletable) ───────────────────
  describe("deleteUser — teacher", () => {
    it("refuses to hard-delete a teacher owning content (must_reassign)", async () => {
      await teacher.authorQuiz(); // Ada now owns a class (biology) + a quiz

      const result = await testbed.admin.deleteUser(teacher);
      expect(result.status).toBe("must_reassign");
      if (result.status === "must_reassign") {
        expect(result.classes).toBeGreaterThanOrEqual(1);
        expect(result.quizzes).toBeGreaterThanOrEqual(1);
      }

      // Teacher still present.
      expect(await testbed.db.authUserExists(teacher.id)).toBe(true);
    });

    it("hard-deletes a teacher who owns nothing (after reassignment)", async () => {
      const quiz = await teacher.authorQuiz();
      const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });

      await testbed.admin.reassignOwnership({ from: teacher, to: peerTeacher });
      const result = await testbed.admin.deleteUser(teacher);
      expect(result.status).toBe("deleted");

      expect(await testbed.db.profileExists(teacher.id)).toBe(false);
      // Content survived, now owned by the peer teacher.
      const owned = await testbed.db.quizRow(quiz);
      expect(owned?.author_id).toBe(peerTeacher.id);
    });
  });

  // ── deactivate_teacher ─────────────────────────────────────────────────────
  describe("deactivate_teacher", () => {
    it("stamps deactivated_at and is idempotent", async () => {
      const first = await testbed.admin.deactivateTeacher(teacher);
      expect(first.deactivatedAt).toBeTruthy();

      expect(await deactivatedAtOf(testbed, teacher.id)).not.toBeNull();

      const second = await testbed.admin.deactivateTeacher(teacher);
      expect(second.deactivatedAt).toBe(first.deactivatedAt); // timestamp kept
    });

    it("strips the deactivated owner's RLS access (class still exists)", async () => {
      // UPDATED (B1): deactivateTeacher now ALSO bans the auth user, so a fresh
      // sign-in AFTER deactivation would be rejected. Ada's actor client was
      // signed in at enrolment — i.e. a token issued BEFORE deactivation (the
      // exact window B1 closes at the API level via the ban) — so we assert RLS
      // still gates the deactivated owner on that live session.
      await testbed.admin.deactivateTeacher(teacher);

      // Owner can no longer see her own class (owner helper gates on
      // deactivated_at IS NULL).
      const stillVisible = await teacher.myClasses();
      expect(stillVisible.some((c) => c.id === biology.id)).toBe(false);

      // But the class row is intact (visible to the superuser) for reassignment.
      expect(await classExists(testbed, biology)).toBe(true);
    });

    it("rejects deactivating a non-teacher", async () => {
      await expect(
        testbed.admin.deactivateTeacher(student.id)
      ).rejects.toMatchObject({ code: "not_a_teacher", status: 400 });
    });
  });

  // ── reassign_ownership ─────────────────────────────────────────────────────
  describe("reassign_ownership", () => {
    it("moves every class + quiz to the target teacher and reports counts", async () => {
      const quiz = await teacher.authorQuiz();
      const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });

      const res = await testbed.admin.reassignOwnership({
        from: teacher,
        to: peerTeacher,
      });
      expect(res.classesReassigned).toBe(1);
      expect(res.quizzesReassigned).toBe(1);

      expect(await classOwnerId(testbed, biology)).toBe(peerTeacher.id);
      const owned = await testbed.db.quizRow(quiz);
      expect(owned?.author_id).toBe(peerTeacher.id);
    });

    it("rejects reassigning to the same teacher (OT422)", async () => {
      await expect(
        testbed.admin.reassignOwnership({ from: teacher, to: teacher })
      ).rejects.toMatchObject({ code: "invalid_reassign", status: 422 });
    });

    it("rejects a deactivated target (OT409)", async () => {
      const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });
      await testbed.admin.deactivateTeacher(peerTeacher);
      await expect(
        testbed.admin.reassignOwnership({ from: teacher, to: peerTeacher })
      ).rejects.toMatchObject({ code: "reassign_conflict", status: 409 });
    });

    it("rejects a cross-school target (OT409)", async () => {
      const rivalSchool = await testbed.createSchool("Other");
      const otherSchoolTeacher = await rivalSchool.enrollTeacher({ name: "Rhea" });
      await expect(
        testbed.admin.reassignOwnership({ from: teacher, to: otherSchoolTeacher })
      ).rejects.toMatchObject({ code: "reassign_conflict", status: 409 });
    });

    it("rejects a non-teacher target (OT400)", async () => {
      await expect(
        testbed.admin.reassignOwnership({ from: teacher, to: student.id })
      ).rejects.toMatchObject({ code: "not_a_teacher", status: 400 });
    });
  });

  // ── POST /api/admin/delete-user (endpoint) ─────────────────────────────────
  describe("POST /api/admin/delete-user", () => {
    const SECRET = "test-admin-secret-value";
    let prevAdmin: string | undefined;

    beforeAll(() => {
      prevAdmin = process.env.ADMIN_SECRET;
      process.env.ADMIN_SECRET = SECRET;
    });
    afterAll(() => {
      if (prevAdmin === undefined) delete process.env.ADMIN_SECRET;
      else process.env.ADMIN_SECRET = prevAdmin;
    });

    function deleteUserRequest(body: unknown, authorization?: string): Request {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (authorization !== undefined) headers.authorization = authorization;
      return new Request("http://localhost/api/admin/delete-user", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    }

    it("401 without a bearer token", async () => {
      const res = await deleteUserRoute(deleteUserRequest({ userId: student.id }));
      expect(res.status).toBe(401);
    });

    it("401 with the wrong secret", async () => {
      const res = await deleteUserRoute(
        deleteUserRequest({ userId: student.id }, "Bearer wrong-secret-value-here")
      );
      expect(res.status).toBe(401);
    });

    it("400 with an invalid body", async () => {
      const res = await deleteUserRoute(deleteUserRequest({}, `Bearer ${SECRET}`));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("invalid_request");
    });

    it("404 for an unknown user", async () => {
      const res = await deleteUserRoute(
        deleteUserRequest({ userId: UNKNOWN_USER_ID }, `Bearer ${SECRET}`)
      );
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("not_found");
    });

    it("200 deletes a student", async () => {
      const res = await deleteUserRoute(
        deleteUserRequest({ userId: student.id }, `Bearer ${SECRET}`)
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({ status: "deleted", role: "student" });
      expect(await testbed.db.profileExists(student.id)).toBe(false);
    });

    it("409 must_reassign for a teacher owning content", async () => {
      await teacher.authorQuiz();
      const res = await deleteUserRoute(
        deleteUserRequest({ userId: teacher.id }, `Bearer ${SECRET}`)
      );
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe("must_reassign");
      expect(json.details.classes).toBeGreaterThanOrEqual(1);
    });
  });
});
