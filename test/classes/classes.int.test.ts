/**
 * Classes integration tests — classes, roster-by-email, and per-class assignment
 * (spec §3.2 / §3.5). Every action runs through an actor's AUTHENTICATED
 * (RLS-subject) client via the actor DSL (`test/helpers/testbed`), so each RPC's
 * `auth.uid()` owner/member check is real.
 *
 * Covers: class CRUD; add-student same-school / cross-school / is_teacher / invite
 * fallback + auto-conversion on signup; roster read; owner enforcement;
 * assignment storing tutor_mode/max_attempts + same-school guard + private-quiz
 * guard; soft-deleted quizzes hidden from listings; the student class-tabbed feed.
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
import { ClassError } from "@/lib/classes";

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
const online = await dbReachable();

describe.skipIf(!online)("classes / roster / assignment", () => {
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

  // ── Class CRUD ──────────────────────────────────────────────────────────────

  it("createClass creates an owned class with the caller's school", async () => {
    const created = await teacher.openClass({ name: "Bio 101", language: "en" });
    expect(created.name).toBe("Bio 101");
    expect(created.language).toBe("en");
    expect(created.teacherId).toBe(teacher.id);
    expect(created.schoolId).toBe(lincoln.id);

    const listed = await teacher.myClasses();
    expect(listed.some((c) => c.id === created.id)).toBe(true);
  });

  it("updateClass and deleteClass work for the owner", async () => {
    const temp = await teacher.openClass({ name: "Temp" });
    const updated = await temp.rename({ name: "Renamed", language: "ar" });
    expect(updated.name).toBe("Renamed");
    expect(updated.language).toBe("ar");

    await temp.delete();
    const listed = await teacher.myClasses();
    expect(listed.some((c) => c.id === temp.id)).toBe(false);
  });

  // ── Add student by email ────────────────────────────────────────────────────

  it("adds an existing same-school student", async () => {
    const result = await biology.enroll(student);
    expect(result.status).toBe("added");

    expect(await testbed.db.isMember(biology, student)).toBe(true);
  });

  it("rejects a different-school student with cross_school", async () => {
    const rivalSchool = await testbed.createSchool("Other School");
    const stranger = await rivalSchool.enrollStudent({ name: "Stranger" });
    await expect(biology.addByEmail(stranger.email)).rejects.toMatchObject({
      code: "cross_school",
    });

    expect(await testbed.db.isMember(biology, stranger)).toBe(false);
  });

  it("rejects a teacher's email with is_teacher", async () => {
    const colleague = await lincoln.enrollTeacher({ name: "Colleague" });
    await expect(biology.addByEmail(colleague.email)).rejects.toMatchObject({
      code: "is_teacher",
    });
  });

  it("creates a pending invite for an unknown email, converted on signup", async () => {
    const futureEmail = "future@test.orttube.local";
    const result = await biology.addByEmail(futureEmail);
    expect(result.status).toBe("invited");

    expect(await testbed.db.hasPendingInvite(biology, futureEmail)).toBe(true);

    // Signing up that student fires the invite-conversion trigger.
    const newcomer = await lincoln.enrollStudent({
      name: "Newcomer",
      email: futureEmail,
    });
    expect(await testbed.db.isMember(biology, newcomer)).toBe(true);
    expect(await testbed.db.hasPendingInvite(biology, futureEmail)).toBe(false);
  });

  it("remove_student and revoke_invite are idempotent and owner-scoped", async () => {
    await biology.enroll(student);
    await biology.removeStudent(student);
    await biology.removeStudent(student); // idempotent
    expect(await testbed.db.isMember(biology, student)).toBe(false);

    const pendingEmail = "pending@test.orttube.local";
    await biology.addByEmail(pendingEmail);
    await biology.revokeInvite(pendingEmail);
    expect(await testbed.db.hasPendingInvite(biology, pendingEmail)).toBe(false);
  });

  it("list_class_roster returns members + pending invites", async () => {
    await biology.enroll(student);
    await biology.addByEmail("invitee@test.orttube.local");

    const roster = await biology.roster();
    expect(roster.members.map((m) => m.student_id)).toContain(student.id);
    expect(roster.invites.map((i) => i.email)).toContain(
      "invitee@test.orttube.local"
    );
  });

  it("a non-owner teacher cannot add students (not_owner)", async () => {
    const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });
    await expect(
      peerTeacher.tryEnrollByEmail(biology, student.email)
    ).rejects.toMatchObject({ code: "not_owner" });
  });

  // ── Assignment ──────────────────────────────────────────────────────────────

  it("assign_quiz_to_class stores tutor_mode/max_attempts and returns languages", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    const result = await teacher.assignQuiz(quiz, {
      to: biology,
      tutor: "full",
      maxAttempts: 3,
      // class lang == base (he) here, so translation is a no-op anyway
    });
    expect(result.tutor_mode).toBe("full");
    expect(result.max_attempts).toBe(3);
    expect(result.class_language).toBe("he");

    const stored = await testbed.db.assignment(biology, quiz);
    expect(stored).toMatchObject({ tutor_mode: "full", max_attempts: 3 });
  });

  it("assign fires eager translation when the class language differs from base", async () => {
    // Class is `he` by default; author the quiz in `en` so the hook fires into `he`.
    const quiz = await teacher.authorQuiz({ baseLanguage: "en" });
    const translationCalls: Array<{ quizId: string; language: string }> = [];
    await teacher.assignQuiz(quiz, {
      to: biology,
      awaitTranslation: true,
      ensureTranslation: async (quizId, language) => {
        translationCalls.push({ quizId, language });
        return {
          status: "filled",
          language,
          questionsTranslated: 0,
          optionsTranslated: 0,
        };
      },
    });
    expect(translationCalls).toHaveLength(1);
    expect(translationCalls[0]).toMatchObject({ quizId: quiz.id, language: "he" });
  });

  it("rejects assigning a different-school quiz with cross_school", async () => {
    // A quiz in another school, authored by an other-school teacher.
    const rivalSchool = await testbed.createSchool("School B");
    const otherSchoolTeacher = await rivalSchool.enrollTeacher({ name: "Rhea" });
    const foreignQuiz = await otherSchoolTeacher.authorQuiz({ baseLanguage: "he" });

    await expect(
      teacher.assignQuiz(foreignQuiz, { to: biology })
    ).rejects.toMatchObject({ code: "cross_school" });
  });

  it("rejects assigning another teacher's PRIVATE same-school quiz (quiz_forbidden)", async () => {
    const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });
    const privateQuiz = await peerTeacher.authorQuiz({ baseLanguage: "he" }); // default visibility private

    await expect(
      teacher.assignQuiz(privateQuiz, { to: biology })
    ).rejects.toBeInstanceOf(ClassError);
    await expect(
      teacher.assignQuiz(privateQuiz, { to: biology })
    ).rejects.toMatchObject({ code: "quiz_forbidden" });
  });

  it("a non-owner teacher cannot assign to the class (not_owner)", async () => {
    const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });
    const quiz = await peerTeacher.authorQuiz({ baseLanguage: "he" });
    await expect(
      peerTeacher.assignQuiz(quiz, { to: biology })
    ).rejects.toMatchObject({ code: "not_owner" });
  });

  it("list_class_quizzes lists assignments and hides soft-deleted quizzes", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he", title: "Assigned Quiz" });
    await teacher.assignQuiz(quiz, { to: biology });

    let listed = await biology.assignedQuizzes();
    expect(listed.some((q) => q.quiz_id === quiz.id)).toBe(true);

    await quiz.softDelete();
    listed = await biology.assignedQuizzes();
    expect(listed.some((q) => q.quiz_id === quiz.id)).toBe(false);
  });

  it("unassign_quiz removes the assignment", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await teacher.assignQuiz(quiz, { to: biology });
    await teacher.unassignQuiz(quiz, { from: biology });
    expect(await testbed.db.assignment(biology, quiz)).toBeNull();
  });

  // ── Student feed ────────────────────────────────────────────────────────────

  it("list_assigned_for_student lists only assigned, non-deleted quizzes", async () => {
    const assigned = await teacher.authorQuiz({ baseLanguage: "he", title: "Assigned" });
    const unassigned = await teacher.authorQuiz({ baseLanguage: "he", title: "Unassigned" });
    const removed = await teacher.authorQuiz({ baseLanguage: "he", title: "Removed" });

    await biology.enroll(student);
    await teacher.assignQuiz(assigned, { to: biology });
    await teacher.assignQuiz(removed, { to: biology });
    await removed.softDelete();

    const feed = await student.assignedFeed();
    const biologyFeed = feed.find((c) => c.class_id === biology.id);
    expect(biologyFeed).toBeTruthy();
    const quizIds = biologyFeed!.quizzes.map((q) => q.quiz_id);
    expect(quizIds).toContain(assigned.id);
    expect(quizIds).not.toContain(unassigned.id);
    expect(quizIds).not.toContain(removed.id);
  });

  it("a non-member student sees no quizzes for a class they aren't in", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await teacher.assignQuiz(quiz, { to: biology });
    // `student` is NOT enrolled in `biology` here.
    const feed = await student.assignedFeed();
    expect(feed.find((c) => c.class_id === biology.id)).toBeUndefined();
  });
});
