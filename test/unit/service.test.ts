import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServiceClient } from "@/lib/supabase/service";

const SUPABASE_URL = "NEXT_PUBLIC_SUPABASE_URL";
const SERVICE_ROLE_KEY = "SUPABASE_SERVICE_ROLE_KEY";

describe("createServiceClient", () => {
  // Snapshot the two env vars the factory reads, then restore them after each
  // test so mutating them here never leaks into other suites.
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      [SUPABASE_URL]: process.env[SUPABASE_URL],
      [SERVICE_ROLE_KEY]: process.env[SERVICE_ROLE_KEY],
    };
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
    delete process.env[SUPABASE_URL];
    process.env[SERVICE_ROLE_KEY] = "some-key";
    expect(() => createServiceClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    process.env[SUPABASE_URL] = "http://127.0.0.1:54321";
    delete process.env[SERVICE_ROLE_KEY];
    expect(() => createServiceClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("returns a client when both env vars are present", () => {
    process.env[SUPABASE_URL] = "http://127.0.0.1:54321";
    process.env[SERVICE_ROLE_KEY] = "some-key";

    const client = createServiceClient();
    expect(client).toBeTruthy();
    expect(typeof client.from).toBe("function");
    expect(typeof client.rpc).toBe("function");
  });
});
