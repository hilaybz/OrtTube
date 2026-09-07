import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { closePool } from "../helpers/db";
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
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

const UNKNOWN_USER_ID = "00000000-0000-0000-0000-000000000000";

async function attemptOwnerRow(testbed: Testbed, attemptId: string) {
  return testbed.db
    .pool()
    .query<{ student_id: string | null }>(
      "SELECT student_id FROM public.attempts WHERE id=$1",
      [attemptId]
    );
}

async function tutorQuestionOwnerRow(testbed: Testbed, quiz: Quiz) {
  return testbed.db
    .pool()
    .query<{ student_id: string | null }>(
      "SELECT student_id FROM public.tutor_questions WHERE quiz_id=$1",
      [quiz.id]
    );
}

async function deactivatedAtOf(testbed: Testbed, teacherId: string): Promise<string | null> {
  const res = await testbed.db
    .pool()
    .query<{ deactivated_at: string | null }>(
      "SELECT deactivated_at FROM public.profiles WHERE id=$1",
      [teacherId]
    );
  return res.rows[0]?.deactivated_at ?? null;
}

async function classOwnerId(testbed: Testbed, classroom: Classroom): Promise<string> {
  const res = await testbed.db
    .pool()
    .query<{ teacher_id: string }>(
      "SELECT teacher_id FROM public.classes WHERE id=$1",
      [classroom.id]
    );
  return res.rows[0].teacher_id;
}

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

  describe("deleteUser — student", () => {
    it("hard-deletes the student and anonymises behavioural rows", async () => {
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

      expect(await testbed.db.profileExists(student.id)).toBe(false);
      expect(await testbed.db.authUserExists(student.id)).toBe(false);
      expect(await testbed.db.isMember(biology, student)).toBe(false);

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

  describe("deleteUser — teacher", () => {
    it("refuses to hard-delete a teacher owning content (must_reassign)", async () => {
      await teacher.authorQuiz();

      const result = await testbed.admin.deleteUser(teacher);
      expect(result.status).toBe("must_reassign");
      if (result.status === "must_reassign") {
        expect(result.classes).toBeGreaterThanOrEqual(1);
        expect(result.quizzes).toBeGreaterThanOrEqual(1);
      }

      expect(await testbed.db.authUserExists(teacher.id)).toBe(true);
    });

    it("hard-deletes a teacher who owns nothing (after reassignment)", async () => {
      const quiz = await teacher.authorQuiz();
      const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });

      await testbed.admin.reassignOwnership({ from: teacher, to: peerTeacher });
      const result = await testbed.admin.deleteUser(teacher);
      expect(result.status).toBe("deleted");

      expect(await testbed.db.profileExists(teacher.id)).toBe(false);
      const owned = await testbed.db.quizRow(quiz);
      expect(owned?.author_id).toBe(peerTeacher.id);
    });
  });

  describe("deactivate_teacher", () => {
    it("stamps deactivated_at and is idempotent", async () => {
      const first = await testbed.admin.deactivateTeacher(teacher);
      expect(first.deactivatedAt).toBeTruthy();

      expect(await deactivatedAtOf(testbed, teacher.id)).not.toBeNull();

      const second = await testbed.admin.deactivateTeacher(teacher);
      expect(second.deactivatedAt).toBe(first.deactivatedAt);
    });

    it("strips the deactivated owner's RLS access (class still exists)", async () => {
      // `deactivateTeacher` also bans the auth user, so a fresh sign-in after
      // deactivation is rejected. Ada's actor client signed in at enrolment —
      // a token issued BEFORE deactivation — so this asserts RLS still gates
      // the deactivated owner on that live session.
      await testbed.admin.deactivateTeacher(teacher);

      const stillVisible = await teacher.myClasses();
      expect(stillVisible.some((c) => c.id === biology.id)).toBe(false);

      expect(await classExists(testbed, biology)).toBe(true);
    });

    it("rejects deactivating a non-teacher", async () => {
      await expect(
        testbed.admin.deactivateTeacher(student.id)
      ).rejects.toMatchObject({ code: "not_a_teacher", status: 400 });
    });
  });

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
