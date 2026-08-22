import { YoutubeTranscript } from "youtube-transcript";
import { createProxiedFetch } from "./egress";
import { fetchPlayerResponse, type CaptionTrack } from "./innertube";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TranscriptSegment {
  text: string;
  offset: number; // milliseconds from the start of the video
  duration: number; // milliseconds
}

export type { CaptionTrack };

/** Result of a fresh (non-cached) transcript fetch. */
export type FetchOutcome = (
  | {
      status: "ok";
      segments: TranscriptSegment[];
      language: string | null;
    }
  /**
   * The player response was INTACT (playable) and listed no caption tracks — the
   * only evidence that actually confirms a video has none.
   */
  | { status: "unavailable" }
  /**
   * A transient/ambiguous failure (network, rate limit, bot check, parse) — must
   * NOT downgrade status. `reason` records which, so a failure on an IP we can't
   * reproduce locally is still diagnosable from logs.
   */
  | { status: "error"; reason: string }
) & {
  /**
   * Every upstream request and decision this attempt made, in order.
   *
   * `reason` names the verdict; this says how it was reached. The requests fail
   * independently — a summary alone cannot tell "InnerTube 403" (an egress block)
   * from "InnerTube 200 but no caption tracks" (a video-shaped problem), and
   * those need different fixes. Callers own the log sink; this type only carries
   * the material.
   */
  trace: string[];
};

// Order in which caption languages are requested. The app speaks he/ar/en; "iw"
// is the legacy ISO code for Hebrew that older videos still use.
const LANG_PREFERENCE = ["he", "iw", "ar", "en"];

/**
 * Wall-clock budget for ONE transcript fetch, across every request it makes.
 *
 * The per-exit timeout in `egress` bounds a single request, not the sweep: with
 * several exits tried in sequence across two endpoints, the worst case ran past
 * three minutes while every caller's route caps at 60s. The platform then killed
 * the function mid-fetch, so the bandwidth was spent and no verdict was recorded.
 * A budget that fits inside the route is the only thing that makes the outcome
 * reliable.
 */
const FETCH_BUDGET_MS = 35_000;

// ─── Upstream tracing ────────────────────────────────────────────────────────

/** Names an error by class as well as message — the download's typed errors
 * (rate limit, disabled captions, unavailable video) carry their diagnosis in
 * the class name, and a bare `.message` throws it away. */
function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  // undici reports a transport failure as a bare `TypeError: fetch failed` and
  // buries the real diagnosis several `.cause` levels down. Walking only ONE
  // level found a DOMException whose code is 0, so the trace read
  // "TypeError: fetch failed (0)" while the level below it said
  // "Proxy response (407)" — the entire answer, discarded.
  let deepest: Error = e;
  while (deepest.cause instanceof Error) deepest = deepest.cause;
  if (deepest === e) return `${e.constructor.name}: ${e.message}`;
  const code = (deepest as NodeJS.ErrnoException).code;
  const detail = code && !deepest.message.includes(code)
    ? `${code}: ${deepest.message}`
    : code ?? deepest.message;
  return `${e.constructor.name}: ${e.message} (${detail})`;
}

/** Thrown instead of fetching the watch page. See `tracingFetch`. */
class WatchPageRefused extends Error {
  constructor() {
    super("watch-page fallback refused (see lib/transcript.ts)");
    this.name = "WatchPageRefused";
  }
}

/**
 * Wraps `fetch` so each request the DOWNLOAD makes lands in `trace`, shares the
 * fetch budget, and cannot reach the watch page.
 *
 * The download runs inside `youtube-transcript`, which swallows every HTTP detail
 * and reports only that it found nothing — yet those requests are most of the
 * upstream surface, and their status codes are the difference between an IP block
 * and a video that genuinely has no captions. The package takes a `fetch`
 * override, so injecting one is the only seam that reaches them without forking
 * it.
 *
 * That same seam is how the watch page is kept out. `fetchTranscript` falls back
 * to `GET /watch?v=…` whenever its InnerTube call returns nothing — including the
 * bot-walled case this whole system exists to survive — and that page is ~1.2MB
 * against metered egress, fetched once per exit. Refusing it here is the only
 * place the fallback can be reached: it is unconditional inside the package.
 * Verified: `fetchViaWebPage` ignores the response status and reads `.text()`, so
 * a throw is the one signal that reliably stops it, and it surfaces in the trace
 * rather than as a silent skip.
 */
function tracingFetch(trace: string[], signal: AbortSignal): typeof globalThis.fetch {
  return async (input, init) => {
    const raw =
      typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    // Path only: a watch or player URL carries the video id and API keys in its
    // query string, and the endpoint is what identifies the call.
    let label = raw;
    try {
      const url = new URL(raw);
      label = `${url.host}${url.pathname}`;
    } catch {
      // Not absolute — keep it verbatim rather than dropping the request.
    }

    if (label === "www.youtube.com/watch") {
      trace.push(`${method} ${label} → refused (watch-page fallback)`);
      throw new WatchPageRefused();
    }

    try {
      // Trace-aware: without it a fully-burned proxy pool is invisible here,
      // showing only the last exit's bot check.
      const res = await createProxiedFetch(trace)(input, { ...init, signal });
      trace.push(`${method} ${label} → ${res.status}`);
      return res;
    } catch (e) {
      trace.push(`${method} ${label} → ${describeError(e)}`);
      throw e;
    }
  };
}

