/**
 * Schema integration tests — schema, composite FKs, immutability, invite
 * conversion, correctness validation, GRANTs and RLS (spec §3 / §7).
 *
 * DB-level invariants (composite FKs, triggers) are exercised through the raw
 * `pg` pool (superuser: bypasses RLS but NOT FK/CHECK/triggers). RLS and GRANT
 * behaviour is exercised through real anon clients signed in as the fixture
 * users — the production path (JWT → `authenticated` role → PostgREST).
 *
 * Runs at the integration/gate step (which owns DB application). Skipped when the
 * local DB is unreachable so unit suites still pass without Supabase running.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import {
  resetAndSeed,
  getPool,
  closePool,
  getServiceClient,
  createAnonClient,
  signInAs,
  type Fixture,
} from "../helpers/db";

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const online = await dbReachable();

/** Every profile created here shares one password so tests can sign in as them. */
const USER_PASSWORD = "x-password-123";

/** Create an auth user + profile via the service/superuser path; return its id. */
async function signUpUser(
  role: "teacher" | "student",
  schoolId: string,
  email: string
): Promise<string> {
  const { data, error } = await getServiceClient().auth.admin.createUser({
    email,
    password: USER_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "no user");
  const userId = data.user.id;
  await getPool().query(
    "INSERT INTO public.profiles (id, role, school_id, email) VALUES ($1,$2,$3,$4)",
    [userId, role, schoolId, email]
  );
  return userId;
}

/** Create a school by name and return its id. */
async function createSchoolNamed(name: string): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    "INSERT INTO public.schools (name) VALUES ($1) RETURNING id",
    [name]
  );
  return rows[0].id;
}

/** Sign a fresh anon client in as a user and return it (RLS-subject client). */
async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  await signInAs(client, email, password);
  return client as unknown as SupabaseClient;
}

/** Run `body` inside a single transaction so deferred constraints fire at COMMIT. */
async function inTransaction(
  body: (conn: PoolClient) => Promise<void>
): Promise<void> {
  const conn = await getPool().connect();
  try {
    await conn.query("BEGIN");
    await body(conn);
    await conn.query("COMMIT");
  } finally {
    conn.release();
  }
}

/** A quiz with one 'single' question and 4 options (one correct). */
async function createSingleChoiceQuiz(authorId: string, schoolId: string) {
  const pool = getPool();
  const video = await pool.query<{ id: string }>(
    "INSERT INTO public.videos (youtube_video_id) VALUES ($1) RETURNING id",
    [`yt-${Math.random().toString(36).slice(2)}`]
  );
  const videoId = video.rows[0].id;
  const quiz = await pool.query<{ id: string }>(
    "INSERT INTO public.quizzes (author_id, video_id, school_id) VALUES ($1,$2,$3) RETURNING id",
    [authorId, videoId, schoolId]
  );
  const quizId = quiz.rows[0].id;
  const question = await pool.query<{ id: string }>(
    "INSERT INTO public.questions (quiz_id, kind, position_seconds) VALUES ($1,'single',10) RETURNING id",
    [quizId]
  );
  const questionId = question.rows[0].id;
  await pool.query(
    `INSERT INTO public.question_options (question_id, is_correct, order_index)
     VALUES ($1,true,0),($1,false,1),($1,false,2),($1,false,3)`,
    [questionId]
  );
  return { videoId, quizId, questionId };
}

