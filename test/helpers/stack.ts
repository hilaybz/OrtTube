/**
 * The gate every stack-dependent test file goes through.
 *
 * Integration tests need TWO services, reached by different transports: Postgres
 * on the `pg` wire (for arranging and asserting rows) and the API gateway over
 * HTTP (for the supabase-js calls that create users, sign them in, and invoke
 * RPCs as an actor). Probing only one of them is what lets a half-started stack
 * masquerade as a product bug — a missing gateway surfaces as a `fetch failed`
 * deep inside a test rather than as the environment problem it is.
 *
 * Three outcomes, deliberately distinct:
 *
 *   - nothing up    → skip, and print one summary line, so a green run is never
 *                     mistaken for a verified one
 *   - partially up  → throw, naming the service that is missing; a half-started
 *                     stack is a broken environment, not an absent one
 *   - db not local  → throw before opening a connection: `resetDb` truncates
 *                     every table and clears `auth.users`, so pointing this at a
 *                     hosted project would destroy it
 *
 * Setting `REQUIRE_STACK=1` turns the skip into a failure too, so CI cannot pass
 * by quietly omitting the layer where the business rules actually live.
 *
 * Probed once per process and cached: 17 files share one answer instead of each
 * paying its own connection timeout.
 */
import { getPool } from "./db";

/** Hosts that can only be a throwaway local database. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** How long a probe waits before calling a service absent. */
const PROBE_TIMEOUT_MS = 3_000;

function env(name: string): string | undefined {
  return process.env[name];
}

/**
 * The host `SUPABASE_DB_URL` points at, or `null` if it is unset or unparseable.
 * An unparseable URL is treated as unknown rather than local — the safe default
 * for a value that decides whether truncating every table is allowed.
 */
function dbHost(): string | null {
  const raw = env("SUPABASE_DB_URL");
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

/**
 * Refuse to run against anything but a local database. The harness truncates
 * every table and clears `auth.users`, so this is the one check that must happen
 * before any connection is opened.
 */
export function assertLocalDb(): void {
  const raw = env("SUPABASE_DB_URL");
  if (!raw) return; // absent is handled as "stack down", not as a hazard
  const host = dbHost();
  if (host === null || !LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Test harness refused to start: SUPABASE_DB_URL points at ${
        host ?? "an unparseable host"
      }, not a local database. ` +
        `The harness truncates every table and clears auth.users, so it must ` +
        `only ever target a local throwaway Postgres (127.0.0.1 or localhost).`
    );
  }
}

async function pgReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Is the API gateway answering? Uses GoTrue's health endpoint because auth is
 * the service the testbed depends on first — every actor starts with a created,
 * signed-in user.
 */
async function gatewayReachable(): Promise<boolean> {
  const base = env("NEXT_PUBLIC_SUPABASE_URL");
  if (!base) return false;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/auth/v1/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** What the local stack is currently doing. */
export type StackState = "up" | "down" | "partial";

/** The probe result, keeping which half answered so `partial` can name it. */
interface Probe {
  state: StackState;
  db: boolean;
  gateway: boolean;
}

let cached: Promise<Probe> | null = null;

/** Probe both services once per process. */
export function probeStack(): Promise<Probe> {
  cached ??= (async (): Promise<Probe> => {
    assertLocalDb();
    const [db, gateway] = await Promise.all([pgReachable(), gatewayReachable()]);
    const state: StackState = db && gateway ? "up" : !db && !gateway ? "down" : "partial";
    return { state, db, gateway };
  })();
  return cached;
}

/** Printed once per process, not once per file. */
let announced = false;

function announceSkip(): void {
  if (announced) return;
  announced = true;
  console.warn(
    "\n⚠  Integration tests SKIPPED — no local Supabase stack reachable.\n" +
      "   A passing run therefore says nothing about the database layer\n" +
      "   (RPCs, RLS, triggers, grading, the reveal gate).\n" +
      "   Start one with `supabase start`, or set REQUIRE_STACK=1 to make\n" +
      "   this a failure instead of a skip.\n"
  );
}

/**
 * Whether the calling file's integration suites should run. Use as
 * `describe.skipIf(!(await stackOnline()))`.
 *
 * Throws — rather than returning `false` — when the stack is half-started, or
 * when it is absent but `REQUIRE_STACK=1` demands it, because both of those are
 * environment faults that should be fixed rather than silently tolerated.
 */
export async function stackOnline(): Promise<boolean> {
  const { state, db } = await probeStack();

  if (state === "partial") {
    const missing = db ? "the API gateway (54321)" : "the database (54322)";
    const present = db ? "the database" : "the API gateway";
    throw new Error(
      `Local Supabase stack is only half up: ${present} is answering but ` +
        `${missing} is not. Integration tests need both, and running against a ` +
        `partial stack produces failures that look like product bugs. ` +
        `Run \`supabase stop\` then \`supabase start\`.`
    );
  }

  if (state === "down") {
    if (env("REQUIRE_STACK") === "1") {
      throw new Error(
        "REQUIRE_STACK=1 but no local Supabase stack is reachable. " +
          "Start one with `supabase start`."
      );
    }
    announceSkip();
    return false;
  }

  return true;
}
