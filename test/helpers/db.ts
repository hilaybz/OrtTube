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

let _serviceClient: SupabaseClient<Database> | null = null;

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

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: DB_URL(), max: 4 });
  }
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

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

export async function seedFixture(): Promise<Fixture> {
  const pool = getPool();

  const schoolRes = await pool.query<{ id: string }>(
    "INSERT INTO public.schools (name) VALUES ($1) RETURNING id",
    [FIXTURE.schoolName]
  );
  const schoolId = schoolRes.rows[0].id;

  const teacherId = await createAuthUser(
    FIXTURE.teacher.email,
    FIXTURE.teacher.password
  );
  await pool.query(
    `INSERT INTO public.profiles (id, role, school_id, email, display_name)
     VALUES ($1, 'teacher', $2, $3, $4)`,
    [teacherId, schoolId, FIXTURE.teacher.email, FIXTURE.teacher.displayName]
  );

  const studentId = await createAuthUser(
    FIXTURE.student.email,
    FIXTURE.student.password
  );
  await pool.query(
    `INSERT INTO public.profiles (id, role, school_id, email, display_name)
     VALUES ($1, 'student', $2, $3, $4)`,
    [studentId, schoolId, FIXTURE.student.email, FIXTURE.student.displayName]
  );

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

export async function resetAndSeed(): Promise<Fixture> {
  await resetDb();
  return seedFixture();
}
