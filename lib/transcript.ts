import { YoutubeTranscript } from "youtube-transcript";
import { createProxiedFetch } from "./egress";
import { fetchPlayerResponse, type CaptionTrack } from "./innertube";

export interface TranscriptSegment {
  text: string;
  offset: number; // milliseconds from the start of the video
  duration: number; // milliseconds
}

export type { CaptionTrack };

export type FetchOutcome = (
  | {
      status: "ok";
      segments: TranscriptSegment[];
      language: string | null;
    }
  | { status: "unavailable" }
  /**
   * A transient/ambiguous failure (network, rate limit, bot check, parse) — must
   * NOT downgrade status. `reason` records which, so a failure on an IP we can't
   * reproduce locally is still diagnosable from logs.
   */
  | { status: "error"; reason: string }
) & {
  trace: string[];
};

// Order in which caption languages are requested. The app speaks he/ar/en; "iw"
// is the legacy ISO code for Hebrew that older videos still use.
const LANG_PREFERENCE = ["he", "iw", "ar", "en"];

/**
 * Wall-clock budget for ONE transcript fetch, across every request it makes.
 * The per-exit timeout in `egress` bounds a single request, not the sweep: with
 * several exits tried in sequence across two endpoints, the worst case ran past
 * three minutes while every caller's route caps at 60s. The platform then killed
 * the function mid-fetch, so the bandwidth was spent and no verdict was recorded.
 */
const FETCH_BUDGET_MS = 35_000;

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
 * That same seam is how the watch page is kept out. `fetchTranscript` falls back
 * to `GET /watch?v=…` whenever its InnerTube call returns nothing — including the
 * bot-walled case this whole system exists to survive — and that page is ~1.2MB
 * against metered egress, fetched once per exit. Refusing it here is the only
 * place the fallback can be reached: it is unconditional inside the package.
 */
function tracingFetch(trace: string[], signal: AbortSignal): typeof globalThis.fetch {
  return async (input, init) => {
    const raw =
      typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    let label = raw;
    try {
      const url = new URL(raw);
      label = `${url.host}${url.pathname}`;
    } catch {
    }

    if (label === "www.youtube.com/watch") {
      trace.push(`${method} ${label} → refused (watch-page fallback)`);
      throw new WatchPageRefused();
    }

    try {
      const res = await createProxiedFetch(trace)(input, { ...init, signal });
      trace.push(`${method} ${label} → ${res.status}`);
      return res;
    } catch (e) {
      trace.push(`${method} ${label} → ${describeError(e)}`);
      throw e;
    }
  };
}

export function normalizeLang(code: string | null | undefined): string | null {
  if (!code) return null;
  const base = code.toLowerCase().split("-")[0];
  return base === "iw" ? "he" : base;
}

/**
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
    trace.push(`${attempt} → ${describeError(e)}`);
    return null;
  }
}

/**
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
