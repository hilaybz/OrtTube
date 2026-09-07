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

export const parseYouTubeId = extractVideoId;

export interface OEmbedInfo {
  title: string | null;
  channelName: string | null;
}

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
 */
async function fetchDurationSeconds(videoId: string): Promise<number | null> {
  const result = await fetchPlayerResponse(videoId);
  return result.ok ? result.lengthSeconds : null;
}

export async function fetchVideoMetadata(videoId: string): Promise<VideoMetadata> {
  const [oembed, durationSeconds] = await Promise.all([
    fetchYouTubeOEmbed(videoId),
    fetchDurationSeconds(videoId),
  ]);
  return { title: oembed.title, channelName: oembed.channelName, durationSeconds };
}