// ─── Language selection ──────────────────────────────────────────────────────

/** Normalize caption language codes to the app's supported set (iw → he). */
export function normalizeLang(code: string | null | undefined): string | null {
  if (!code) return null;
  const base = code.toLowerCase().split("-")[0];
  return base === "iw" ? "he" : base;
}

/**
 * Picks the language to download from the tracks the player already listed,
 * ranked by `LANG_PREFERENCE`. Returns null when the list is empty or holds
 * nothing the app speaks — the caller then asks for no language in particular.
 *
 * Ties break toward human captions. `normalizeLang` maps "iw" onto "he", so the
 * two spellings of Hebrew rank identically and a video carrying both would
 * otherwise be decided by list order — which can hand back the auto-generated
 * track when a human-written one is sitting next to it.
 */
function preferredTrackLang(tracks: CaptionTrack[]): string | null {
  let best: { code: string; rank: number; asr: boolean } | null = null;
  for (const track of tracks) {
    const rank = LANG_PREFERENCE.indexOf(normalizeLang(track.languageCode) ?? "");
    if (rank === -1) continue;
    const asr = track.kind === "asr";
    if (!best || rank < best.rank || (rank === best.rank && best.asr && !asr)) {
      best = { code: track.languageCode, rank, asr };
    }
  }
  return best?.code ?? null;
}

// ─── Transcript download ─────────────────────────────────────────────────────

/**
 * Puts segment timings into milliseconds, which is what `TranscriptSegment`
 * declares and what every consumer assumes.
 *
 * `youtube-transcript` has two parsers and they disagree: the srv3 branch reads
 * integer millisecond attributes, while the classic `<text start="0.04">` branch
 * runs `parseFloat` on SECONDS and returns them unconverted. Nothing in the
 * package marks which one ran. Trusting it would break quietly and badly — the
 * tutor's spoiler bound compares `offset + duration` against the playhead in ms,
 * so seconds-as-milliseconds admits the entire rest of the video, and generated
 * questions would all collapse onto the first few seconds.
 *
 * The video's own duration decides it: in milliseconds the last segment ends near
 * `duration × 1000`, so anything landing within a small multiple of `duration` is
 * in seconds. Without a duration, fall back to the parsers' own signature —
 * `parseInt` cannot produce a fraction, so a fractional value came from the
 * classic branch.
 */
function toMilliseconds(
  segments: TranscriptSegment[],
  durationSeconds: number | null
): TranscriptSegment[] {
  if (segments.length === 0) return segments;
  const end = Math.max(...segments.map((s) => s.offset + s.duration));

  const inSeconds =
    durationSeconds && durationSeconds > 0
      ? end <= durationSeconds * 2
      : segments.some(
          (s) => !Number.isInteger(s.offset) || !Number.isInteger(s.duration)
        );

  if (!inSeconds) return segments;
  return segments.map((s) => ({
    text: s.text,
    offset: s.offset * 1000,
    duration: s.duration * 1000,
  }));
}

/**
 * Downloads the transcript in ONE call.
 *
 * This used to walk `LANG_PREFERENCE` blind — up to five attempts, four of them
 * guaranteed to miss on a single-track video. The player response has already
 * returned the track list, so the language is known before any download starts:
 * ask for that one.
 *
 * There is deliberately no unconstrained retry. One existed to cover a divergence
 * between the WEB watch page (which listed Hebrew as "he") and the ANDROID player
 * the download talks to (which listed it as "iw") — but both sides now read the
 * same player endpoint with the same client fingerprint, moments apart, so the
 * code handed to the package comes from the very list the package matches
 * against. The retry could only ever repeat the first call's failure, at the cost
 * of a second full download attempt.
 */
async function tryPackage(
  videoId: string,
  trace: string[],
  signal: AbortSignal,
  lang?: string
): Promise<{ segments: TranscriptSegment[]; language: string | null } | null> {
  const attempt = `download lang=${lang ?? "any"}`;
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId, {
      ...(lang ? { lang } : {}),
      fetch: tracingFetch(trace, signal),
    });
    if (!raw || raw.length === 0) {
      // A resolved-but-empty result is NOT the same as a throw: the endpoints
      // answered, so this says something about the video rather than the egress.
      trace.push(`${attempt} → empty`);
      return null;
    }
    trace.push(`${attempt} → ${raw.length} segments`);
    return {
      segments: raw.map((s) => ({ text: s.text, offset: s.offset, duration: s.duration })),
      // Read the language off the RESPONSE, not off `lang`: the request carries a
      // preference the download may satisfy with a different track, so trusting
      // the request would mislabel the transcript.
      language: normalizeLang(raw[0].lang ?? lang),
    };
  } catch (e) {
    // The package's typed errors are the sharpest diagnosis available anywhere
    // in this flow — a captcha wall, disabled captions and an unavailable video
    // each get their own class — and this catch used to discard all of them.
    trace.push(`${attempt} → ${describeError(e)}`);
    return null;
  }
}

