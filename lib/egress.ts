import "server-only";
import { ProxyAgent, fetch as undiciFetch } from "undici";

/**
 * Outbound egress for YouTube requests, routed through a pool of proxies.
 *
 * YouTube bot-checks datacenter IPs, and Vercel's functions run on one: every
 * upstream request from production comes back `playabilityStatus:
 * LOGIN_REQUIRED`, which blocks transcripts AND the `duration_seconds` scrape
 * (issues #7/#8). The fix is to send those requests from an IP YouTube will
 * serve.
 *
 * Proxies are supplied by env, never hardcoded, so **changing provider is a
 * config change and not a code change** — the same pool interface holds ten
 * cheap datacenter proxies or one residential endpoint, and this module cannot
 * tell the difference.
 *
 * Only YouTube's blocked endpoints route through here. `fetchYouTubeOEmbed`
 * (titles) is deliberately left on direct egress: it is not blocked, and
 * proxying it would spend metered bandwidth to fix nothing.
 */

/**
 * A response carrying this is a bot check, not an answer — try another exit.
 * Anchored inside `playabilityStatus` rather than matched against the whole
 * body: a watch page is ~1.2MB of arbitrary text, and a bare `LOGIN_REQUIRED`
 * anywhere in it would burn the entire pool on a false positive.
 */
