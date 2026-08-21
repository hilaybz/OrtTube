import { fetchPlayerResponse } from "./innertube";

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

export interface OEmbedInfo {
  title: string | null;
  /** The uploading channel's display name (oEmbed's `author_name`) — shown
   * as the video's creator on quiz cards. */
  channelName: string | null;
}

/** Fetches title + channel name in one oEmbed call. */
export async function fetchYouTubeOEmbed(videoId: string): Promise<OEmbedInfo> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return { title: null, channelName: null };
    const data = (await res.json()) as { title?: string; author_name?: string };
    return {
      title: data.title?.trim() || null,
      channelName: data.author_name?.trim() || null,
    };
  } catch {
    return { title: null, channelName: null };
  }
}

export interface VideoMetadata {
  title: string | null;
  durationSeconds: number | null;
  channelName: string | null;
}

/**
 * Reads `videoDetails.lengthSeconds` from the InnerTube player response. oEmbed
 * (used for the title) does not expose duration, so this is the only reliable
 * no-API-key source. Returns null on any failure — callers tolerate a null and
 * the value can be backfilled later.
 *
 * This used to scrape the watch page, which meant fetching ~1,197 KB for one
 * integer, on the least reliable endpoint we touch, a second time on top of the
 * copy the transcript path already pulled. The player endpoint carries the same
 * field in ~156 KB and is what actually works from a proxied IP.
 */
async function fetchDurationSeconds(videoId: string): Promise<number | null> {
  const result = await fetchPlayerResponse(videoId);
  return result.ok ? result.lengthSeconds : null;
}

/**
 * Fetches real metadata for a YouTube video: `title` + `channelName` via
 * oEmbed (one call) and `durationSeconds` via a watch-page scrape. Node/server
 * only. Any field may be null if YouTube is unreachable or changes its page
 * shape — callers must tolerate nulls (the row is still created; metadata can
 * be backfilled later).
 */
export async function fetchVideoMetadata(videoId: string): Promise<VideoMetadata> {
  const [oembed, durationSeconds] = await Promise.all([
    fetchYouTubeOEmbed(videoId),
    fetchDurationSeconds(videoId),
  ]);
  return { title: oembed.title, channelName: oembed.channelName, durationSeconds };
}
