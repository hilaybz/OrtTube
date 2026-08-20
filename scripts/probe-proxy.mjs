/*
 * Does a proxy get us past YouTube's bot check?
 *
 * Production cannot fetch transcripts: YouTube serves Vercel's egress a
 * `playabilityStatus: LOGIN_REQUIRED` bot check (issues #7/#8), while the same
 * video returns captions from a residential IP. It is the IP, not the code.
 * Paid egress is the remaining path (issue #9) — this script measures whether a
 * given proxy actually defeats the check, BEFORE any product code is wired to
 * depend on it.
 *
 * Run via:
 *     npm run probe:proxy
 * which loads .env.local through `node --env-file`. Put the proxies in
 * `YOUTUBE_PROXY_URLS` there (never on the command line — it would land in
 * shell history).
 *
 * ── The trap this exists to avoid ──────────────────────────────────────────
 * A dev machine is usually on a residential IP where YouTube already works. A
 * misconfigured proxy that silently falls back to direct egress would return a
 * perfect transcript and look like success. So every proxy row FIRST proves its
 * exit IP differs from the direct control's; if it doesn't, the row is reported
 * NOT PROXIED and its YouTube results are discarded rather than believed.
 *
 * Deliberately self-contained (no imports from `lib/`, which is TypeScript):
 * response parsing here is regex-level, because a probe only needs a yes/no.
 */

// `fetch` MUST come from undici, not the global. Node bundles its own internal
// undici, and it rejects a `dispatcher` built by a separately-installed one with
// `UND_ERR_INVALID_ARG` — surfaced as a bare `TypeError: fetch failed` that looks
// exactly like an unreachable host. Verified on Node 24.13 / undici 8.10: the
// same ProxyAgent that fails under global fetch succeeds under undici's.
// Whatever wires the proxy into `lib/` later inherits this constraint.
import { ProxyAgent, fetch } from "undici";

// The exact video from the #8 evidence: known to return Hebrew ASR captions
// from a residential IP, and known to return LOGIN_REQUIRED from Vercel. Using
// anything else would confound "proxy is blocked" with "video has no captions".
const VIDEO_ID = process.env.PROBE_VIDEO_ID ?? "tvyOITo5iOk";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

// The client context `youtube-transcript` posts internally (its INNERTUBE_CONTEXT).
// Mirrored here so the probe tests the request shape production actually sends.
const INNERTUBE_CONTEXT = {
  client: {
    hl: "en",
    gl: "US",
    clientName: "ANDROID",
    clientVersion: "20.10.38",
  },
};

// No `key` query parameter: the package's own INNERTUBE_API_URL carries none,
// and the endpoint answers without one — so sending a key would probe a request
// shape production never makes.
const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

const TIMEOUT_MS = 20_000;

/**
 * Accepts both the `http://user:pass@host:port` URL form and the
 * `host:port:user:pass` form Webshare's dashboard exports, so a downloaded
 * list can be pasted straight in without reformatting.
 */
function normalizeProxy(raw) {
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

/** Hides credentials so a pasted terminal log can't leak the proxy password. */
function redact(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    return `${u.hostname}:${u.port}`;
  } catch {
    return "(unparseable)";
  }
}

/** Credentials embedded in the proxy URL are honoured by undici's ProxyAgent. */
function makeDispatcher(proxyUrl) {
  return new ProxyAgent(proxyUrl);
}

async function request(url, { dispatcher, method = "GET", headers, body } = {}) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(url, { method, headers, body, dispatcher, signal });
  return { status: res.status, text: await res.text() };
}