const BOT_CHECK = /"playabilityStatus"\s*:\s*\{[^{}]*"status"\s*:\s*"LOGIN_REQUIRED"/;

/**
 * Per-exit deadline. undici's own defaults are 300s for headers and body, which
 * on a sequential sweep of ten exits means a stalled proxy can hold a
 * user-facing request (a teacher submitting a video URL) open until the platform
 * kills it. A proxy that has not answered in 15s is not going to.
 */
const EXIT_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * After a sweep in which no exit answered, stop sweeping that ENDPOINT for this
 * long and try only the preferred exit.
 *
 * Two situations produce a fully-refused sweep, and they are indistinguishable
 * from inside: the pool is burned, or the resource is genuinely gated — an
 * age-restricted video returns LOGIN_REQUIRED from every IP on earth, and
 * YouTube walls `api/timedtext` on datacenter IPs while serving the watch page
 * and the player endpoint from the very same address. Telling them apart
 * requires sweeping, so the first sweep pays for it.
 *
 * Keyed per host+path, NOT globally: a single counter is cleared by the next
 * success anywhere, and since the endpoints that work are interleaved with the
 * one that doesn't, that reset it before it could ever apply. Observed in
 * production as two full 10-exit sweeps of `api/timedtext` inside one attempt —
 * 20 requests, every one of them a bot wall.
 */
const SWEEP_COOLDOWN_MS = 60_000;

/**
 * An exit, with the label to name it by. undici's `ProxyAgent` exposes no public
 * accessor for the URI it was built from, so the label is captured here at
 * construction — reading it back off the agent yields nothing, and a trace that
 * says "#0" instead of "31.56.127.193:7684" cannot tell an operator which proxy
 * to rotate.
 */
interface Exit {
  agent: ProxyAgent;
  /** `host:port` — never the credentials. */
  label: string;
}

let pool: Exit[] | null = null;
let poolSource: string | undefined;

/**
 * Index of the exit that last answered. Burned proxies are the common case, not
 * the exception (measured: 3 of 10 working, and which 3 drifts within hours), so
 * without this every request would pay for the dead ones ahead of it in the
 * list. Vercel reuses function instances, so this survives across requests.
 */
let preferred = 0;

/** endpoint (`host/path`) → epoch ms until which a full sweep is suppressed. */
const sweepSuppressedUntil = new Map<string, number>();

/** Cooldowns are per-endpoint, so the key ignores the query string. */
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

function proxies(): Exit[] {
  const configured = process.env.YOUTUBE_PROXY_URLS ?? "";
  if (pool !== null && poolSource === configured) return pool;

  // Built into a local first, and every constructor call guarded: `new
  // ProxyAgent` throws on a bad scheme or an unparseable URL, and a single
  // typo'd entry must not be able to take down every YouTube fetch in the app —
  // which is exactly what this module's contract promises it cannot.
  const built: Exit[] = [];
  for (const raw of configured.split(",")) {
    const uri = normalizeProxyUrl(raw);
    if (!uri) continue;
    try {
      const parsed = new URL(uri);
      built.push({
        agent: new ProxyAgent({
          uri,
          connectTimeout: CONNECT_TIMEOUT_MS,
          headersTimeout: EXIT_TIMEOUT_MS,
          bodyTimeout: EXIT_TIMEOUT_MS,
        }),
        // Host and port only: credentials must never reach a log or a trace.
        label: `${parsed.hostname}:${parsed.port}`,
      });
    } catch {
      // Unusable entry; the remaining exits still stand.
    }
  }

  // Assigned together, and only once building has succeeded: setting the cache
  // key first would let a throw leave `poolSource` matching the new config while
  // `pool` still held the previous agents, pinning a stale pool permanently.
  pool = built;
  poolSource = configured;
  preferred = 0;
  sweepSuppressedUntil.clear();
  return pool;
}

/** 429/403/5xx mean "not from this IP, not now"; a bot-check body means the same. */
function refused(status: number, body: string): boolean {
  // 403 matters as much as 429 here: YouTube answers a suspect IP with it at
  // least as often, and treating it as an answer would mark a walled exit as
  // last-known-good and give it first pick on every later request.
  if (status === 429 || status === 403 || status === 401 || status >= 500) return true;
  return BOT_CHECK.test(body);
}

/**
 * Re-emits an undici response as a platform `Response`.
 *
 * The body has to be buffered anyway to spot a bot check, so rebuilding costs
 * nothing extra and avoids casting between undici's `Response` and the global
 * one. Content-encoding/length are dropped because undici already decoded the
 * body — forwarding them would describe bytes that no longer exist.
 */
function rebuild(status: number, statusText: string, headers: Headers, body: string): Response {
  headers.delete("content-encoding");
  headers.delete("content-length");
  // 204/304 must not carry a body; constructing one with it throws.
  const hasBody = status !== 204 && status !== 304;
  return new Response(hasBody ? body : null, { status, statusText, headers });
}

function describeCause(e: unknown): string {
  // undici surfaces a proxy failure as `TypeError: fetch failed` and puts the
  // real diagnosis (ECONNREFUSED, ETIMEDOUT, …) on `.cause`. Reporting only the
  // outer message throws away the one detail worth having.
  let current: unknown = e;
  while (current instanceof Error && current.cause !== undefined) current = current.cause;
  if (current instanceof Error) {
    const code = (current as NodeJS.ErrnoException).code;
    return code ?? `${current.constructor.name}: ${current.message}`;
  }
  return String(current);
}

/**
 * Builds a `fetch` that routes through the proxy pool, falling through to the
 * next exit whenever one is refused.
 *
 * `trace`, when given, receives ONE summary line per call naming what each exit
 * did. Without it a fully-burned pool is invisible: the caller sees only a bot
 * check from the last exit and cannot tell "rotate YOUTUBE_PROXY_URLS" from
 * "YouTube walled every exit" from "no proxies configured" — which is the single
 * most operationally important distinction this system has.
 *
 * Typed as the platform `fetch` so it drops straight into `tracingFetch` and
 * `youtube-transcript`'s `config.fetch` seam with no adapter. That type is wider
 * than what is actually supported, so unsupported shapes throw rather than
 * silently sending a request with the body dropped.
 *
 * When no proxies are configured this delegates to the **global** `fetch`, not
 * undici's — local dev and `npm run smoke` then behave exactly as before, and
 * unit tests that `vi.stubGlobal("fetch", …)` keep intercepting. Calling
 * undici's directly here would silently bypass those stubs and put the suite on
 * the real network.
 *
 * If every proxy is refused, the LAST response is returned unchanged: callers
 * already classify a bot-checked response as a transient error, and inventing a
 * new failure mode here would only bypass that logic.
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

    // Cooling down after a fully-refused sweep of THIS endpoint: try the
    // preferred exit only.
    const cooling = Date.now() < (sweepSuppressedUntil.get(key) ?? 0);
    const attempts = cooling ? 1 : exits.length;

    const notes: string[] = [];
    let lastResponse: Response | null = null;
    let lastError: unknown = null;

    for (let i = 0; i < attempts; i++) {
      const index = (preferred + i) % exits.length;
      const { agent, label } = exits[index];
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
          dispatcher: agent,
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
        if (!refused(res.status, body)) {
          preferred = index;
          sweepSuppressedUntil.delete(key);
          if (trace && notes.length) {
            trace.push(`egress → ${notes.join(", ")}, ${label} ok`);
          }
          return rebuilt;
        }
        notes.push(`${label} refused(${res.status})`);
        lastResponse = rebuilt;
      } catch (e) {
        notes.push(`${label} ${describeCause(e)}`);
        lastError = e;
      }
    }

    // Nothing answered. Suppress the next sweep of this endpoint so a retry
    // costs one request instead of another full pass.
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

/** The pool-routed `fetch`, without tracing. */
export const proxiedFetch: typeof globalThis.fetch = createProxiedFetch();
