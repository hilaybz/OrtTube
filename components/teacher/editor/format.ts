import type { Language } from "@/lib/lang";

/** Hebrew display labels for the supported content languages. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  he: "עברית",
  ar: "ערבית",
  en: "אנגלית",
};

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
