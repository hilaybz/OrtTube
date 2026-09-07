import "server-only";
import { ProxyAgent, fetch as undiciFetch } from "undici";

/**
 * Outbound egress for YouTube requests, routed through a pool of proxies.
 *
 * YouTube bot-checks datacenter IPs, and Vercel's functions run on one: every
 * upstream request from production comes back `playabilityStatus:
 * LOGIN_REQUIRED`, which blocks transcripts AND the `duration_seconds` scrape.
 * The fix is to send those requests from an IP YouTube will serve.
 */

/**
 * A response carrying this is a bot check, not an answer — try another exit.
 * Anchored inside `playabilityStatus` rather than matched against the whole
 * body: a watch page is ~1.2MB of arbitrary text, and a bare `LOGIN_REQUIRED`
 * anywhere in it would burn the entire pool on a false positive.
 */
const BOT_CHECK = /"playabilityStatus"\s*:\s*\{[^{}]*"status"\s*:\s*"LOGIN_REQUIRED"/;

const EXIT_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 5_000;

const MAX_EXITS_PER_CALL = 3;

/**
 * After a sweep in which no exit answered, stop sweeping that ENDPOINT for this
 * long and try a single exit.
 *
 * Keyed per host+path, NOT globally: a single counter is cleared by the next
 * success anywhere, and since the endpoints that work are interleaved with the
 * one that doesn't, that reset it before it could ever apply. Observed in
 * production as two full 10-exit sweeps of `api/timedtext` inside one attempt —
 * 20 requests, every one of them a bot wall.
 */
const SWEEP_COOLDOWN_MS = 60_000;

interface Exit {
  agent: ProxyAgent;
  label: string;
  uri: string;
}

let pool: Exit[] | null = null;
let poolSource: string | undefined;

let cursor = 0;

const sweepSuppressedUntil = new Map<string, number>();

function endpointKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Accepts both `http://user:pass@host:port` and the `host:port:user:pass` form
 * proxy dashboards export, so a downloaded list pastes in without reformatting.
 * Returns null for anything unparseable rather than throwing — one malformed
 * entry must not take down every fetch in the app.
 */
export function normalizeProxyUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.includes("://")) return value;
  const parts = value.split(":");
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
  }
  if (parts.length === 2) return `http://${value}`;
  return null;
}

function newAgent(uri: string): ProxyAgent {
  return new ProxyAgent({
    uri,
    connectTimeout: CONNECT_TIMEOUT_MS,
    headersTimeout: EXIT_TIMEOUT_MS,
    bodyTimeout: EXIT_TIMEOUT_MS,
  });
}

/**
 * Throws away a burned exit's agent and builds a fresh one in its place, so the
 * NEXT request through this slot leaves from a different IP.
 *
 * This is what makes a rotating proxy actually rotate. Measured: undici keeps
 * the CONNECT tunnel alive, so one `ProxyAgent` holds the same exit IP for its
 * entire life — four requests through one agent all left from 105.97.147.80.
 * Closing and rebuilding drew a new IP (88.166.252.226). Without this a
 * "rotating" endpoint behaves as a sticky one and burns exactly the way the
 * fixed datacenter IPs did.
 */
function replaceAgent(exit: Exit): void {
  const old = exit.agent;
  try {
    exit.agent = newAgent(exit.uri);
  } catch {
    // Keep the old agent rather than leaving the slot without one.
    return;
  }
  // Not awaited: the caller is mid-sweep and the old agent's sockets are of no
  // further interest. Rejections are ignored for the same reason.
  void old.close().catch(() => {});
}

function proxies(): Exit[] {
  const configured = process.env.YOUTUBE_PROXY_URLS ?? "";
  if (pool !== null && poolSource === configured) return pool;

  const built: Exit[] = [];
  for (const raw of configured.split(",")) {
    const uri = normalizeProxyUrl(raw);
    if (!uri) continue;
    try {
      const parsed = new URL(uri);
      built.push({
        agent: newAgent(uri),
        // Host and port only: credentials must never reach a log or a trace.
        label: `${parsed.hostname}:${parsed.port}`,
        uri,
      });
    } catch {
    }
  }

  // Assigned together, and only once building has succeeded: setting the cache
  // key first would let a throw leave `poolSource` matching the new config while
  // `pool` still held the previous agents, pinning a stale pool permanently.
  pool = built;
  poolSource = configured;
  cursor = 0;
  sweepSuppressedUntil.clear();
  return pool;
}

/**
 * A `LOGIN_REQUIRED` body is genuinely ambiguous — an age-gated or private video
 * returns it from every IP on earth, identically to a bot wall — so it is treated
 * as a refusal and the next exit decides.
 *
 * Note that `UNPLAYABLE` and `ERROR` are deliberately NOT refusals: those are
 * verdicts about the video that every IP returns identically, so retrying costs
 * requests and changes nothing. They pass straight through to the caller, which
 * records them as `not_playable:<status>`.
 */
