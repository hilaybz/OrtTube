import type { Language } from "@/lib/lang";
import type { Subject } from "@/lib/subjects";
import type { TutorMode } from "@/lib/classes";

/** Hebrew display names for the supported content languages. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  he: "עברית",
  ar: "ערבית",
  en: "אנגלית",
};

/**
 * Hebrew display names for the class subjects. Keyed by the stable English
 * values in `lib/subjects.ts`, so a subject reads the same everywhere it is
 * shown while the stored value never changes.
 */
export const SUBJECT_LABELS: Record<Subject, string> = {
  math: "מתמטיקה",
  hebrew: "לשון עברית",
  literature: "ספרות",
  bible: "תנ״ך",
  history: "היסטוריה",
  civics: "אזרחות",
  english: "אנגלית",
  arabic: "ערבית",
  physics: "פיזיקה",
  chemistry: "כימיה",
  biology: "ביולוגיה",
  science: "מדעים",
  computers: "מדעי המחשב",
  electronics: "אלקטרוניקה",
  mechanics: "הנדסת מכונות",
  geography: "גאוגרפיה",
  pe: "חינוך גופני",
  arts: "אמנות",
  other: "אחר",
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
