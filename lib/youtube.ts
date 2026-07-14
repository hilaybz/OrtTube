import { extractInlineJson } from "./transcript";

const PATTERNS = [
  /[?&]v=([a-zA-Z0-9_-]{11})/,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
];

export function extractVideoId(url: string): string | null {
  for (const pattern of PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Alias matching the backend-plan naming; extractVideoId is the original name. */
export const parseYouTubeId = extractVideoId;

export async function fetchYouTubeTitle(videoId: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return data.title?.trim() || null;
  } catch {
    return null;
  }
}

export interface VideoMetadata {
  title: string | null;
  durationSeconds: number | null;
}

/**
 * Scrapes `ytInitialPlayerResponse.videoDetails.lengthSeconds` from the watch
 * page. oEmbed (used for the title) does not expose duration, so this is the
 * only reliable no-API-key source. Returns null on any failure.
 */
async function fetchDurationSeconds(videoId: string): Promise<number | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const data = extractInlineJson(html, "ytInitialPlayerResponse") as
      | { videoDetails?: { lengthSeconds?: string } }
      | null;
    const raw = data?.videoDetails?.lengthSeconds;
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Fetches real metadata for a YouTube video: `title` via oEmbed and
 * `durationSeconds` via a watch-page scrape. Node/server only. Either field may
 * be null if YouTube is unreachable or changes its page shape — callers must
 * tolerate nulls (the row is still created; metadata can be backfilled later).
 */
export async function fetchVideoMetadata(videoId: string): Promise<VideoMetadata> {
  const [title, durationSeconds] = await Promise.all([
    fetchYouTubeTitle(videoId),
    fetchDurationSeconds(videoId),
  ]);
  return { title, durationSeconds };
}
