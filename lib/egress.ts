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

/** A response carrying this is a bot check, not an answer — try another exit. */
const BOT_CHECK = /"status"\s*:\s*"LOGIN_REQUIRED"/;

/**
 * Set once per process from `YOUTUBE_PROXY_URLS`. Read lazily rather than at
 * module load so tests can set the variable per-case, and so an unset value
 * never costs anything at import time.
 */
let pool: ProxyAgent[] | null = null;
let poolSource: string | undefined;

/**
 * Index of the exit that last answered. Burned proxies are the common case, not
 * the exception (measured: 3 of 10 working), so without this every request
 * would pay for the dead ones ahead of it in the list. Vercel reuses function
 * instances, so this survives across requests.
 */
let preferred = 0;

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

function proxies(): ProxyAgent[] {
  const configured = process.env.YOUTUBE_PROXY_URLS ?? "";
  if (pool === null || poolSource !== configured) {
    poolSource = configured;
    preferred = 0;
    pool = configured
      .split(",")
      .map(normalizeProxyUrl)
      .filter((u): u is string => u !== null)
      .map((uri) => new ProxyAgent(uri));
  }
  return pool;
}

/** 429 and 5xx mean "not now"; a bot-check body means "not from this IP". */
function refused(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
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

/**
 * `fetch`, but routed through the proxy pool, falling through to the next exit
 * whenever one is refused.
 *
 * Typed as the platform `fetch` so it drops straight into `tracingFetch` and
 * `youtube-transcript`'s `config.fetch` seam with no adapter.
 *
 * When no proxies are configured this delegates to the **global** `fetch`, not
 * undici's — local dev and `npm run smoke` then behave exactly as before, and
 * unit tests that `vi.stubGlobal("fetch", …)` keep intercepting. Calling
 * undici's directly here would silently bypass those stubs and put the suite on
 * the real network.
 *
 * If every proxy is refused, the LAST response is returned unchanged rather
 * than throwing: `fetchFreshTranscript` already classifies a bot-checked
 * response as a transient error, and inventing a new failure mode here would
 * only bypass that logic.
 */
export const proxiedFetch: typeof globalThis.fetch = async (input, init) => {
  const exits = proxies();
  if (exits.length === 0) return fetch(input, init);

  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;

  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let i = 0; i < exits.length; i++) {
    const index = (preferred + i) % exits.length;
    try {
      // undici's `fetch` is required for `dispatcher` to be honoured: Node
      // bundles its own internal undici and rejects a dispatcher built by the
      // separately-installed one with UND_ERR_INVALID_ARG — surfaced as a bare
      // `TypeError: fetch failed` that is indistinguishable from an unreachable
      // host. Verified on Node 24.13 / undici 8.10. Do not "simplify" this back
      // to the global fetch.
      const res = await undiciFetch(url, {
        method: init?.method,
        headers: init?.headers as Record<string, string> | undefined,
        body: typeof init?.body === "string" ? init.body : undefined,
        dispatcher: exits[index],
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
        return rebuilt;
      }
      lastResponse = rebuilt;
    } catch (e) {
      lastError = e;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new Error("No YouTube egress route succeeded.");
};
