/**
 * Shared integration-test harness.
 *
 * Targets the **local** Supabase stack (see `.env.local`). It provides:
 *   - `serviceClient`      — a service-role supabase-js client (bypasses RLS).
 *   - `createAnonClient()` — a fresh anon (RLS-subject) client per test.
 *   - `signInAs()`         — sign an anon client in as a seeded user.
 *   - `resetDb()`          — truncate every `public` table + clear `auth.users`.
 *   - `seedFixture()`      — one school, one teacher, one student, one class.
 *   - `resetAndSeed()`     — the usual `beforeEach` combination.
 *   - `getPool()`/`closePool()` — raw `pg` access for arranging/asserting rows.
 *
 * Schema-specific writes go through raw SQL (`pg`) rather than the typed supabase
 * client so this harness does not depend on `lib/supabase/types.ts` being
 * regenerated for the v2 schema — the gate regenerates those types and later
 * tasks assert through the exposed clients' `.rpc()`/`.from()` calls.
 *
 * NOTE: this file is executed only by the integration/gate step. Per the foundation
 * task's DB rule, the foundation setup itself does not run it against the shared local DB.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import type { Database } from "@/lib/supabase/types";
import type { Language } from "@/lib/lang";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Test harness: missing required env var ${name} (is .env.local loaded?)`
    );
  }
  return value;
}

const SUPABASE_URL = () => requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = () => requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = () => requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const DB_URL = () => requireEnv("SUPABASE_DB_URL");

// ── Clients ─────────────────────────────────────────────────────────────────

let _serviceClient: SupabaseClient<Database> | null = null;

/** Shared service-role client (bypasses RLS). Lazily constructed. */
export function getServiceClient(): SupabaseClient<Database> {
  if (!_serviceClient) {
    _serviceClient = createClient<Database>(SUPABASE_URL(), SERVICE_KEY(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _serviceClient;
}

/**
 * A fresh anon (RLS-subject) client. Each call returns an isolated client with
 * its own auth state so RLS tests can sign in as different users without
 * clobbering a shared session.
 */
export function createAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL(), ANON_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Sign an anon client in with email+password; throws on failure. */
export async function signInAs(
  client: SupabaseClient<Database>,
  email: string,
  password: string
): Promise<void> {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`signInAs(${email}) failed: ${error.message}`);
  }
}

// ── Raw Postgres pool ───────────────────────────────────────────────────────

let _pool: Pool | null = null;

/** Lazily-created `pg` pool against `SUPABASE_DB_URL` (superuser; bypasses RLS). */
export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: DB_URL(), max: 4 });
  }
  return _pool;
}

/** Close the pool (call in a global `afterAll` to let the process exit cleanly). */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

// ── Reset ───────────────────────────────────────────────────────────────────

/**
 * Reset the local DB to an empty (but migrated) state: truncate every table in
 * the `public` schema (CASCADE) and delete all `auth.users` rows (which cascades
 * to identities/sessions and to `profiles`). Schema/migrations are owned by the
 * gate — this only clears data.
 */
export async function resetDb(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      LOOP
        EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', r.tablename);
      END LOOP;
    END $$;
  `);
  // Remove auth users last; cascades to auth.identities / auth.sessions.
  await pool.query("DELETE FROM auth.users");
}

// ── Seed ────────────────────────────────────────────────────────────────────

export interface SeededUser {
  id: string;
  email: string;
  password: string;
  displayName: string;
}

export interface SeededSchool {
  id: string;
  name: string;
}

export interface SeededClass {
  id: string;
  name: string;
  language: Language;
}

export interface Fixture {
  school: SeededSchool;
  teacher: SeededUser;
  student: SeededUser;
  klass: SeededClass;
}

/** Deterministic credentials so tests can sign in as the fixture users. */
export const FIXTURE = {
  schoolName: "Test School",
  teacher: {
    email: "teacher@test.orttube.local",
    password: "teacher-password-123",
    displayName: "Test Teacher",
  },
  student: {
    email: "student@test.orttube.local",
    password: "student-password-123",
    displayName: "Test Student",
  },
  className: "Test Class",
  classLanguage: "he" as Language,
} as const;

async function createAuthUser(
  email: string,
  password: string
): Promise<string> {
  const service = getServiceClient();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(
      `createAuthUser(${email}) failed: ${error?.message ?? "no user returned"}`
    );
  }
  return data.user.id;
}

/**
 * Seed the minimal fixture: one school, one teacher (auth user + profile), one
 * student (auth user + profile), one class owned by the teacher. Assumes an
 * already-reset DB (call `resetDb()` first, or use `resetAndSeed()`).
 *
 * Structural rows are inserted via raw SQL so the harness is independent of the
 * generated types. The invite-conversion trigger fires on the student
 * profile insert (no-op here, since no invites are seeded).
 */
export async function seedFixture(): Promise<Fixture> {
  const pool = getPool();

  // 1. School
  const schoolRes = await pool.query<{ id: string }>(
    "INSERT INTO public.schools (name) VALUES ($1) RETURNING id",
    [FIXTURE.schoolName]
  );
  const schoolId = schoolRes.rows[0].id;

  // 2. Teacher (auth user + profile)
  const teacherId = await createAuthUser(
    FIXTURE.teacher.email,
    FIXTURE.teacher.password
  );
  await pool.query(
    `INSERT INTO public.profiles (id, role, school_id, email, display_name)
     VALUES ($1, 'teacher', $2, $3, $4)`,
    [teacherId, schoolId, FIXTURE.teacher.email, FIXTURE.teacher.displayName]
  );

  // 3. Student (auth user + profile)
  const studentId = await createAuthUser(
    FIXTURE.student.email,
    FIXTURE.student.password
  );
  await pool.query(
    `INSERT INTO public.profiles (id, role, school_id, email, display_name)
     VALUES ($1, 'student', $2, $3, $4)`,
    [studentId, schoolId, FIXTURE.student.email, FIXTURE.student.displayName]
  );

  // 4. Class owned by the teacher
  const classRes = await pool.query<{ id: string }>(
    `INSERT INTO public.classes (teacher_id, school_id, name, language)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [teacherId, schoolId, FIXTURE.className, FIXTURE.classLanguage]
  );
  const classId = classRes.rows[0].id;

  return {
    school: { id: schoolId, name: FIXTURE.schoolName },
    teacher: {
      id: teacherId,
      email: FIXTURE.teacher.email,
      password: FIXTURE.teacher.password,
      displayName: FIXTURE.teacher.displayName,
    },
    student: {
      id: studentId,
      email: FIXTURE.student.email,
      password: FIXTURE.student.password,
      displayName: FIXTURE.student.displayName,
    },
    klass: {
      id: classId,
      name: FIXTURE.className,
      language: FIXTURE.classLanguage,
    },
  };
}

/** Convenience: reset then seed. The typical `beforeEach` for integration tests. */
export async function resetAndSeed(): Promise<Fixture> {
  await resetDb();
  return seedFixture();
}
