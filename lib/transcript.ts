import { YoutubeTranscript } from "youtube-transcript";
import { createProxiedFetch } from "./egress";
import { fetchPlayerResponse } from "./innertube";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TranscriptSegment {
  text: string;
  offset: number; // milliseconds from the start of the video
  duration: number; // milliseconds
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  /** YouTube tags auto-generated (ASR) tracks with kind === "asr". */
  kind?: string;
}

/** Result of a fresh (non-cached) transcript fetch. */
export type FetchOutcome = (
  | {
      status: "ok";
      segments: TranscriptSegment[];
      language: string | null;
      /** Provenance of the captions — see `trackKind`. Descriptive only. */
      kind: "manual" | "asr" | "package";
    }
  /**
   * The watch page loaded INTACT (playable) and listed no caption tracks — the
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
   * `reason` names the verdict; this says how it was reached. One fetch attempt
   * makes up to eleven requests across two endpoints and three client
   * fingerprints, and they fail independently — a summary alone cannot tell
   * "InnerTube 403 on every language" (an egress block) from "InnerTube 200 but
   * no caption tracks" (a video-shaped problem), and those need different fixes.
   * Callers own the log sink; this type only carries the material.
   */
  trace: string[];
};

// Order in which caption languages are requested. The app speaks he/ar/en; "iw"
// is the legacy ISO code for Hebrew that older videos still use.
const LANG_PREFERENCE = ["he", "iw", "ar", "en"];

// ─── Upstream tracing ────────────────────────────────────────────────────────

/** Names an error by class as well as message — the download's typed errors
 * (rate limit, disabled captions, unavailable video) carry their diagnosis in
 * the class name, and a bare `.message` throws it away. */
function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  // undici reports a transport failure as a bare `TypeError: fetch failed` and
  // puts the actual diagnosis (ECONNREFUSED, ETIMEDOUT, …) on `.cause`. Naming
  // only the wrapper makes a dead proxy indistinguishable from a DNS failure.
  const cause = e.cause;
  const suffix =
    cause instanceof Error
      ? ` (${(cause as NodeJS.ErrnoException).code ?? cause.message})`
      : "";
  return `${e.constructor.name}: ${e.message}${suffix}`;
}

/**
 * Wraps `fetch` so each request the DOWNLOAD makes lands in `trace`.
 *
 * The download runs inside `youtube-transcript`, which swallows every HTTP
 * detail and reports only that it found nothing — yet those ten requests are
 * most of the upstream surface, and their status codes are the difference
 * between an IP block and a video that genuinely has no captions. The package
 * takes a `fetch` override, so injecting one is the only seam that reaches them
 * without forking it.
 */
function tracingFetch(trace: string[]): typeof globalThis.fetch {
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
    try {
      // Trace-aware: without it a fully-burned proxy pool is invisible here,
      // showing only the last exit's bot check.
      const res = await createProxiedFetch(trace)(input, init);
      trace.push(`${method} ${label} → ${res.status}`);
      return res;
    } catch (e) {
      trace.push(`${method} ${label} → ${describeError(e)}`);
      throw e;
    }
  };
}

// ─── Caption track discovery ─────────────────────────────────────────────────

interface CaptionScrape {
  /** Whether the player response was fetched and parsed. */
  pageLoaded: boolean;
  /**
   * `playabilityStatus.status` from the player response ("OK", "LOGIN_REQUIRED",
   * "UNPLAYABLE", …), or null when absent. This is the discriminator between a
   * response served INTACT that genuinely lists no captions, and a degraded one
   * where the caption data was withheld — the two are otherwise identical from
   * the outside, and conflating them is what let a blocked fetch be recorded as
   * "this video has no captions".
   */
  playability: string | null;
  tracks: CaptionTrack[];
  /**
   * Why the lookup yielded nothing, when `pageLoaded` is false: `http_<status>`,
   * `no_player_json`, or a thrown error. Null when it loaded.
   *
   * A refused request, a bot wall that answers 200 with no player JSON, and a
   * network error are three different problems wanting three different fixes —
   * only the first is an argument for paid egress. Collapsed into a bare "not
   * loaded" they are indistinguishable, which is how the most common production
   * failure stayed unattributable.
   */
  failure: string | null;
}

/**
 * Reads playability and the caption track list off the InnerTube player
 * response.
 *
 * This used to scrape the watch page. That page is ~1,197 KB of which these two
 * fields are 10.4 KB, only 3 of 5 residential exits would serve it, and the
 * duration lookup fetched it a second time — so on metered egress it cost more
 * than everything else combined while being the least reliable request we made.
 * The player endpoint carries the same fields, answered 8 of 8, and is the call
 * the download itself makes moments later.
 *
 * The `CaptionScrape` shape is deliberately unchanged, so `fetchFreshTranscript`'s
 * confirmed-vs-transient classification did not have to move with it.
 */
async function fetchCaptionTracks(
  videoId: string,
  trace: string[]
): Promise<CaptionScrape> {
  const result = await fetchPlayerResponse(videoId, trace);
  if (!result.ok) {
    trace.push(`lookup → ${result.failure}`);
    return { pageLoaded: false, playability: null, tracks: [], failure: result.failure };
  }
  const { playability, tracks } = result;
  trace.push(
    `lookup → playability=${playability ?? "absent"} tracks=${tracks.length}` +
      (tracks.length
        ? ` [${tracks.map((t) => `${t.languageCode}${t.kind === "asr" ? ":asr" : ""}`).join(",")}]`
        : "")
  );
  return { pageLoaded: true, playability, tracks, failure: null };
}

