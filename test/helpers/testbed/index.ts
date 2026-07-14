/**
 * Actor-based integration test DSL.
 *
 * Lets an RPC/DB integration test read like a story — who does what — instead of
 * a wall of `rpc(...)`, raw SQL, and cryptic fixtures. It is a THIN, honest layer
 * over the real service wrappers in `@/lib/*` and the real SECURITY DEFINER RPCs;
 * it hides plumbing (auth clients, `pg` reads), never behaviour.
 *
 *   const testbed  = await freshTestbed();                   // reset to empty
 *   const school   = await testbed.createSchool("Lincoln High");
 *   const teacher  = await school.enrollTeacher({ name: "Ada" });
 *   const peer     = await school.enrollTeacher({ name: "Grace" });  // never `other`
 *   const student  = await school.enrollStudent({ name: "Ben" });
 *   const biology  = await teacher.openClass({ language: "he" });
 *   const quiz     = await teacher.authorQuiz({
 *     baseLanguage: "he",
 *     questions: [singleChoice({ prompt: "?", at: 10, correct: "a", distractors: ["b"] })],
 *   });
 *   await teacher.assignQuiz(quiz, { to: biology, maxAttempts: 1, tutor: "hints" });
 *   await biology.enroll(student);
 *   const attempt  = await student.startAttempt(quiz, { in: biology });
 *   await attempt.answerCorrectly(quiz.questions[0]);
 *   const summary  = await attempt.complete();
 *
 * `freshTestbed()` is called per test (in `beforeEach`): it resets the DB to empty
 * and returns a brand-new root — so every test runs in its own isolated universe,
 * NOT shared state. Each actor holds its identity + an authenticated (RLS-subject)
 * client and exposes intention-revealing methods that call the real wrappers. A
 * separate `Inspector` (exposed as `testbed.db`) wraps out-of-band service-role /
 * `pg` reads used only for assertions, e.g. `await testbed.db.isMember(biology,
 * student)`. An `Admin` facet (`testbed.admin`) drives the service-role lifecycle
 * primitives, and a `Seeder` (`testbed.seed`) fabricates server-only rows.
 *
 * The DSL is split by actor into sibling modules (school, teacher, student, quiz,
 * classroom, attempt, inspector, admin, seeder); this barrel re-exports the whole
 * public surface, so tests import everything from `../helpers/testbed`.
 */
import { resetDb, getPool } from "../db";
import { School } from "./school";
import { Inspector } from "./inspector";
import { Admin } from "./admin";
import { Seeder } from "./seeder";

export type { Actor } from "./internal";
export * from "./builders";
export * from "./quiz";
export * from "./classroom";
export * from "./attempt";
export * from "./teacher";
export * from "./student";
export * from "./school";
export * from "./inspector";
export * from "./admin";
export * from "./seeder";

/** The per-test root: a fresh, empty universe plus the out-of-band facets. */
export class Testbed {
  readonly db = new Inspector();
  readonly admin = new Admin();
  readonly seed = new Seeder();

  /** Create a school (raw insert; schools are not owned by a user). */
  async createSchool(name: string): Promise<School> {
    const res = await getPool().query<{ id: string }>(
      "INSERT INTO public.schools (name) VALUES ($1) RETURNING id",
      [name]
    );
    return new School(res.rows[0].id, name);
  }
}

/** Reset the local DB to empty and return a fresh, isolated testbed. */
export async function freshTestbed(): Promise<Testbed> {
  await resetDb();
  return new Testbed();
}
