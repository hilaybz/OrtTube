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
      /** Provenance of the winning track. Manual (human) captions never equal "asr". */
      kind: "manual" | "asr" | "package";
    }
  /** The watch page loaded and confirmed the video has no caption tracks. */
  | { status: "unavailable" }
  /** A transient/ambiguous failure (network, parse, empty) — must NOT downgrade status. */
  | { status: "error" };

// Caption-language preference within a track group. The app speaks he/ar/en;
// "iw" is the legacy ISO code for Hebrew that older videos still use.
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
  tracks: CaptionTrack[];
}

async function fetchCaptionTracks(videoId: string): Promise<CaptionScrape> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: YOUTUBE_HEADERS,
    });
    if (!res.ok) return { pageLoaded: false, tracks: [] };
    const html = await res.text();
    const data = extractInlineJson(html, "ytInitialPlayerResponse") as
      | { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } }
      | null;
    // Player response absent → the page shape changed or we were blocked: treat
    // as "not loaded" so callers keep the result transient (no status downgrade).
    if (!data) return { pageLoaded: false, tracks: [] };
    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return { pageLoaded: true, tracks: Array.isArray(tracks) ? tracks : [] };
  } catch {
    return { pageLoaded: false, tracks: [] };
  }
}

function langRank(code: string): number {
  const base = code.toLowerCase().split("-")[0];
  const i = LANG_PREFERENCE.indexOf(base);
  return i === -1 ? LANG_PREFERENCE.length : i;
}

/** Normalize caption language codes to the app's supported set (iw → he). */
export function normalizeLang(code: string | null | undefined): string | null {
  if (!code) return null;
  const base = code.toLowerCase().split("-")[0];
  return base === "iw" ? "he" : base;
}

/**
 * Selection order: prefer a **manual** (human) track in any language over any
 * ASR track; within a group prefer the app's languages (he/ar/en). Returns null
 * when the track list is empty.
 */
export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const manual = tracks.filter((t) => t.kind !== "asr");
  const asr = tracks.filter((t) => t.kind === "asr");
  const byPreference = (a: CaptionTrack, b: CaptionTrack) =>
    langRank(a.languageCode) - langRank(b.languageCode);
  if (manual.length) return [...manual].sort(byPreference)[0];
  if (asr.length) return [...asr].sort(byPreference)[0];
  return null;
}

// ─── Transcript parsing ──────────────────────────────────────────────────────

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function parseSrv3(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(m[1], 10);
    const durMs = parseInt(m[2], 10);
    const inner = m[3];
    let text = "";
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch;
    while ((sMatch = sRegex.exec(inner)) !== null) {
      text += sMatch[1];
    }
    if (!text) text = inner.replace(/<[^>]+>/g, "");
    text = decodeHtmlEntities(text).trim();
    if (text) {
      segments.push({ text, offset: startMs, duration: durMs });
    }
  }
  return segments;
}

function parseClassic(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const regex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const text = decodeHtmlEntities(m[3]).trim();
    if (text) {
      segments.push({
        text,
        offset: parseFloat(m[1]) * 1000,
        duration: parseFloat(m[2]) * 1000,
      });
    }
  }
  return segments;
}

async function fetchAndParseTranscript(url: string): Promise<TranscriptSegment[] | null> {
  try {
    const res = await fetch(url, { headers: YOUTUBE_HEADERS });
    if (!res.ok) return null;
    const xml = await res.text();

    const srv3 = parseSrv3(xml);
    if (srv3.length > 0) return srv3;

    const classic = parseClassic(xml);
    if (classic.length > 0) return classic;

    return null;
  } catch {
    return null;
  }
}

async function tryPackage(videoId: string, lang?: string): Promise<TranscriptSegment[] | null> {
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId, lang ? { lang } : undefined);
    if (!raw || raw.length === 0) return null;
    return raw.map((s) => ({ text: s.text, offset: s.offset, duration: s.duration }));
  } catch {
    return null;
  }
}

async function fetchViaPackage(
  videoId: string
): Promise<{ segments: TranscriptSegment[]; language: string | null } | null> {
  for (const lang of LANG_PREFERENCE) {
    const segments = await tryPackage(videoId, lang);
    if (segments && segments.length) {
      return { segments, language: normalizeLang(lang) };
    }
  }
  const any = await tryPackage(videoId);
  if (any && any.length) return { segments: any, language: null };
  return null;
}

// ─── Fresh transcript fetch (manual-first, original language) ────────────────

/**
 * Fetches a fresh transcript for `videoId`, preferring manual captions.
 *
 * Order: scrape the caption track list → pick a manual track (any language) →
 * else an ASR track → else the `youtube-transcript` package. The transcript is
 * returned in its **original language**; it is never machine-translated here.
 *
 * Distinguishes a **confirmed** no-captions result (page loaded, zero tracks,
 * package empty → `"unavailable"`) from a **transient** failure (network/parse
 * problem, or tracks existed but couldn't be downloaded → `"error"`), so callers
 * only downgrade `transcript_status` on a confirmed change.
 */
export async function fetchFreshTranscript(videoId: string): Promise<FetchOutcome> {
  const scrape = await fetchCaptionTracks(videoId);

  if (scrape.pageLoaded && scrape.tracks.length > 0) {
    const track = pickCaptionTrack(scrape.tracks);
    if (track) {
      const segments = await fetchAndParseTranscript(track.baseUrl);
      if (segments && segments.length) {
        return {
          status: "ok",
          segments,
          language: normalizeLang(track.languageCode),
          kind: track.kind === "asr" ? "asr" : "manual",
        };
      }
    }
  }

  const pkg = await fetchViaPackage(videoId);
  if (pkg) {
    return { status: "ok", segments: pkg.segments, language: pkg.language, kind: "package" };
  }

  // Only a page that loaded and reported zero caption tracks is a CONFIRMED
  // no-captions video. Anything else (page didn't load, or tracks existed but
  // the download failed) is transient and must not flip a working status.
  if (scrape.pageLoaded && scrape.tracks.length === 0) {
    return { status: "unavailable" };
  }
  return { status: "error" };
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