/** Step 1 — what IP does YouTube actually see for this route? */
async function exitIp(dispatcher) {
  try {
    const { status, text } = await request("https://api.ipify.org?format=json", { dispatcher });
    if (status !== 200) return { ip: null, error: `ipify HTTP ${status}` };
    return { ip: JSON.parse(text).ip ?? null, error: null };
  } catch (e) {
    return { ip: null, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

/**
 * Reads the two signals that matter out of a player response, without a full
 * JSON parse: whether YouTube declared the video playable, and how many caption
 * tracks it was willing to list. `OK` + tracks means healthy; `LOGIN_REQUIRED`
 * is the bot check; `OK` + zero tracks on a known-captioned video is a degraded
 * response — the case `lib/transcript.ts` is careful never to record as
 * "this video has no captions".
 */
function readPlayerSignals(text) {
  const status = text.match(/"playabilityStatus":\{"status":"([A-Z_]+)"/)?.[1] ?? null;
  const trackCount = (text.match(/"baseUrl":"https:\/\/www\.youtube\.com\/api\/timedtext/g) ?? [])
    .length;
  return { playability: status, trackCount };
}

/** Step 2 — the watch-page scrape (`fetchCaptionTracks`, `fetchDurationSeconds`). */
async function probeWatchPage(dispatcher) {
  try {
    const { status, text } = await request(
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      { dispatcher, headers: BROWSER_HEADERS }
    );
    if (status !== 200) return { verdict: `HTTP ${status}`, ok: false };
    const { playability, trackCount } = readPlayerSignals(text);
    if (!playability) return { verdict: "no player JSON", ok: false };
    return {
      verdict: `${playability}, ${trackCount} tracks`,
      ok: playability === "OK" && trackCount > 0,
    };
  } catch (e) {
    return { verdict: e instanceof Error ? e.name : "error", ok: false };
  }
}

/**
 * Step 3 — the InnerTube POST. THE verdict that matters: since the dead
 * `api/timedtext` path was deleted (852b3d0), this is the only route that
 * actually downloads a transcript in production.
 */
async function probeInnerTube(dispatcher) {
  try {
    const { status, text } = await request(
      INNERTUBE_URL,
      {
        dispatcher,
        method: "POST",
        headers: { ...BROWSER_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ context: INNERTUBE_CONTEXT, videoId: VIDEO_ID }),
      }
    );
    if (status !== 200) return { verdict: `HTTP ${status}`, ok: false };
    const playability = text.match(/"playabilityStatus":\{[^}]*"status":"([A-Z_]+)"/)?.[1] ?? null;
    const trackCount = (text.match(/"baseUrl":"https:\/\/www\.youtube\.com\/api\/timedtext/g) ?? [])
      .length;
    if (!playability) return { verdict: "no playabilityStatus", ok: false };
    return {
      verdict: `${playability}, ${trackCount} tracks`,
      ok: playability === "OK" && trackCount > 0,
    };
  } catch (e) {
    return { verdict: e instanceof Error ? e.name : "error", ok: false };
  }
}

async function probe(label, dispatcher) {
  const { ip, error } = await exitIp(dispatcher);
  // Never reached YouTube at all — a transport/auth problem, which says NOTHING
  // about whether the bot check would have let us through. Kept strictly
  // distinct from BLOCKED so a broken proxy can't be misread as evidence that
  // proxying doesn't work.
  if (error) return { label, ip: null, watch: "—", inner: "—", state: "UNREACHABLE", error };
  const watch = await probeWatchPage(dispatcher);
  const inner = await probeInnerTube(dispatcher);
  return {
    label,
    ip,
    watch: watch.verdict,
    inner: inner.verdict,
    state: inner.ok ? "PASS" : "BLOCKED",
  };
}

function table(rows) {
  const cols = ["label", "ip", "watch", "inner", "state"];
  const head = { label: "ROUTE", ip: "EXIT IP", watch: "WATCH PAGE", inner: "INNERTUBE", state: "" };
  const width = Object.fromEntries(
    cols.map((c) => [c, Math.max(...[head, ...rows].map((r) => String(r[c] ?? "—").length))])
  );
  const line = (r) => cols.map((c) => String(r[c] ?? "—").padEnd(width[c])).join("  ").trimEnd();
  console.log("\n" + line(head));
  console.log(cols.map((c) => "─".repeat(width[c])).join("  "));
  for (const r of rows) console.log(line(r));
}

async function main() {
  const raw = process.env.YOUTUBE_PROXY_URLS ?? "";
  const proxies = raw.split(",").map(normalizeProxy).filter(Boolean);

  console.log(`Probing video ${VIDEO_ID} — ${proxies.length} proxy/proxies configured.`);

  // The control runs first and doubles as a self-test: on a residential machine
  // it must PASS. If it doesn't, this script (or the network) is broken and no
  // proxy row below means anything.
  const control = await probe("direct (control)", undefined);
  const rows = [control];

  for (const proxyUrl of proxies) {
    const row = await probe(redact(proxyUrl), makeDispatcher(proxyUrl));
    // A proxy that isn't actually in the path would otherwise report the
    // control's own (working) result as a success.
    if (row.ip && control.ip && row.ip === control.ip) {
      row.state = "NOT PROXIED";
      row.watch = "—";
      row.inner = "—";
    }
    rows.push(row);
  }

  table(rows);

  console.log("");
  if (control.state !== "PASS") {
    console.log(
      "✗ The direct control did NOT pass, so nothing here is conclusive.\n" +
        "  Expected a residential IP to succeed. Check the network, or whether\n" +
        `  ${VIDEO_ID} still exists, before reading the proxy rows.`
    );
    process.exitCode = 1;
    return;
  }

  const proxyRows = rows.slice(1);
  if (proxyRows.length === 0) {
    console.log(
      "✓ Control passed; no proxies configured.\n" +
        "  Set YOUTUBE_PROXY_URLS in .env.local to test them (see .env.local.example)."
    );
    return;
  }

  const count = (s) => proxyRows.filter((r) => r.state === s).length;
  const passing = count("PASS");
  const blocked = count("BLOCKED");
  const unreachable = count("UNREACHABLE");
  const misconfigured = count("NOT PROXIED");
  // Only rows that actually reached YouTube can testify about the bot check.
  const conclusive = passing + blocked;

  if (unreachable > 0) {
    const sample = proxyRows.find((r) => r.state === "UNREACHABLE")?.error;
    console.log(
      `! ${unreachable}/${proxyRows.length} proxies could not be reached at all (e.g. ${sample}).\n` +
        "  That is a transport or credentials problem, NOT a bot-check result — those rows\n" +
        "  prove nothing either way. Sanity-check one outside Node before reading anything\n" +
        "  into them:  curl -x http://user:pass@host:port https://api.ipify.org?format=json"
    );
  }
  if (misconfigured > 0) {
    console.log(
      `! ${misconfigured}/${proxyRows.length} proxies returned the direct control's own IP,\n` +
        "  so they were never in the request path. Config problem, not a verdict."
    );
  }

  if (conclusive === 0) {
    console.log("\n✗ No proxy reached YouTube, so this run is INCONCLUSIVE. Fix the above and re-run.");
    process.exitCode = 1;
  } else if (passing === conclusive) {
    console.log(
      `\n✓ All ${conclusive} reachable proxies defeated the bot check. The free tier is enough — wire it in.`
    );
  } else if (passing > 0) {
    console.log(
      `\n~ ${passing}/${conclusive} reachable proxies passed. The pool is partially burned, so an\n` +
        "  integration would need health-checking and rotation, not a single fixed proxy."
    );
  } else {
    console.log(
      `\n✗ All ${conclusive} reachable proxies were bot-checked, same as Vercel. Datacenter IPs\n` +
        "  do not clear it. The next decision is residential egress (~$3.50/mo) — now evidence-backed."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
