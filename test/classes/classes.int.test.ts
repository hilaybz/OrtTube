/**
 * Classes integration tests — classes, roster-by-email, and per-class assignment
 * (spec §3.2 / §3.5). Every action runs through an actor's AUTHENTICATED
 * (RLS-subject) client via the actor DSL (`test/helpers/testbed`), so each RPC's
 * `auth.uid()` owner/member check is real.
 *
 * Covers: class CRUD; add-student same-school / cross-school / is_teacher / invite
 * fallback + auto-conversion on signup; roster read; owner enforcement;
 * assignment storing tutor_mode/max_attempts + same-school guard + private-quiz
 * guard; soft-deleted quizzes hidden from listings; the student class-tabbed feed;
 * the published/draft split (2A.1) across every student-facing read; the
 * scheduling-window setter, quiz-side allocation reads, and bulk-assign
 * (2A.2 / 2A.3). Attempt-level window enforcement (force-completion, the
 * reveal gate, the cron sweep) lives in `test/attempts/window.int.test.ts`.
 *
 * Runs at the integration/gate step (owns DB application). Skipped when the local
 * DB is unreachable so unit suites still pass without Supabase running.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { closePool } from "../helpers/db";
import {
  freshTestbed,
  singleChoice,
  type Testbed,
  type School,
  type Teacher,
  type Student,
  type Classroom,
} from "../helpers/testbed";
import { ClassError } from "@/lib/classes";
import { stackOnline } from "../helpers/stack";

const online = await stackOnline();

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

  it("list_class_quizzes reports is_own/author_name for the caller's own quiz vs. an assigned shared quiz", async () => {
    const ownQuiz = await teacher.authorQuiz({ baseLanguage: "he", title: "Mine" });
    await teacher.assignQuiz(ownQuiz, { to: biology });

    const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });
    const sharedQuiz = await peerTeacher.authorQuiz({
      baseLanguage: "he",
      title: "Grace's Quiz",
      visibility: "shared",
    });
    await teacher.assignQuiz(sharedQuiz, { to: biology });

    const listed = await biology.assignedQuizzes();
    const ownRow = listed.find((q) => q.quiz_id === ownQuiz.id)!;
    expect(ownRow.is_own).toBe(true);
    expect(ownRow.author_id).toBe(teacher.id);

    const sharedRow = listed.find((q) => q.quiz_id === sharedQuiz.id)!;
    expect(sharedRow.is_own).toBe(false);
    expect(sharedRow.author_id).toBe(peerTeacher.id);
    expect(sharedRow.author_name).toBe("Grace");
  });

  it("unassign_quiz removes the assignment", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await teacher.assignQuiz(quiz, { to: biology });
    await teacher.unassignQuiz(quiz, { from: biology });
    expect(await testbed.db.assignment(biology, quiz)).toBeNull();
  });

  // ── Student feed ────────────────────────────────────────────────────────────

  it("list_student_feed lists only assigned, non-deleted quizzes", async () => {
    const assigned = await teacher.authorQuiz({ baseLanguage: "he", title: "Assigned" });
    const unassigned = await teacher.authorQuiz({ baseLanguage: "he", title: "Unassigned" });
    const removed = await teacher.authorQuiz({ baseLanguage: "he", title: "Removed" });

    await biology.enroll(student);
    await teacher.assignQuiz(assigned, { to: biology });
    await teacher.assignQuiz(removed, { to: biology });
    await removed.softDelete();

    const feed = await student.feed();
    const quizIds = feed.filter((i) => i.class_id === biology.id).map((i) => i.quiz_id);
    expect(quizIds).toContain(assigned.id);
    expect(quizIds).not.toContain(unassigned.id);
    expect(quizIds).not.toContain(removed.id);
  });

  it("list_student_feed carries the quiz's duration fields (issue #80)", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he", title: "Timed" });
    await teacher.client.rpc("update_quiz", {
      p_quiz_id: quiz.id,
      p_time_restricted: true,
      p_duration_minutes: 9,
    });
    await biology.enroll(student);
    await teacher.assignQuiz(quiz, { to: biology });

    const item = (await student.feed()).find((i) => i.quiz_id === quiz.id)!;
    expect(item.time_restricted).toBe(true);
    expect(item.duration_minutes).toBe(9);
    // `authorQuiz`'s fixture always sets p_duration_seconds: 600.
    expect(item.duration_seconds).toBe(600);
  });

  it("list_student_feed reports a null video length as null, not an error (issue #80)", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he", title: "Unknown length" });
    await testbed.db.clearVideoDuration(quiz);
    await biology.enroll(student);
    await teacher.assignQuiz(quiz, { to: biology });

    const item = (await student.feed()).find((i) => i.quiz_id === quiz.id)!;
    expect(item.time_restricted).toBe(false);
    expect(item.duration_seconds).toBeNull();
  });

  it("a non-member student sees no quizzes for a class they aren't in", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await teacher.assignQuiz(quiz, { to: biology });
    // `student` is NOT enrolled in `biology` here.
    const feed = await student.feed();
    expect(feed.some((i) => i.class_id === biology.id)).toBe(false);
  });

  it("reports the class-owning teacher's name, not a shared quiz's author", async () => {
    const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });
    const quiz = await peerTeacher.authorQuiz({ baseLanguage: "he", visibility: "shared" });
    await biology.enroll(student);
    await teacher.assignQuiz(quiz, { to: biology });

    const feed = await student.feed();
    const item = feed.find((i) => i.quiz_id === quiz.id);
    expect(item!.teacher_name).toBe(teacher.name);
  });

  it("marks an unstarted live allocation as not_started", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await biology.enroll(student);
    await teacher.assignQuiz(quiz, { to: biology });

    const feed = await student.feed();
    expect(feed.find((i) => i.quiz_id === quiz.id)!.status).toBe("not_started");
  });

  it("marks an in-progress attempt as in_progress, even with a prior completed attempt", async () => {
    const quiz = await teacher.authorQuiz({
      baseLanguage: "he",
      questions: [singleChoice({ prompt: "Q", at: 5, correct: "yes", distractors: ["no"] })],
    });
    await biology.enroll(student);
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });

    const attempt1 = await student.startAttempt(quiz, { in: biology });
    await attempt1.answerAllCorrectly();
    await attempt1.complete();
    await student.startAttempt(quiz, { in: biology }); // attempt 2, left unfinished

    const feed = await student.feed();
    const item = feed.find((i) => i.quiz_id === quiz.id);
    expect(item!.status).toBe("in_progress");
    expect(item!.resume_attempt_id).toBeTruthy();
  });

  it("reports the LATEST completed attempt's score, not the best of several", async () => {
    const quiz = await teacher.authorQuiz({
      baseLanguage: "he",
      questions: [
        singleChoice({ prompt: "Q1", at: 5, correct: "yes", distractors: ["no"] }),
        singleChoice({ prompt: "Q2", at: 10, correct: "yes", distractors: ["no"] }),
      ],
    });
    await biology.enroll(student);
    await teacher.assignQuiz(quiz, { to: biology, maxAttempts: null });

    // Attempt 1: both correct (2/2).
    const attempt1 = await student.startAttempt(quiz, { in: biology });
    await attempt1.answerAllCorrectly();
    await attempt1.complete();

    // Attempt 2 (the latest): one wrong (1/2) — this is the score that must win.
    const attempt2 = await student.startAttempt(quiz, { in: biology });
    await attempt2.answerCorrectly(quiz.questions[0]);
    await attempt2.answer(quiz.questions[1], []);
    await attempt2.complete();

    const feed = await student.feed();
    const item = feed.find((i) => i.quiz_id === quiz.id);
    expect(item!.status).toBe("completed");
    expect(item!.last_num_correct).toBe(1);
    expect(item!.last_num_questions).toBe(2);
  });

  it("marks a closed allocation with zero attempts as missed", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await biology.enroll(student);
    await teacher.assignQuiz(quiz, {
      to: biology,
      availableUntil: new Date(Date.now() - 60_000).toISOString(),
    });

    const feed = await student.feed();
    const item = feed.find((i) => i.quiz_id === quiz.id);
    expect(item).toBeTruthy();
    expect(item!.status).toBe("missed");
    expect(item!.last_num_correct).toBeNull();
  });

  it("issue #69: keeps a completed attempt visible as completed (not missed, not gone) after its window later closes", async () => {
    const quiz = await teacher.authorQuiz({
      baseLanguage: "he",
      questions: [singleChoice({ prompt: "Q", at: 5, correct: "yes", distractors: ["no"] })],
    });
    await biology.enroll(student);
    await teacher.assignQuiz(quiz, { to: biology });

    const attempt = await student.startAttempt(quiz, { in: biology });
    await attempt.answerAllCorrectly();
    await attempt.complete();

    // Close the window AFTER completion — before this fix, the allocation
    // would simply vanish from the feed the instant it closed.
    await teacher.setSchedule(quiz, {
      in: biology,
      availableFrom: null,
      availableUntil: new Date(Date.now() - 60_000).toISOString(),
    });

    const feed = await student.feed();
    const item = feed.find((i) => i.quiz_id === quiz.id);
    expect(item).toBeTruthy();
    expect(item!.status).toBe("completed");
    expect(item!.last_num_correct).toBe(1);
    expect(item!.last_num_questions).toBe(1);
  });

  it("omits a published-but-not-yet-open allocation entirely", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await biology.enroll(student);
    await teacher.assignQuiz(quiz, {
      to: biology,
      availableFrom: new Date(Date.now() + 3600_000).toISOString(),
    });

    const feed = await student.feed();
    expect(feed.some((i) => i.quiz_id === quiz.id)).toBe(false);
  });

  it("omits an unpublished (draft) allocation, and a draft never counts as missed even past its would-be window", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await biology.enroll(student);
    await teacher.assignQuiz(quiz, {
      to: biology,
      published: false,
      availableUntil: new Date(Date.now() - 60_000).toISOString(),
    });

    const feed = await student.feed();
    expect(feed.some((i) => i.quiz_id === quiz.id)).toBe(false);
  });

  // ── Publish/draft (2A.1) ────────────────────────────────────────────────────

  it("assigning without `published` behaves exactly as before: instantly visible", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    const result = await teacher.assignQuiz(quiz, { to: biology });
    expect(result.published).toBe(true);

    await biology.enroll(student);
    const view = await student.viewQuiz(quiz, { in: biology });
    expect(view.quiz_id).toBe(quiz.id);
    const attempt = await student.startAttempt(quiz, { in: biology });
    expect(attempt).toBeTruthy();
    const tutor = await student.tutorContext(quiz, { in: biology });
    expect(tutor.tutor_mode).toBeDefined();

    const feed = await student.feed();
    expect(feed.some((i) => i.class_id === biology.id && i.quiz_id === quiz.id)).toBe(true);
  });

  it("an unpublished assignment is invisible to students everywhere, but not to the owner", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await teacher.assignQuiz(quiz, { to: biology, published: false });
    await biology.enroll(student);

    await expect(
      student.viewQuiz(quiz, { in: biology })
    ).rejects.toMatchObject({ code: "not_assigned" });
    await expect(
      student.startAttempt(quiz, { in: biology })
    ).rejects.toMatchObject({ code: "not_assigned" });
    await expect(
      student.tutorContext(quiz, { in: biology })
    ).rejects.toMatchObject({ code: "not_assigned" });

    const feed = await student.feed();
    expect(feed.some((i) => i.class_id === biology.id && i.quiz_id === quiz.id)).toBe(false);

    // The owner still sees the draft assignment.
    const listed = await biology.assignedQuizzes();
    const row = listed.find((q) => q.quiz_id === quiz.id);
    expect(row).toBeTruthy();
    expect(row!.published).toBe(false);
  });

  it("set_class_quiz_published toggles visibility without touching tutor_mode/max_attempts", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await teacher.assignQuiz(quiz, {
      to: biology,
      published: false,
      tutor: "full",
      maxAttempts: 3,
    });
    await biology.enroll(student);

    await teacher.setQuizPublished(quiz, { in: biology, published: true });
    let stored = await testbed.db.assignment(biology, quiz);
    expect(stored).toMatchObject({
      published: true,
      tutor_mode: "full",
      max_attempts: 3,
    });
    await expect(student.viewQuiz(quiz, { in: biology })).resolves.toMatchObject({
      quiz_id: quiz.id,
    });

    await teacher.setQuizPublished(quiz, { in: biology, published: false });
    stored = await testbed.db.assignment(biology, quiz);
    expect(stored!.published).toBe(false);
    await expect(
      student.viewQuiz(quiz, { in: biology })
    ).rejects.toMatchObject({ code: "not_assigned" });
  });

  it("a non-owner teacher cannot toggle publish state (not_owner)", async () => {
    const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await teacher.assignQuiz(quiz, { to: biology });

    await expect(
      peerTeacher.setQuizPublished(quiz, { in: biology, published: false })
    ).rejects.toMatchObject({ code: "not_owner" });
  });

  // ── Scheduling window & allocation reads (2A.2 / 2A.3) ──────────────────────

  it("assign rejects an invalid schedule window (availableFrom not before availableUntil)", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    const t = new Date().toISOString();
    await expect(
      teacher.assignQuiz(quiz, { to: biology, availableFrom: t, availableUntil: t })
    ).rejects.toMatchObject({ code: "invalid_schedule_window" });
  });

  it("set_class_quiz_schedule replaces the window without touching tutor_mode/max_attempts/published", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    await teacher.assignQuiz(quiz, { to: biology, tutor: "full", maxAttempts: 3 });
    const until = new Date(Date.now() + 3600_000).toISOString();
    await teacher.setSchedule(quiz, { in: biology, availableFrom: null, availableUntil: until });

    const stored = await testbed.db.assignment(biology, quiz);
    expect(stored).toMatchObject({ tutor_mode: "full", max_attempts: 3, published: true });
    expect(new Date(stored!.available_until!).getTime()).toBe(new Date(until).getTime());
    expect(stored!.available_from).toBeNull();
  });

  it("list_quiz_allocations returns every state to the owner, not_owner to everyone else", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    const secondClass = await teacher.openClass({ name: "History", language: "he" });
    await teacher.assignQuiz(quiz, { to: biology, published: false }); // draft
    await teacher.assignQuiz(quiz, { to: secondClass }); // live

    const allocations = await teacher.listAllocations(quiz);
    expect(allocations).toHaveLength(2);
    const byClass = new Map(allocations.map((a) => [a.class_id, a]));
    expect(byClass.get(biology.id)!.published).toBe(false);
    expect(byClass.get(secondClass.id)!.published).toBe(true);

    const peerTeacher = await lincoln.enrollTeacher({ name: "Grace" });
    await expect(peerTeacher.listAllocations(quiz)).rejects.toMatchObject({
      code: "not_owner",
    });
  });

  it("list_my_quiz_allocation_tags buckets live vs scheduled; drafts/closed appear with empty buckets; unallocated quizzes are absent", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    const liveClass = await teacher.openClass({ name: "Live", language: "he" });
    const scheduledClass = await teacher.openClass({ name: "Scheduled", language: "he" });
    const draftClass = await teacher.openClass({ name: "Draft", language: "he" });
    const closedClass = await teacher.openClass({ name: "Closed", language: "he" });

    await teacher.assignQuiz(quiz, { to: liveClass });
    await teacher.assignQuiz(quiz, {
      to: scheduledClass,
      availableFrom: new Date(Date.now() + 3600_000).toISOString(),
    });
    await teacher.assignQuiz(quiz, { to: draftClass, published: false });
    await teacher.assignQuiz(quiz, {
      to: closedClass,
      availableUntil: new Date(Date.now() - 60_000).toISOString(),
    });
    const untouchedQuiz = await teacher.authorQuiz({
      baseLanguage: "he",
      title: "Never allocated",
    });

    const tags = await teacher.listAllocationTags();
    const forQuiz = tags.find((t) => t.quiz_id === quiz.id);
    expect(forQuiz).toBeTruthy();
    expect(forQuiz!.live.map((c) => c.class_id)).toEqual([liveClass.id]);
    expect(forQuiz!.scheduled.map((c) => c.class_id)).toEqual([scheduledClass.id]);
    // Draft and closed land in neither bucket, but the quiz itself still shows
    // up (both buckets present, both empty of THOSE classes) — it just isn't
    // tagged live or scheduled for draftClass/closedClass.
    expect(forQuiz!.live.map((c) => c.class_id)).not.toContain(draftClass.id);
    expect(forQuiz!.live.map((c) => c.class_id)).not.toContain(closedClass.id);
    expect(forQuiz!.scheduled.map((c) => c.class_id)).not.toContain(draftClass.id);
    expect(forQuiz!.scheduled.map((c) => c.class_id)).not.toContain(closedClass.id);
    // A quiz with no allocation at all doesn't appear.
    expect(tags.some((t) => t.quiz_id === untouchedQuiz.id)).toBe(false);
  });

  it("bulk-assign assigns to several classes in one call; a bad class id fails only that entry", async () => {
    const quiz = await teacher.authorQuiz({ baseLanguage: "he" });
    const classA = await teacher.openClass({ name: "A", language: "he" });
    const classB = await teacher.openClass({ name: "B", language: "he" });

    const result = await teacher.bulkAssign(quiz, {
      classIds: [classA.id, classB.id, "00000000-0000-0000-0000-000000000000"],
      tutor: "full",
      maxAttempts: 2,
    });

    expect(result.assigned).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].classId).toBe("00000000-0000-0000-0000-000000000000");

    expect(await testbed.db.assignment(classA, quiz)).toMatchObject({
      tutor_mode: "full",
      max_attempts: 2,
    });
    expect(await testbed.db.assignment(classB, quiz)).toMatchObject({
      tutor_mode: "full",
      max_attempts: 2,
    });
  });
});
