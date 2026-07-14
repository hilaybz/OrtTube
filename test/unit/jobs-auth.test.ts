import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertSecret } from "@/lib/jobs/auth";

const CRON_SECRET = "cron-secret-value";
const ADMIN_SECRET = "admin-secret-value";

/** A job request carrying the given raw Authorization header (or none). */
function jobRequestWith(authorization?: string): Request {
  return new Request("https://example.test/api/jobs/whatever", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

const bearer = (token: string) => `Bearer ${token}`;

describe("assertSecret", () => {
  // Snapshot both secret env vars, install known values for the test, then
  // restore whatever was there before.
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      CRON_SECRET: process.env.CRON_SECRET,
      ADMIN_SECRET: process.env.ADMIN_SECRET,
    };
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.ADMIN_SECRET = ADMIN_SECRET;
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("returns null when the cron secret matches", () => {
    expect(assertSecret(jobRequestWith(bearer(CRON_SECRET)), "cron")).toBeNull();
  });

  it("returns null when the admin secret matches", () => {
    expect(assertSecret(jobRequestWith(bearer(ADMIN_SECRET)), "admin")).toBeNull();
  });

  it("does not accept the cron secret for an admin endpoint", async () => {
    const rejection = assertSecret(jobRequestWith(bearer(CRON_SECRET)), "admin");
    expect(rejection).not.toBeNull();
    expect(rejection!.status).toBe(401);
    const body = await rejection!.json();
    expect(body.error.code).toBe("unauthorized");
  });

  it("rejects a missing Authorization header with 401", async () => {
    const rejection = assertSecret(jobRequestWith(), "cron");
    expect(rejection!.status).toBe(401);
    const body = await rejection!.json();
    expect(body.error.code).toBe("unauthorized");
  });

  it("rejects a non-Bearer header with 401", () => {
    expect(assertSecret(jobRequestWith(`Basic ${CRON_SECRET}`), "cron")!.status).toBe(401);
  });

  it("rejects a wrong secret with 401", () => {
    expect(assertSecret(jobRequestWith(bearer("nope")), "cron")!.status).toBe(401);
  });

  it("returns 500 when the expected secret env var is unset", async () => {
    delete process.env.CRON_SECRET;
    const rejection = assertSecret(jobRequestWith(bearer("anything")), "cron");
    expect(rejection!.status).toBe(500);
    const body = await rejection!.json();
    expect(body.error.code).toBe("server_misconfigured");
  });
});
