import type { Language } from "@/lib/lang";

/** Hebrew display labels for the supported content languages. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  he: "עברית",
  ar: "ערבית",
  en: "אנגלית",
};

/** A bare YouTube id: exactly 11 url-safe characters. */
const BARE_ID = /^[a-zA-Z0-9_-]{11}$/;

/**
 * The URL shapes a YouTube id can arrive in — the same list the server's
 * `extractVideoId` (`lib/youtube.ts`) matches on.
 */
const URL_PATTERNS = [
  /[?&]v=([a-zA-Z0-9_-]{11})/,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
];

/**
 * Reads a video id out of whatever a teacher pasted — a watch/short/embed URL,
 * or a bare id — so the new-quiz form can show the video's thumbnail and flag a
 * bad link before anything is created.
 *
 * Deliberately a local copy of the pattern list rather than an import of
 * `@/lib/youtube`: that module pulls the `youtube-transcript` dependency in at
 * module scope, which has no business in a browser bundle. The server remains
 * the authority — the form still posts the pasted URL and lets
 * `POST /api/quizzes` extract it.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (BARE_ID.test(trimmed)) return trimmed;
  for (const pattern of URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** True when the input is a bare id rather than a URL (posted as `youtubeId`). */
export function isBareYouTubeId(input: string): boolean {
  return BARE_ID.test(input.trim());
}

/** Format a whole-second offset as mm:ss (or h:mm:ss past an hour). */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Parse a `mm:ss` / `h:mm:ss` / bare-seconds string into whole seconds.
 * Returns null when the input is not a valid non-negative time.
 */
export function parseTime(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  let seconds = 0;
  for (const n of nums) seconds = seconds * 60 + n;
  return Number.isFinite(seconds) ? seconds : null;
}
