/**
 * School: the tenant boundary. Enrolls teachers and students — each gets an auth
 * user, a role-stamped profile, and a signed-in (RLS-subject) client. Enrolling a
 * student fires the invite-conversion trigger.
 */
import { getPool } from "../db";
import {
  DEFAULT_PASSWORD,
  emailFor,
  createSignedInClient,
  createAuthUser,
} from "./internal";
import { Teacher } from "./teacher";
import { Student } from "./student";

export class School {
  constructor(
    readonly id: string,
    readonly name: string
  ) {}

  /** Enroll a teacher: auth user + `teacher` profile + signed-in client. */
  async enrollTeacher(opts: { name: string; email?: string }): Promise<Teacher> {
    const email = opts.email ?? emailFor(opts.name);
    const id = await createAuthUser(email, DEFAULT_PASSWORD, opts.name);
    await getPool().query(
      `INSERT INTO public.profiles (id, role, school_id, email, display_name)
       VALUES ($1, 'teacher', $2, $3, $4)`,
      [id, this.id, email, opts.name]
    );
    const client = await createSignedInClient(email, DEFAULT_PASSWORD);
    return new Teacher(id, opts.name, email, DEFAULT_PASSWORD, client);
  }

  /**
   * Enroll a student: auth user + `student` profile + signed-in client. Creating
   * the profile fires the invite-conversion trigger (converts any pending invite
   * for this email into a class membership).
   */
  async enrollStudent(opts: { name: string; email?: string }): Promise<Student> {
    const email = opts.email ?? emailFor(opts.name);
    const id = await createAuthUser(email, DEFAULT_PASSWORD, opts.name);
    await getPool().query(
      `INSERT INTO public.profiles (id, role, school_id, email, display_name)
       VALUES ($1, 'student', $2, $3, $4)`,
      [id, this.id, email, opts.name]
    );
    const client = await createSignedInClient(email, DEFAULT_PASSWORD);
    return new Student(id, opts.name, email, DEFAULT_PASSWORD, client);
  }
}
