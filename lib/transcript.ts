import { YoutubeTranscript } from "youtube-transcript";

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
export type FetchOutcome =
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
  | { status: "error"; reason: string };

// Order in which caption languages are requested. The app speaks he/ar/en; "iw"
// is the legacy ISO code for Hebrew that older videos still use.
const LANG_PREFERENCE = ["he", "iw", "ar", "en"];

const YOUTUBE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

// ─── Inline-JSON extraction (shared with lib/youtube.ts metadata scrape) ─────

/**
 * Extracts a top-level JSON object assigned to `varName` from a YouTube watch
 * page (`var ytInitialPlayerResponse = {…}`), balancing braces while ignoring
 * braces inside string literals. Exported so lib/youtube.ts can reuse it to read
 * `videoDetails.lengthSeconds`.
 */
export function extractInlineJson(html: string, varName: string): unknown {
  const tokens = [`var ${varName} = `, `${varName} = `];
  for (const token of tokens) {
    const startIndex = html.indexOf(token);
    if (startIndex === -1) continue;
    const jsonStart = startIndex + token.length;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = jsonStart; i < html.length; i++) {
      const ch = html[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(jsonStart, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

// ─── Caption track discovery ─────────────────────────────────────────────────

interface CaptionScrape {
  /** Whether the watch page loaded and a player response was parsed. */
  pageLoaded: boolean;
  /**
   * `playabilityStatus.status` from the player response ("OK", "LOGIN_REQUIRED",
   * "UNPLAYABLE", …), or null when absent. This is the discriminator between a
   * page served INTACT that genuinely lists no captions, and a degraded response
   * where the caption data was withheld — the two are otherwise identical from
   * the outside, and conflating them is what let a blocked fetch be recorded as
   * "this video has no captions".
   */
  playability: string | null;
  tracks: CaptionTrack[];
}

async function fetchCaptionTracks(videoId: string): Promise<CaptionScrape> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: YOUTUBE_HEADERS,
    });
    // Covers rate limiting (429) as well as outright errors — both mean we
    // learned nothing about this video's captions.
    if (!res.ok) return { pageLoaded: false, playability: null, tracks: [] };
    const html = await res.text();
    const data = extractInlineJson(html, "ytInitialPlayerResponse") as
      | {
          playabilityStatus?: { status?: string };
          captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
        }
      | null;
    // Player response absent → the page shape changed or we were blocked: treat
    // as "not loaded" so callers keep the result transient (no status downgrade).
    if (!data) return { pageLoaded: false, playability: null, tracks: [] };
    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return {
      pageLoaded: true,
      playability: data.playabilityStatus?.status ?? null,
      tracks: Array.isArray(tracks) ? tracks : [],
    };
  } catch {
    return { pageLoaded: false, playability: null, tracks: [] };
  }
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
  lang?: string
): Promise<{ segments: TranscriptSegment[]; language: string | null } | null> {
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId, lang ? { lang } : undefined);
    if (!raw || raw.length === 0) return null;
    return {
      segments: raw.map((s) => ({ text: s.text, offset: s.offset, duration: s.duration })),
      // Read the language off the RESPONSE, not off `lang`: the request carries a
      // preference the download may satisfy with a different track, so trusting
      // the request would mislabel the transcript.
      language: normalizeLang(raw[0].lang ?? lang),
    };
  } catch {
    return null;
  }
}

/** Tries the app's languages in preference order, then whatever the video has. */
async function fetchViaPackage(
  videoId: string
): Promise<{ segments: TranscriptSegment[]; language: string | null } | null> {
  for (const lang of LANG_PREFERENCE) {
    const got = await tryPackage(videoId, lang);
    if (got) return got;
  }
  return tryPackage(videoId);
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
  const scrape = await fetchCaptionTracks(videoId);

  const pkg = await fetchViaPackage(videoId);
  if (pkg) {
    return {
      status: "ok",
      segments: pkg.segments,
      language: pkg.language,
      kind: trackKind(scrape.tracks, pkg.language),
    };
  }

  // A CONFIRMED no-captions video requires evidence the page was served INTACT:
  // it loaded, YouTube reported the video as playable, and it still listed zero
  // caption tracks. A degraded response (bot check, login wall, age gate, region
  // block) also parses and also lists zero tracks — treating that as confirmation
  // is what let a blocked fetch permanently mark a captioned video as having
  // none. Anything short of intact-and-playable is transient.
  if (scrape.pageLoaded && scrape.playability === "OK" && scrape.tracks.length === 0) {
    return { status: "unavailable" };
  }

  // Reason codes exist so a production failure is diagnosable: the interesting
  // failures happen on IPs we cannot reproduce locally, and "it returned error"
  // does not distinguish "rate-limited" from "video is age-gated".
  const reason = !scrape.pageLoaded
    ? "page_not_loaded"
    : scrape.playability && scrape.playability !== "OK"
      ? `not_playable:${scrape.playability}`
      : "tracks_undownloadable";
  return { status: "error", reason };
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
