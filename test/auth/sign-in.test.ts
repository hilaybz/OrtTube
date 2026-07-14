/**
 * Sign-in routing + deactivation gate (spec §4).
 *
 * Three layers, three styles:
 *   1. `routeForRole` is pure — role in, landing route out. Plain unit tests.
 *   2. `evaluateSignIn` is the deactivation gate against the real profiles table.
 *      It reads through a service-role client, so the tests arrange real people
 *      via the actor DSL (`test/helpers/testbed`) and hand their id to the gate.
 *   3. The transport-error branch is exercised with a hand-rolled stub client (no
 *      DB) so it always runs, even when the local stack is offline.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { evaluateSignIn, routeForRole } from "@/lib/auth/signIn";
import { getPool, closePool, getServiceClient } from "../helpers/db";
import {
  freshTestbed,
  type Testbed,
  type School,
  type Teacher,
  type Student,
} from "../helpers/testbed";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── 1. Pure routing ───────────────────────────────────────────────────────────

describe("routeForRole (pure)", () => {
  it("routes teacher -> /dashboard and student -> /student", () => {
    expect(routeForRole("teacher")).toBe("/dashboard");
    expect(routeForRole("student")).toBe("/student");
  });

  it("defaults unknown/undefined roles to the student home", () => {
    expect(routeForRole(null)).toBe("/student");
    expect(routeForRole(undefined)).toBe("/student");
    expect(routeForRole("something")).toBe("/student");
  });
});

// ── 2. Deactivation gate against the real profiles table ──────────────────────

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
const online = await dbReachable();

/** An id that belongs to no profile — used for the missing-account case. */
const UNKNOWN_USER_ID = "00000000-0000-0000-0000-000000000000";

describe.skipIf(!online)("evaluateSignIn (deactivation gate + routing)", () => {
  let testbed: Testbed;
  let lincoln: School;
  // The service-role client the sign-in gate reads profiles through. Acquired
  // lazily (inside the guarded suite) so it never touches env when skipped.
  let asServiceRole: SupabaseClient;

  beforeEach(async () => {
    asServiceRole = getServiceClient() as unknown as SupabaseClient;
    testbed = await freshTestbed();
    lincoln = await testbed.createSchool("Lincoln High");
  });

  afterAll(async () => {
    await closePool();
  });

  /** Flip a person's account to deactivated, as an admin would. */
  async function deactivate(person: Teacher | Student): Promise<void> {
    await testbed.db
      .pool()
      .query("UPDATE public.profiles SET deactivated_at = now() WHERE id = $1", [
        person.id,
      ]);
  }

  it("routes an active teacher to /dashboard", async () => {
    const teacher = await lincoln.enrollTeacher({ name: "Ada" });

    const result = await evaluateSignIn(asServiceRole, teacher.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe("teacher");
      expect(result.route).toBe("/dashboard");
    }
  });

  it("routes an active student to /student", async () => {
    const student = await lincoln.enrollStudent({ name: "Ben" });

    const result = await evaluateSignIn(asServiceRole, student.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe("student");
      expect(result.route).toBe("/student");
    }
  });

  it("rejects a deactivated user", async () => {
    const teacher = await lincoln.enrollTeacher({ name: "Ada" });
    await deactivate(teacher);

    const result = await evaluateSignIn(asServiceRole, teacher.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("deactivated");
  });

  it("rejects an id with no profile", async () => {
    const result = await evaluateSignIn(asServiceRole, UNKNOWN_USER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("no_profile");
  });
});

// ── 3. Transport-error handling (C4) ──────────────────────────────────────────
// A transport/query error must be distinguished from a genuine no-row so the
// caller does NOT sign a legitimate user out over a transient blip. This runs
// against a stub client (no DB) so it is always exercised.

describe("evaluateSignIn transport-error handling (C4)", () => {
  /** A supabase-like client whose profile lookup returns a fixed result. */
  function clientWhoseLookupReturns(lookup: {
    data: unknown;
    error: { message: string } | null;
  }): SupabaseClient {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => lookup,
    };
    return { from: () => chain } as unknown as SupabaseClient;
  }

  it("returns lookup_failed (not no_profile) on a query error", async () => {
    const flakyClient = clientWhoseLookupReturns({
      data: null,
      error: { message: "connection reset" },
    });
    const result = await evaluateSignIn(flakyClient, "any-id");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("lookup_failed");
  });

  it("returns no_profile on a genuine no-row", async () => {
    const emptyClient = clientWhoseLookupReturns({ data: null, error: null });
    const result = await evaluateSignIn(emptyClient, "any-id");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("no_profile");
  });
});