describe.skipIf(!online)("schema, constraints, triggers, RLS", () => {
  let school: Fixture["school"];
  let teacher: Fixture["teacher"];
  let student: Fixture["student"];
  let classroom: Fixture["klass"];

  beforeEach(async () => {
    ({ school, teacher, student, klass: classroom } = await resetAndSeed());
  });

  afterAll(async () => {
    await closePool();
  });

  // ── Composite FK integrity ─────────────────────────────────────────────────
  describe("composite FKs", () => {
    it("rejects a class owned by a student (role-checked FK)", async () => {
      await expect(
        getPool().query(
          "INSERT INTO public.classes (teacher_id, school_id, name) VALUES ($1,$2,'bad')",
          [student.id, school.id]
        )
      ).rejects.toThrow();
    });

    it("rejects enrolling a teacher as a class member (role-checked FK)", async () => {
      await expect(
        getPool().query(
          "INSERT INTO public.class_members (class_id, student_id) VALUES ($1,$2)",
          [classroom.id, teacher.id]
        )
      ).rejects.toThrow();
    });

    it("rejects a class whose school differs from the teacher's (school-checked FK)", async () => {
      const rivalSchoolId = await createSchoolNamed("Other");
      await expect(
        getPool().query(
          "INSERT INTO public.classes (teacher_id, school_id, name) VALUES ($1,$2,'bad')",
          [teacher.id, rivalSchoolId]
        )
      ).rejects.toThrow();
    });
  });

  // ── Immutability ───────────────────────────────────────────────────────────
  describe("role / school immutability", () => {
    it("blocks role changes at the DB trigger", async () => {
      await expect(
        getPool().query("UPDATE public.profiles SET role='student' WHERE id=$1", [
          teacher.id,
        ])
      ).rejects.toThrow(/immutable/);
    });

    it("blocks school_id changes at the DB trigger", async () => {
      const rivalSchoolId = await createSchoolNamed("Other");
      await expect(
        getPool().query("UPDATE public.profiles SET school_id=$1 WHERE id=$2", [
          rivalSchoolId,
          teacher.id,
        ])
      ).rejects.toThrow(/immutable/);
    });

    it("an authenticated client cannot update role (column REVOKE)", async () => {
      const asTeacher = await signIn(teacher.email, teacher.password);
      const { error } = await asTeacher
        .from("profiles")
        .update({ role: "student" })
        .eq("id", teacher.id);
      expect(error).not.toBeNull();
    });

    it("an authenticated client CAN self-update display_name", async () => {
      const asTeacher = await signIn(teacher.email, teacher.password);
      const { error } = await asTeacher
        .from("profiles")
        .update({ display_name: "Renamed" })
        .eq("id", teacher.id);
      expect(error).toBeNull();
      const { rows } = await getPool().query(
        "SELECT display_name FROM public.profiles WHERE id=$1",
        [teacher.id]
      );
      expect(rows[0].display_name).toBe("Renamed");
    });
  });

  // ── Invite conversion ──────────────────────────────────────────────────────
  describe("invite → membership conversion", () => {
    it("converts a matching invite to a membership and deletes the invite", async () => {
      const pool = getPool();
      const inviteeEmail = "invitee@test.orttube.local";
      await pool.query(
        "INSERT INTO public.class_invites (class_id, email) VALUES ($1,$2)",
        [classroom.id, inviteeEmail]
      );
      // Creating the student profile fires the AFTER INSERT trigger.
      await signUpUser("student", school.id, inviteeEmail);

      const membership = await pool.query(
        "SELECT 1 FROM public.class_members WHERE class_id=$1 AND student_id=(SELECT id FROM public.profiles WHERE email=$2)",
        [classroom.id, inviteeEmail]
      );
      const remainingInvite = await pool.query(
        "SELECT 1 FROM public.class_invites WHERE class_id=$1 AND email=$2",
        [classroom.id, inviteeEmail]
      );
      expect(membership.rowCount).toBe(1);
      expect(remainingInvite.rowCount).toBe(0);
    });

    it("matches invites case-insensitively (citext)", async () => {
      const pool = getPool();
      await pool.query(
        "INSERT INTO public.class_invites (class_id, email) VALUES ($1,'mixedcase@test.local')",
        [classroom.id]
      );
      const studentId = await signUpUser(
        "student",
        school.id,
        "MixedCase@test.local"
      );
      const membership = await pool.query(
        "SELECT 1 FROM public.class_members WHERE class_id=$1 AND student_id=$2",
        [classroom.id, studentId]
      );
      expect(membership.rowCount).toBe(1);
    });

    it("does not convert an invite from a different school", async () => {
      const pool = getPool();
      const rivalSchoolId = await createSchoolNamed("Other");
      const otherSchoolTeacherId = await signUpUser(
        "teacher",
        rivalSchoolId,
        "ot@test.local"
      );
      const otherSchoolClass = await pool.query<{ id: string }>(
        "INSERT INTO public.classes (teacher_id, school_id, name) VALUES ($1,$2,'OC') RETURNING id",
        [otherSchoolTeacherId, rivalSchoolId]
      );
      const inviteeEmail = "xschool@test.local";
      await pool.query(
        "INSERT INTO public.class_invites (class_id, email) VALUES ($1,$2)",
        [otherSchoolClass.rows[0].id, inviteeEmail]
      );
      // Student signs up into our school — the other-school invite must NOT convert.
      const studentId = await signUpUser("student", school.id, inviteeEmail);
      const membership = await pool.query(
        "SELECT 1 FROM public.class_members WHERE student_id=$1",
        [studentId]
      );
      expect(membership.rowCount).toBe(0);
    });
  });

  // ── Correctness validation (deferred constraint trigger) ────────────────────
  describe("correctness validation", () => {
    it("rejects a single-choice question with two correct options at commit", async () => {
      const { quizId } = await createSingleChoiceQuiz(teacher.id, school.id);
      await expect(
        inTransaction(async (conn) => {
          const question = await conn.query<{ id: string }>(
            "INSERT INTO public.questions (quiz_id, kind, position_seconds) VALUES ($1,'single',20) RETURNING id",
            [quizId]
          );
          await conn.query(
            "INSERT INTO public.question_options (question_id, is_correct) VALUES ($1,true),($1,true)",
            [question.rows[0].id]
          );
        })
      ).rejects.toThrow();
    });

    it("rejects a multi-select question with zero correct options at commit", async () => {
      const { quizId } = await createSingleChoiceQuiz(teacher.id, school.id);
      await expect(
        inTransaction(async (conn) => {
          const question = await conn.query<{ id: string }>(
            "INSERT INTO public.questions (quiz_id, kind, position_seconds) VALUES ($1,'multi',20) RETURNING id",
            [quizId]
          );
          await conn.query(
            "INSERT INTO public.question_options (question_id, is_correct) VALUES ($1,false),($1,false)",
            [question.rows[0].id]
          );
        })
      ).rejects.toThrow();
    });

    it("accepts a single-choice question with exactly one correct option", async () => {
      const { quizId } = await createSingleChoiceQuiz(teacher.id, school.id);
      await expect(
        inTransaction(async (conn) => {
          const question = await conn.query<{ id: string }>(
            "INSERT INTO public.questions (quiz_id, kind, position_seconds) VALUES ($1,'single',30) RETURNING id",
            [quizId]
          );
          await conn.query(
            "INSERT INTO public.question_options (question_id, is_correct) VALUES ($1,true),($1,false)",
            [question.rows[0].id]
          );
        })
      ).resolves.toBeUndefined();
    });

    it("rejects flipping multi→single when two correct options remain", async () => {
      const { quizId } = await createSingleChoiceQuiz(teacher.id, school.id);
      await expect(
        inTransaction(async (conn) => {
          const question = await conn.query<{ id: string }>(
            "INSERT INTO public.questions (quiz_id, kind, position_seconds) VALUES ($1,'multi',40) RETURNING id",
            [quizId]
          );
          await conn.query(
            "INSERT INTO public.question_options (question_id, is_correct) VALUES ($1,true),($1,true)",
            [question.rows[0].id]
          );
          await conn.query("UPDATE public.questions SET kind='single' WHERE id=$1", [
            question.rows[0].id,
          ]);
        })
      ).rejects.toThrow();
    });
  });

  // ── RLS ────────────────────────────────────────────────────────────────────
  describe("RLS", () => {
    it("a student cannot read question_options (answer key hidden)", async () => {
      const { questionId } = await createSingleChoiceQuiz(teacher.id, school.id);
      await getPool().query(
        "INSERT INTO public.class_members (class_id, student_id) VALUES ($1,$2)",
        [classroom.id, student.id]
      );
      const asStudent = await signIn(student.email, student.password);
      const { data, error } = await asStudent
        .from("question_options")
        .select("id, is_correct")
        .eq("question_id", questionId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("the owning teacher CAN read their own question_options", async () => {
      const { questionId } = await createSingleChoiceQuiz(teacher.id, school.id);
      const asTeacher = await signIn(teacher.email, teacher.password);
      const { data, error } = await asTeacher
        .from("question_options")
        .select("id")
        .eq("question_id", questionId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(4);
    });

    it("the owning teacher reads their own class; a cross-school teacher cannot", async () => {
      const rivalSchoolId = await createSchoolNamed("Other");
      const otherSchoolTeacherEmail = "ot2@test.local";
      await signUpUser("teacher", rivalSchoolId, otherSchoolTeacherEmail);

      const asOwner = await signIn(teacher.email, teacher.password);
      const ownerRead = await asOwner
        .from("classes")
        .select("id")
        .eq("id", classroom.id);
      expect(ownerRead.data ?? []).toHaveLength(1);

      const asOtherSchoolTeacher = await signIn(
        otherSchoolTeacherEmail,
        USER_PASSWORD
      );
      const otherRead = await asOtherSchoolTeacher
        .from("classes")
        .select("id")
        .eq("id", classroom.id);
      expect(otherRead.data ?? []).toHaveLength(0);
    });

    it("a student reads a class they belong to", async () => {
      await getPool().query(
        "INSERT INTO public.class_members (class_id, student_id) VALUES ($1,$2)",
        [classroom.id, student.id]
      );
      const asStudent = await signIn(student.email, student.password);
      const { data } = await asStudent
        .from("classes")
        .select("id")
        .eq("id", classroom.id);
      expect(data ?? []).toHaveLength(1);
    });

    it("a student cannot directly write attempts (no INSERT grant)", async () => {
      await getPool().query(
        "INSERT INTO public.class_members (class_id, student_id) VALUES ($1,$2)",
        [classroom.id, student.id]
      );
      const { quizId } = await createSingleChoiceQuiz(teacher.id, school.id);
      const asStudent = await signIn(student.email, student.password);
      const { error } = await asStudent.from("attempts").insert({
        student_id: student.id,
        class_id: classroom.id,
        quiz_id: quizId,
      });
      expect(error).not.toBeNull();
    });

    it("a teacher cannot directly write class_members (SELECT-only grant forces the RPC)", async () => {
      const asTeacher = await signIn(teacher.email, teacher.password);
      const { error } = await asTeacher
        .from("class_members")
        .insert({ class_id: classroom.id, student_id: student.id });
      expect(error).not.toBeNull();
    });

    it("a same-school student cannot read is_correct of a SHARED quiz", async () => {
      const { questionId, quizId } = await createSingleChoiceQuiz(
        teacher.id,
        school.id
      );
      await getPool().query(
        "UPDATE public.quizzes SET visibility='shared' WHERE id=$1",
        [quizId]
      );
      await getPool().query(
        "INSERT INTO public.class_members (class_id, student_id) VALUES ($1,$2)",
        [classroom.id, student.id]
      );
      const asStudent = await signIn(student.email, student.password);
      const { data } = await asStudent
        .from("question_options")
        .select("is_correct")
        .eq("question_id", questionId);
      expect(data ?? []).toHaveLength(0);
    });

    it("a same-school teacher can read a SHARED quiz; a cross-school teacher cannot", async () => {
      const { quizId } = await createSingleChoiceQuiz(teacher.id, school.id);
      await getPool().query(
        "UPDATE public.quizzes SET visibility='shared' WHERE id=$1",
        [quizId]
      );
      const sameSchoolTeacherEmail = "t-same@test.local";
      await signUpUser("teacher", school.id, sameSchoolTeacherEmail);
      const rivalSchoolId = await createSchoolNamed("Other");
      const crossSchoolTeacherEmail = "t-cross@test.local";
      await signUpUser("teacher", rivalSchoolId, crossSchoolTeacherEmail);

      const asSameSchoolTeacher = await signIn(
        sameSchoolTeacherEmail,
        USER_PASSWORD
      );
      const sameSchoolRead = await asSameSchoolTeacher
        .from("quizzes")
        .select("id")
        .eq("id", quizId);
      expect(sameSchoolRead.data ?? []).toHaveLength(1);

      const asCrossSchoolTeacher = await signIn(
        crossSchoolTeacherEmail,
        USER_PASSWORD
      );
      const crossSchoolRead = await asCrossSchoolTeacher
        .from("quizzes")
        .select("id")
        .eq("id", quizId);
      expect(crossSchoolRead.data ?? []).toHaveLength(0);
    });

    it("a deactivated teacher loses owner access to their class", async () => {
      await getPool().query(
        "UPDATE public.profiles SET deactivated_at=now() WHERE id=$1",
        [teacher.id]
      );
      const asTeacher = await signIn(teacher.email, teacher.password);
      const { data } = await asTeacher
        .from("classes")
        .select("id")
        .eq("id", classroom.id);
      expect(data ?? []).toHaveLength(0);
    });

    it("any authenticated user can read videos and schools", async () => {
      await getPool().query(
        "INSERT INTO public.videos (youtube_video_id) VALUES ('yt-public')"
      );
      const asStudent = await signIn(student.email, student.password);
      const videos = await asStudent.from("videos").select("id");
      const schools = await asStudent.from("schools").select("id");
      expect((videos.data ?? []).length).toBeGreaterThanOrEqual(1);
      expect((schools.data ?? []).length).toBeGreaterThanOrEqual(1);
    });
  });
});