/** Normalize caption language codes to the app's supported set (iw → he). */
export function normalizeLang(code: string | null | undefined): string | null {
  if (!code) return null;
  const base = code.toLowerCase().split("-")[0];
  return base === "iw" ? "he" : base;
}

/**
 * Provenance of a downloaded transcript, read off the scraped track list by
 * matching the language the download actually used. `"package"` means the scrape
 * could not corroborate it — the watch page was blocked, or it listed no track in
 * that language — so whether a human or a machine wrote the captions is unknown.
 */
function trackKind(
  tracks: CaptionTrack[],
  language: string | null
): "manual" | "asr" | "package" {
  if (!language) return "package";
  const match = tracks.find((t) => normalizeLang(t.languageCode) === language);
  if (!match) return "package";
  return match.kind === "asr" ? "asr" : "manual";
}

// ─── Transcript download (InnerTube) ────────────────────────────────────────

async function tryPackage(
  videoId: string,
  trace: string[],
  lang?: string
): Promise<{ segments: TranscriptSegment[]; language: string | null } | null> {
  const attempt = `download lang=${lang ?? "any"}`;
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId, {
      ...(lang ? { lang } : {}),
      fetch: tracingFetch(trace),
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

/**
 * Picks the language to download from the tracks the scrape already listed,
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

/**
 * Downloads the transcript in ONE call.
 *
 * This used to walk `LANG_PREFERENCE` blind — up to five attempts, four of them
 * guaranteed to miss on a single-track video, each able to trigger its own
 * ~1.2MB watch-page download inside the package. That is ~7MB per video, and on
 * metered proxy egress it multiplies the bill roughly fivefold for nothing.
 *
 * The scrape has already returned the track list, so the language is known
 * before any download starts: ask for that one.
 *
 * The unconstrained retry is not belt-and-braces — it covers a real divergence.
 * The scrape reads the WEB watch page while the download talks to the ANDROID
 * InnerTube player, and the two do not always list a video's captions under the
 * same code: Hebrew appears as "he" on one and the legacy "iw" on the other,
 * which is why `LANG_PREFERENCE` carries both spellings. The package matches the
 * requested language EXACTLY and throws when it cannot, so asking for the code
 * the scrape saw can miss a track the download would otherwise have served.
 * Retrying without a language costs one extra call only when the first failed,
 * versus the five this used to spend every time.
 */
async function fetchViaPackage(
  videoId: string,
  trace: string[],
  tracks: CaptionTrack[]
): Promise<{ segments: TranscriptSegment[]; language: string | null } | null> {
  const lang = preferredTrackLang(tracks);
  if (!lang) return tryPackage(videoId, trace);
  return (await tryPackage(videoId, trace, lang)) ?? tryPackage(videoId, trace);
}

// ─── Fresh transcript fetch (original language) ──────────────────────────────

/**
 * Fetches a fresh transcript for `videoId`, in its **original language** — it is
 * never machine-translated here.
 *
 * The download runs over the InnerTube player endpoint (an ANDROID client
 * context, via `youtube-transcript`). The watch-page scrape is deliberately NOT a
 * download path: YouTube answers an `api/timedtext` URL lifted out of the watch
 * page with an empty 200 — on every IP, including a residential one, in every
 * subtitle format — so requesting one only ever burned a request and made the
 * real download look like a fallback. The scrape survives for the two questions
 * it still answers reliably:
 *
 *   1. `playabilityStatus` — the only discriminator between a page served INTACT
 *      that genuinely lists no captions and a degraded one withholding them.
 *   2. The track list, which says whether the captions are human or ASR.
 *
 * Distinguishes a **confirmed** no-captions result (page loaded, playable, zero
 * tracks, download empty → `"unavailable"`) from a **transient** failure
 * (blocked, unparseable, or tracks that wouldn't download → `"error"`), so
 * callers only downgrade `transcript_status` on a confirmed change.
 */
export async function fetchFreshTranscript(videoId: string): Promise<FetchOutcome> {
  const trace: string[] = [];
  const scrape = await fetchCaptionTracks(videoId, trace);

  const pkg = await fetchViaPackage(videoId, trace, scrape.tracks);
  if (pkg) {
    return {
      status: "ok",
      segments: pkg.segments,
      language: pkg.language,
      kind: trackKind(scrape.tracks, pkg.language),
      trace,
    };
  }

  // A CONFIRMED no-captions video requires evidence the page was served INTACT:
  // it loaded, YouTube reported the video as playable, and it still listed zero
  // caption tracks. A degraded response (bot check, login wall, age gate, region
  // block) also parses and also lists zero tracks — treating that as confirmation
  // is what let a blocked fetch permanently mark a captioned video as having
  // none. Anything short of intact-and-playable is transient.
  if (scrape.pageLoaded && scrape.playability === "OK" && scrape.tracks.length === 0) {
    return { status: "unavailable", trace };
  }

  // Reason codes exist so a production failure is diagnosable: the interesting
  // failures happen on IPs we cannot reproduce locally, and "it returned error"
  // does not distinguish "rate-limited" from "video is age-gated". The scrape's
  // own failure is carried through rather than flattened, because "refused" and
  // "answered, but not with a page we recognise" argue for different fixes.
  const reason = !scrape.pageLoaded
    ? `page_not_loaded:${scrape.failure ?? "unknown"}`
    : scrape.playability && scrape.playability !== "OK"
      ? `not_playable:${scrape.playability}`
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
