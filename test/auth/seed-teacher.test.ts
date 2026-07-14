import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { POST } from "@/app/api/admin/seed-teacher/route";
import {
  haveEnv,
  service,
  uniqueEmail,
  deleteUser,
  deleteSchool,
  getProfile,
} from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

function post(body: unknown, opts?: { secret?: string | null }): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = opts && "secret" in opts ? opts.secret : ADMIN_SECRET;
  if (secret) headers["authorization"] = `Bearer ${secret}`;
  return POST(
    new Request("http://localhost/api/admin/seed-teacher", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
}

// Requires both the DB env and a configured ADMIN_SECRET.
const d = haveEnv() && ADMIN_SECRET ? describe : describe.skip;

d("POST /api/admin/seed-teacher", () => {
  let db: SupabaseClient;
  const cleanup: Array<() => Promise<void>> = [];

  beforeAll(() => {
    db = service();
  });

  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => {});
    cleanup.length = 0;
  });

  it("rejects requests without the admin secret (401)", async () => {
    const res = await post(
      { email: uniqueEmail("teacher"), password: "password123", schoolName: "X" },
      { secret: null }
    );
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.error.code).toBe("unauthorized");
  });

  it("rejects requests with a wrong admin secret (401)", async () => {
    const res = await post(
      { email: uniqueEmail("teacher"), password: "password123", schoolName: "X" },
      { secret: "definitely-not-the-secret" }
    );
    expect(res.status).toBe(401);
  });

  it("creates the school + teacher when given schoolName", async () => {
    const email = uniqueEmail("teacher");
    const schoolName = `Seed School ${Date.now()}`;
    const res = await post({ email, password: "password123", displayName: "Ms. Seed", schoolName });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(typeof json.userId).toBe("string");
    expect(typeof json.schoolId).toBe("string");
    cleanup.push(() => deleteUser(db, json.userId));
    cleanup.push(() => deleteSchool(db, json.schoolId));

    const profile = await getProfile(db, json.userId);
    expect(profile?.role).toBe("teacher");
    expect(profile?.school_id).toBe(json.schoolId);

    const { data: school } = await db.from("schools").select("name").eq("id", json.schoolId).single();
    expect(school?.name).toBe(schoolName);
  });

  it("reuses an existing school when given an explicit schoolId", async () => {
    // Seed one teacher (creates a school), then seed a second into the same school.
    const first = await post({
      email: uniqueEmail("teacher"),
      password: "password123",
      schoolName: `Shared School ${Date.now()}`,
    });
    const firstJson = await first.json();
    expect(first.status).toBe(201);
    cleanup.push(() => deleteUser(db, firstJson.userId));
    cleanup.push(() => deleteSchool(db, firstJson.schoolId));

    const second = await post({
      email: uniqueEmail("teacher"),
      password: "password123",
      schoolId: firstJson.schoolId,
    });
    const secondJson = await second.json();
    expect(second.status).toBe(201);
    expect(secondJson.schoolId).toBe(firstJson.schoolId);
    cleanup.push(() => deleteUser(db, secondJson.userId));

    const profile = await getProfile(db, secondJson.userId);
    expect(profile?.role).toBe("teacher");
    expect(profile?.school_id).toBe(firstJson.schoolId);
  });

  it("rejects when neither schoolId nor schoolName is provided (400)", async () => {
    const res = await post({ email: uniqueEmail("teacher"), password: "password123" });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe("invalid_request");
  });
});
