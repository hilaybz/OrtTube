import type { Language } from "@/lib/lang";
import type { TutorMode } from "@/lib/classes";

/** Hebrew display names for the supported content languages. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  he: "עברית",
  ar: "ערבית",
  en: "אנגלית",
};

/** Hebrew display names for the per-assignment tutor mode. */
export const TUTOR_MODE_LABELS: Record<TutorMode, string> = {
  off: "כבוי",
  hints: "רמזים בלבד",
  full: "מלא",
};

/**
 * Format an ISO timestamp as DD/MM/YYYY using UTC parts so the string is
 * identical on the server and the client (no hydration mismatch, no TZ/locale
 * drift). Used for roster "joined" / invite dates.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}