function refusal(status: number, body: string): "status" | "bot_check" | null {
  // 403 matters as much as 429 here: YouTube answers a suspect IP with it at
  // least as often, and treating it as an answer would let a walled exit look
  // like a working one.
  if (status === 429 || status === 403 || status === 401 || status >= 500) {
    return "status";
  }
  return BOT_CHECK.test(body) ? "bot_check" : null;
}

function rebuild(status: number, statusText: string, headers: Headers, body: string): Response {
  headers.delete("content-encoding");
  headers.delete("content-length");
  // 204/304 must not carry a body; constructing one with it throws.
  const hasBody = status !== 204 && status !== 304;
  return new Response(hasBody ? body : null, { status, statusText, headers });
}

function describeCause(e: unknown): string {
  let current: unknown = e;
  while (current instanceof Error && current.cause !== undefined) current = current.cause;
  if (!(current instanceof Error)) return String(current);

  const code = (current as NodeJS.ErrnoException).code;
  const message = current.message;

  // Rejected credentials arrive as UND_ERR_ABORTED — a name that says "someone
  // cancelled this" when the truth is "the proxy refused to authenticate you".
  // That cost an afternoon of looking for a network fault that did not exist,
  // so it is called out by name rather than left to be decoded again.
  if (/Proxy response \(407\)/i.test(message)) {
    return "proxy auth rejected (407) — check YOUTUBE_PROXY_URLS credentials";
  }
  if (code) return message && !message.includes(code) ? `${code}: ${message}` : code;
  return `${current.constructor.name}: ${message}`;
}

/**
 * When no proxies are configured this delegates to the **global** `fetch`, not
 * undici's — local dev and `npm run smoke` then behave exactly as before, and
 * unit tests that `vi.stubGlobal("fetch", …)` keep intercepting. Calling
 * undici's directly here would silently bypass those stubs and put the suite on
 * the real network.
 */
export function createProxiedFetch(trace?: string[]): typeof globalThis.fetch {
  return async (input, init) => {
    const exits = proxies();
    if (exits.length === 0) return fetch(input, init);

    if (input instanceof Request) {
      throw new Error("proxiedFetch: a Request object is not supported; pass a URL and init.");
    }
    if (init?.body !== undefined && init.body !== null && typeof init.body !== "string") {
      throw new Error("proxiedFetch: only string bodies are supported.");
    }
    const url = String(input);
    const key = endpointKey(url);

    const cooling = Date.now() < (sweepSuppressedUntil.get(key) ?? 0);
    const attempts = cooling ? 1 : Math.min(MAX_EXITS_PER_CALL, exits.length);
    const start = cursor;
    cursor = (cursor + 1) % exits.length;

    const notes: string[] = [];
    let lastResponse: Response | null = null;
    let lastError: unknown = null;

    for (let i = 0; i < attempts; i++) {
      if (init?.signal?.aborted) {
        notes.push("budget exhausted");
        break;
      }
      const index = (start + i) % exits.length;
      const label = exits[index].label;
      try {
        // undici's `fetch` is required for `dispatcher` to be honoured: Node
        // bundles its own internal undici and rejects a dispatcher built by the
        // separately-installed one with UND_ERR_INVALID_ARG — surfaced as a bare
        // `TypeError: fetch failed` that is indistinguishable from an
        // unreachable host. Verified on Node 24.13 / undici 8.10. Do not
        // "simplify" this back to the global fetch.
        const res = await undiciFetch(url, {
          method: init?.method,
          headers: init?.headers as Record<string, string> | undefined,
          body: typeof init?.body === "string" ? init.body : undefined,
          // Read at dispatch, never hoisted: a concurrent call that lost this
          // exit has already closed the agent this slot held, and dispatching on
          // a destroyed client fails as if the proxy were dead.
          dispatcher: exits[index].agent,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(EXIT_TIMEOUT_MS)])
            : AbortSignal.timeout(EXIT_TIMEOUT_MS),
        });
        const body = await res.text();
        const rebuilt = rebuild(
          res.status,
          res.statusText,
          new Headers(Object.fromEntries(res.headers.entries())),
          body
        );
        const why = refusal(res.status, body);
        if (!why) {
          sweepSuppressedUntil.delete(key);
          if (trace && notes.length) {
            trace.push(`egress → ${notes.join(", ")}, ${label} ok`);
          }
          return rebuilt;
        }
        notes.push(`${label} refused(${why === "bot_check" ? "wall" : res.status})`);
        replaceAgent(exits[index]);
        lastResponse = rebuilt;
      } catch (e) {
        notes.push(`${label} ${describeCause(e)}`);
        replaceAgent(exits[index]);
        lastError = e;
      }
    }

    if (!cooling) sweepSuppressedUntil.set(key, Date.now() + SWEEP_COOLDOWN_MS);
    if (trace) {
      trace.push(
        `egress → ${cooling ? "cooldown, " : ""}no exit answered: ${notes.join(", ")}`
      );
    }

    if (lastResponse) return lastResponse;
    throw lastError ?? new Error("No YouTube egress route succeeded.");
  };
}

export const proxiedFetch: typeof globalThis.fetch = createProxiedFetch();