// ─── Fresh transcript fetch (original language) ──────────────────────────────

/**
 * Fetches a fresh transcript for `videoId`, in its **original language** — it is
 * never machine-translated here.
 *
 * One player call answers three questions before any download starts: is the
 * video playable, which caption tracks exist, and how long is it. That is enough
 * to settle the caption-less case outright, and to pick the download language
 * instead of guessing at it.
 *
 * Distinguishes a **confirmed** no-captions result (player intact, playable, zero
 * tracks → `"unavailable"`) from a **transient** failure (blocked, unparseable, or
 * tracks that wouldn't download → `"error"`), so callers only downgrade
 * `transcript_status` on a confirmed change.
 */
export async function fetchFreshTranscript(videoId: string): Promise<FetchOutcome> {
  const trace: string[] = [];
  const signal = AbortSignal.timeout(FETCH_BUDGET_MS);

  const player = await fetchPlayerResponse(videoId, trace, signal);
  if (!player.ok) {
    trace.push(`lookup → ${player.failure}`);
    // A refused request, a bot wall that answers 200 with no player JSON, and a
    // network error are three different problems wanting three different fixes —
    // only the first is an argument for paid egress. Carried through rather than
    // flattened, because collapsing them is how the most common production
    // failure stayed unattributable.
    return { status: "error", reason: `player_not_loaded:${player.failure}`, trace };
  }

  const { playability, tracks, lengthSeconds } = player;
  trace.push(
    `lookup → playability=${playability ?? "absent"} tracks=${tracks.length}` +
      (tracks.length
        ? ` [${tracks.map((t) => `${t.languageCode}${t.kind === "asr" ? ":asr" : ""}`).join(",")}]`
        : "")
  );

  // A CONFIRMED no-captions video, settled without a download. The player was
  // served INTACT — it loaded, YouTube reported the video as playable — and it
  // still listed zero caption tracks, so there is nothing a download could fetch.
  //
  // Running one anyway is what made a caption-less video expensive: the package
  // re-asks this same endpoint, gets the same empty list, and falls through to
  // the 1.2MB watch page on every exit. Twelve requests to reach the conclusion
  // already in hand after one.
  //
  // Both halves of the condition are load-bearing. A degraded response (bot
  // check, login wall, age gate, region block) also parses and also lists zero
  // tracks; treating that as confirmation is what let a blocked fetch permanently
  // mark a captioned video as having none.
  if (playability === "OK" && tracks.length === 0) {
    return { status: "unavailable", trace };
  }

  const lang = preferredTrackLang(tracks);
  const pkg = await tryPackage(videoId, trace, signal, lang ?? undefined);
  if (pkg) {
    return {
      status: "ok",
      segments: toMilliseconds(pkg.segments, lengthSeconds),
      language: pkg.language,
      trace,
    };
  }

  const reason =
    playability && playability !== "OK"
      ? `not_playable:${playability}`
      : "tracks_undownloadable";
  return { status: "error", reason, trace };
}

// ─── Playhead slicing (AI-tutor spoiler bounding) ───────────────────────

/**
 * Returns transcript text up to `positionSeconds`, keeping the **most recent**
 * portion verbatim under an approximate token cap (~4 chars per token). Used to
 * bound the AI tutor's context so it can't reveal content past the student's
 * current playhead.
 *
 * A segment is included ONLY if it has fully ELAPSED — it ends at or before the
 * playhead (`offset + duration <= positionSeconds * 1000`). A segment that merely
 * STARTED before the playhead but is still playing would otherwise leak its
 * post-playhead text (a spoiler); the in-progress segment is dropped instead
 * (acceptable — the student is mid-sentence, nothing past the playhead escapes).
 */
export function sliceTranscriptToPlayhead(
  segments: TranscriptSegment[],
  positionSeconds: number,
  tokenCap = 2000
): string {
  const positionMs = positionSeconds * 1000;
  const upTo = segments
    .filter((s) => s.offset + s.duration <= positionMs)
    .sort((a, b) => a.offset - b.offset)
    .map((s) => s.text.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (upTo.length === 0) return "";

  const charCap = Math.max(1, tokenCap) * 4;
  const kept: string[] = [];
  let total = 0;
  for (let i = upTo.length - 1; i >= 0; i--) {
    const len = upTo[i].length + 1;
    if (total + len > charCap && kept.length > 0) break;
    kept.push(upTo[i]);
    total += len;
    if (total >= charCap) break;
  }
  kept.reverse();
  const text = kept.join(" ");
  // A single trailing segment can exceed the cap; keep its most-recent tail.
  return text.length > charCap ? text.slice(text.length - charCap) : text;
}
