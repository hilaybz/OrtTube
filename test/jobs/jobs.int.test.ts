/**
 * Jobs integration tests — scheduled maintenance jobs (spec §6.1, §3.3).
 *
 *   • CRON_SECRET guard on every /api/jobs/* endpoint.
 *   • purge-content: hard-deletes quizzes past the retention window at QUIZ
 *     granularity (cascade removes children; a lone soft-deleted question in a
 *     live quiz survives).
 *   • gc-videos: deletes orphan videos past the grace window (no referencing
 *     quiz or tutor_questions), best-effort removes their Storage transcript.
 *   • reconcile-auth: deletes auth.users with no profile older than N minutes.
 *   • sweep-transcripts: deletes Storage transcript objects older than the TTL.
 *
 * Domain actors (school / teacher / student / classroom) are minted through the
 * actor DSL in `test/helpers/testbed` so FK owners read as who-they-are. The
 * retention arrangement itself (back-dated `deleted_at`/`created_at`, Storage
 * objects, `auth.users` timestamps) has no clean domain action, so it stays as
 * honest raw `pg`/Storage plumbing behind small, named helpers.
 *
 * Runs at the integration/gate step (which owns DB application). Auth-guard cases
 * run unconditionally; the DB-touching cases are skipped when the local DB is
 * unreachable so unit suites still pass without Supabase running.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { getPool, closePool, getServiceClient } from "../helpers/db";
import {
  freshTestbed,
  type School,
  type Teacher,
  type Student,
  type Classroom,
} from "../helpers/testbed";
import { TRANSCRIPT_BUCKET } from "@/app/api/jobs/shared";
import { POST as purgeContent } from "@/app/api/jobs/purge-content/route";
import { POST as gcVideos } from "@/app/api/jobs/gc-videos/route";
import { POST as reconcileAuth } from "@/app/api/jobs/reconcile-auth/route";
import { POST as sweepTranscripts } from "@/app/api/jobs/sweep-transcripts/route";

const CRON = "test-cron-secret-jobs";

beforeAll(() => {
  process.env.CRON_SECRET = CRON;
});

/**
 * Build a POST request to a job endpoint. Authorized with the valid cron secret
 * by default; pass `secret: null` to omit the header entirely, or a wrong string
 * to model an impostor.
 */
