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
