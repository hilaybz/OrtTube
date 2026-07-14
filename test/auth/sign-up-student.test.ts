/**
 * Student self-signup route (spec §4, decision 23):
 * `POST /api/auth/sign-up-student`.
 *
 * The endpoint owns a delicate ordering — GoTrue creates the auth user before app
 * logic can validate, so the route must clean up on failure and never leave an
 * orphan auth user. The tests arrange the testbed (schools, teachers, classes,
 * pending invites) through the actor DSL (`test/helpers/testbed`), then drive the
 * real route handler and assert on the resulting profile / membership / invite /
 * auth-user rows via the testbed inspector and a couple of small local reads.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { POST } from "@/app/api/auth/sign-up-student/route";
import { getPool, closePool } from "../helpers/db";
import {
  freshTestbed,
  type Testbed,
  type Classroom,
} from "../helpers/testbed";

/** Drive the real signup route with a JSON body. */
function signUp(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/auth/sign-up-student", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

/** A fresh, collision-free email for an invitee who has not signed up yet. */
function newEmail(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}@test.orttube.local`;
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

describe.skipIf(!online)("POST /api/auth/sign-up-student", () => {
  let testbed: Testbed;

  beforeEach(async () => {
    testbed = await freshTestbed();
  });

  afterAll(async () => {
    await closePool();
  });

  /** Read the just-created profile's identifying fields (RLS-bypassing). */
  async function readProfile(
    userId: string
  ): Promise<{ role: string; school_id: string; email: string } | null> {
    const res = await testbed.db
      .pool()
      .query<{ role: string; school_id: string; email: string }>(
        "SELECT role, school_id, email FROM public.profiles WHERE id = $1",
        [userId]
      );
    return res.rows[0] ?? null;
  }

  /** The auth user id registered under `email`, or null if none exists. */
  async function authUserIdByEmail(email: string): Promise<string | null> {
    const res = await testbed.db
      .pool()
      .query<{ id: string }>(
        "SELECT id FROM auth.users WHERE lower(email) = lower($1)",
        [email]
      );
    return res.rows[0]?.id ?? null;
  }

  /** A school with one teacher and one class, ready to invite students into. */
  async function schoolWithClass(): Promise<{
    schoolId: string;
    biology: Classroom;
  }> {
    const school = await testbed.createSchool("Lincoln High");
    const teacher = await school.enrollTeacher({ name: "Ada" });
    const biology = await teacher.openClass({ name: "Biology" });
    return { schoolId: school.id, biology };
  }

  it("creates profile + membership and deletes the invite for a valid invite", async () => {
    const { schoolId, biology } = await schoolWithClass();

    const studentEmail = newEmail("student");
    await biology.addByEmail(studentEmail); // pending invite

    const res = await signUp({
      email: studentEmail,
      password: "password123",
      displayName: "Test Student",
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(typeof json.userId).toBe("string");

    // Profile created with the resolved school + student role.
    const profile = await readProfile(json.userId);
    expect(profile).not.toBeNull();
    expect(profile?.role).toBe("student");
    expect(profile?.school_id).toBe(schoolId);
    expect(profile?.email.toLowerCase()).toBe(studentEmail.toLowerCase());

    // Invite converted to membership by the invite-conversion trigger.
    expect(await testbed.db.hasMemberId(biology, json.userId)).toBe(true);

    // Invite consumed.
    expect(await testbed.db.hasPendingInvite(biology, studentEmail)).toBe(false);
  });

  it("rejects signup with no invite (409 no_invite) and creates no auth user", async () => {
    const uninvitedEmail = newEmail("noinvite");

    const res = await signUp({
      email: uninvitedEmail,
      password: "password123",
      displayName: "Nobody",
    });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("no_invite");
    expect(await authUserIdByEmail(uninvitedEmail)).toBeNull();
  });

  it("rejects invites spanning multiple schools (409 ambiguous_school), no auth user", async () => {
    const schoolA = await testbed.createSchool("School A");
    const schoolB = await testbed.createSchool("School B");
    const teacherA = await schoolA.enrollTeacher({ name: "Ada" });
    const teacherB = await schoolB.enrollTeacher({ name: "Grace" });
    const classA = await teacherA.openClass({ name: "Class A" });
    const classB = await teacherB.openClass({ name: "Class B" });

    const splitEmail = newEmail("ambiguous");
    await classA.addByEmail(splitEmail);
    await classB.addByEmail(splitEmail);

    const res = await signUp({
      email: splitEmail,
      password: "password123",
      displayName: "Split",
    });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe("ambiguous_school");
    expect(await authUserIdByEmail(splitEmail)).toBeNull();
  });

  it("deletes the created auth user when the profile insert fails (no orphan)", async () => {
    const { biology } = await schoolWithClass();

    const studentEmail = newEmail("failinsert");
    await biology.addByEmail(studentEmail);

    // Poison the unique profiles.email: a separate student (different auth email)
    // whose PROFILE carries `studentEmail`. The signup's createUser(studentEmail)
    // still succeeds (the auth email is free), but the profile insert violates the
    // UNIQUE(email) constraint -> the endpoint must delete the just-created user.
    const school = await testbed.createSchool("Rival High");
    const poison = await school.enrollStudent({
      name: "Poison",
      email: newEmail("poison-auth"),
    });
    await testbed.db
      .pool()
      .query("UPDATE public.profiles SET email = $1 WHERE id = $2", [
        studentEmail,
        poison.id,
      ]);

    const res = await signUp({
      email: studentEmail,
      password: "password123",
      displayName: "Doomed",
    });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error.code).toBe("signup_failed");

    // No orphan auth user left for studentEmail.
    const orphanId = await authUserIdByEmail(studentEmail);
    if (orphanId) {
      // Defensive: if one lingers, it must NOT still exist.
      expect(await testbed.db.authUserExists(orphanId)).toBe(false);
    } else {
      expect(orphanId).toBeNull();
    }

    // Poison profile survives untouched.
    expect(await testbed.db.profileExists(poison.id)).toBe(true);
  });

  it("rejects malformed requests (400)", async () => {
    const res = await signUp({ email: "", password: "" });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("invalid_request");
  });
});