function jobRequest(
  path: string,
  opts: { body?: Record<string, unknown>; secret?: string | null } = {}
): Request {
  const secret = opts.secret === undefined ? CRON : opts.secret;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers.authorization = `Bearer ${secret}`;
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const online = await dbReachable();

/**
 * A reset, empty school with one teacher, one student, and one classroom — the
 * cast that owns the rows each job operates on.
 */
interface SchoolWorld {
  school: School;
  teacher: Teacher;
  student: Student;
  classroom: Classroom;
}

async function seedSchool(): Promise<SchoolWorld> {
  const testbed = await freshTestbed();
  const school = await testbed.createSchool("Test School");
  const teacher = await school.enrollTeacher({ name: "Ada" });
  const student = await school.enrollStudent({ name: "Ben" });
  const classroom = await teacher.openClass({ name: "Biology", language: "he" });
  return { school, teacher, student, classroom };
}

/** Create an auth user with NO profile (an orphan reconcile-auth may reap). */
async function createProfilelessUser(email: string): Promise<string> {
  const { data, error } = await getServiceClient().auth.admin.createUser({
    email,
    password: "orphan-password-123",
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "no user");
  return data.user.id;
}

/**
 * Empty the transcript bucket before a test. Direct `DELETE FROM
 * storage.objects` is rejected by the local Storage extension ("Direct deletion
 * from storage tables is not allowed"), so clear it through the Storage API —
 * the same path the jobs under test use.
 */
async function clearTranscriptBucket(): Promise<void> {
  const bucket = getServiceClient().storage.from(TRANSCRIPT_BUCKET);
  const { data } = await bucket.list("", { limit: 1000 });
  if (data && data.length > 0) {
    await bucket.remove(data.map((o) => o.name));
  }
}

// ── Auth guard (DB-independent: assertSecret runs before any DB work) ─────────

describe("job auth guard", () => {
  it("rejects a missing Authorization header with 401", async () => {
    const res = await purgeContent(
      jobRequest("/api/jobs/purge-content", { body: {}, secret: null })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe("unauthorized");
  });

  it("rejects a wrong bearer secret with 401", async () => {
    const res = await gcVideos(
      jobRequest("/api/jobs/gc-videos", { body: {}, secret: "wrong-secret" })
    );
    expect(res.status).toBe(401);
  });
});

// ── purge-content ─────────────────────────────────────────────────────────────

describe.skipIf(!online)("purge-content", () => {
  let school: School;
  let teacher: Teacher;
  let student: Student;
  let classroom: Classroom;

  beforeEach(async () => {
    ({ school, teacher, student, classroom } = await seedSchool());
  });

  it("hard-deletes only quizzes soft-deleted past the retention window, at quiz granularity, cascading children", async () => {
    const pool = getPool();
    const video = await pool.query<{ id: string }>(
      "INSERT INTO public.videos (youtube_video_id) VALUES ($1) RETURNING id",
      ["yt-purge-1"]
    );
    const videoId = video.rows[0].id;

    const insertQuiz = async (deletedAgo: string | null): Promise<string> => {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO public.quizzes (author_id, video_id, school_id, deleted_at)
         VALUES ($1, $2, $3, ${deletedAgo ? `now() - interval '${deletedAgo}'` : "null"})
         RETURNING id`,
        [teacher.id, videoId, school.id]
      );
      return r.rows[0].id;
    };

    const staleQuiz = await insertQuiz("40 days"); // past 30-day window → purged
    const recentQuiz = await insertQuiz("1 day"); // inside window → kept
    const liveQuiz = await insertQuiz(null); // not soft-deleted → kept

    // A soft-deleted question inside the LIVE quiz must survive (quiz granularity).
    await pool.query(
      "INSERT INTO public.questions (quiz_id, position_seconds, deleted_at) VALUES ($1, 10, now() - interval '99 days')",
      [liveQuiz]
    );

    // Children under the purged quiz — must cascade away.
    const staleQuestion = await pool.query<{ id: string }>(
      "INSERT INTO public.questions (quiz_id, position_seconds) VALUES ($1, 5) RETURNING id",
      [staleQuiz]
    );
    await pool.query(
      "INSERT INTO public.question_options (question_id, is_correct) VALUES ($1, true)",
      [staleQuestion.rows[0].id]
    );
    await pool.query(
      "INSERT INTO public.attempts (student_id, class_id, quiz_id) VALUES ($1, $2, $3)",
      [student.id, classroom.id, staleQuiz]
    );
    await pool.query(
      `INSERT INTO public.tutor_questions (student_id, class_id, quiz_id, video_id, prompt)
       VALUES ($1, $2, $3, $4, 'q?')`,
      [student.id, classroom.id, staleQuiz, videoId]
    );

    const res = await purgeContent(
      jobRequest("/api/jobs/purge-content", { body: { retentionDays: 30 } })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(1);
    expect(json.retentionDays).toBe(30);

    const survivors = await pool.query<{ id: string }>("SELECT id FROM public.quizzes ORDER BY id");
    const ids = survivors.rows.map((r) => r.id).sort();
    expect(ids).toEqual([recentQuiz, liveQuiz].sort());

    // The live quiz's soft-deleted question is untouched.
    const liveQuestions = await pool.query(
      "SELECT 1 FROM public.questions WHERE quiz_id = $1",
      [liveQuiz]
    );
    expect(liveQuestions.rowCount).toBe(1);

    // Cascade removed the purged quiz's attempts + tutor_questions.
    const orphanAttempts = await pool.query(
      "SELECT 1 FROM public.attempts WHERE quiz_id = $1",
      [staleQuiz]
    );
    expect(orphanAttempts.rowCount).toBe(0);
    const orphanTutor = await pool.query(
      "SELECT 1 FROM public.tutor_questions WHERE quiz_id = $1",
      [staleQuiz]
    );
    expect(orphanTutor.rowCount).toBe(0);
  });
});

// ── gc-videos ─────────────────────────────────────────────────────────────────

describe.skipIf(!online)("gc-videos", () => {
  let school: School;
  let teacher: Teacher;
  let student: Student;
  let classroom: Classroom;

  beforeEach(async () => {
    ({ school, teacher, student, classroom } = await seedSchool());
    await clearTranscriptBucket();
  });

  it("deletes only orphan videos past the grace window and best-effort removes their transcript object", async () => {
    const pool = getPool();

    const insertVideo = async (youtubeId: string, createdAgo: string): Promise<string> => {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO public.videos (youtube_video_id, created_at)
         VALUES ($1, now() - interval '${createdAgo}') RETURNING id`,
        [youtubeId]
      );
      return r.rows[0].id;
    };

    const orphanPastGrace = await insertVideo("yt-gc-orphan", "2 hours"); // orphan + old → deleted
    const videoWithQuiz = await insertVideo("yt-gc-quiz", "2 hours"); // has quiz → kept
    const orphanWithinGrace = await insertVideo("yt-gc-fresh", "0 minutes"); // orphan but inside grace → kept
    const videoWithTutorRef = await insertVideo("yt-gc-tutor", "2 hours"); // referenced by tutor_questions → kept

    // videoWithQuiz gets a live quiz.
    const quiz = await pool.query<{ id: string }>(
      "INSERT INTO public.quizzes (author_id, video_id, school_id) VALUES ($1, $2, $3) RETURNING id",
      [teacher.id, videoWithQuiz, school.id]
    );
    // videoWithTutorRef is referenced by a tutor_questions row whose quiz points elsewhere.
    await pool.query(
      `INSERT INTO public.tutor_questions (student_id, class_id, quiz_id, video_id, prompt)
       VALUES ($1, $2, $3, $4, 'hi')`,
      [student.id, classroom.id, quiz.rows[0].id, videoWithTutorRef]
    );

    // A cached transcript object for the doomed orphan; assert GC removes it.
    const { error: upErr } = await getServiceClient()
      .storage.from(TRANSCRIPT_BUCKET)
      .upload("yt-gc-orphan.json", JSON.stringify({ segments: [] }), {
        contentType: "application/json",
        upsert: true,
      });
    expect(upErr).toBeNull();

    const res = await gcVideos(
      jobRequest("/api/jobs/gc-videos", { body: { graceMinutes: 60 } })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(1);
    expect(json.storageDeleted).toBe(1);

    const remaining = await pool.query<{ id: string }>("SELECT id FROM public.videos ORDER BY id");
    const ids = remaining.rows.map((r) => r.id).sort();
    expect(ids).toEqual([videoWithQuiz, orphanWithinGrace, videoWithTutorRef].sort());
    expect(ids).not.toContain(orphanPastGrace);

    // Transcript object is gone.
    const { data: dl } = await getServiceClient()
      .storage.from(TRANSCRIPT_BUCKET)
      .download("yt-gc-orphan.json");
    expect(dl).toBeNull();
  });
});

// ── reconcile-auth ────────────────────────────────────────────────────────────

describe.skipIf(!online)("reconcile-auth", () => {
  beforeEach(async () => {
    await seedSchool();
  });

  it("deletes only profile-less auth.users older than the age floor, leaving seeded users intact", async () => {
    const pool = getPool();

    const staleOrphan = await createProfilelessUser("stale-orphan@test.orttube.local");
    const freshOrphan = await createProfilelessUser("fresh-orphan@test.orttube.local");
    // Backdate only the stale one past the 30-minute floor.
    await pool.query("UPDATE auth.users SET created_at = now() - interval '40 minutes' WHERE id = $1", [
      staleOrphan,
    ]);

    const res = await reconcileAuth(
      jobRequest("/api/jobs/reconcile-auth", { body: { olderThanMinutes: 30 } })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(1);
    expect(json.errors).toEqual([]);

    const exists = async (id: string): Promise<boolean> => {
      const r = await pool.query("SELECT 1 FROM auth.users WHERE id = $1", [id]);
      return r.rowCount === 1;
    };
    expect(await exists(staleOrphan)).toBe(false);
    expect(await exists(freshOrphan)).toBe(true);

    // Seeded users (which HAVE profiles) are never touched.
    const seeded = await pool.query("SELECT count(*)::int AS n FROM public.profiles");
    expect(seeded.rows[0].n).toBe(2);
  });

  it("clamps the age floor to a 5-minute minimum so an in-flight signup is not reaped", async () => {
    const inFlightUserId = await createProfilelessUser("inflight@test.orttube.local"); // ~0 min old

    // Even asking for olderThanMinutes: 0, the route clamps to >= 5.
    const res = await reconcileAuth(
      jobRequest("/api/jobs/reconcile-auth", { body: { olderThanMinutes: 0 } })
    );
    const json = await res.json();
    expect(json.olderThanMinutes).toBe(5);
    expect(json.deleted).toBe(0);

    const pool = getPool();
    const r = await pool.query("SELECT 1 FROM auth.users WHERE id = $1", [inFlightUserId]);
    expect(r.rowCount).toBe(1);
  });
});

// ── sweep-transcripts ─────────────────────────────────────────────────────────

describe.skipIf(!online)("sweep-transcripts", () => {
  beforeEach(async () => {
    await freshTestbed();
    await clearTranscriptBucket();
  });

  it("deletes only transcript objects older than the TTL", async () => {
    const bucket = getServiceClient().storage.from(TRANSCRIPT_BUCKET);

    for (const name of ["sweep-old.json", "sweep-new.json"]) {
      const { error } = await bucket.upload(name, JSON.stringify({ segments: [] }), {
        contentType: "application/json",
        upsert: true,
      });
      expect(error).toBeNull();
    }
    // Backdate the "old" object's Storage timestamps past the 30-day TTL. The
    // storage extension installs a BEFORE UPDATE trigger
    // (`update_objects_updated_at`) that rewrites updated_at to now() on every
    // update, which would defeat the backdate. `postgres` cannot disable a
    // trigger it doesn't own, but it can set session_replication_role=replica to
    // suppress normal triggers for this one connection. Pin the SET and the
    // UPDATE to the same pooled connection, then restore.
    const connection = await getPool().connect();
    try {
      await connection.query("SET session_replication_role = 'replica'");
      await connection.query(
        `UPDATE storage.objects
         SET updated_at = now() - interval '40 days', created_at = now() - interval '40 days'
         WHERE bucket_id = $1 AND name = 'sweep-old.json'`,
        [TRANSCRIPT_BUCKET]
      );
    } finally {
      await connection.query("SET session_replication_role = 'origin'");
      connection.release();
    }

    const res = await sweepTranscripts(
      jobRequest("/api/jobs/sweep-transcripts", { body: { ttlDays: 30 } })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(1);

    const { data: oldDl } = await bucket.download("sweep-old.json");
    expect(oldDl).toBeNull();
    const { data: newDl } = await bucket.download("sweep-new.json");
    expect(newDl).not.toBeNull();

    // Cleanup the surviving object so it does not leak into other suites.
    await bucket.remove(["sweep-new.json"]);
  });
});

afterAll(async () => {
  await closePool();
});
