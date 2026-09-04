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
 * Roster "joined" / invite dates.
 *
 * Re-exported rather than defined: this module used to carry its OWN
 * `formatDate` built from UTC parts, so `import { formatDate } from "./labels"`
 * and `from "@/lib/datetime"` gave different answers for the same timestamp —
 * a day apart for anything between 21:00 and midnight UTC. One helper now.
 */
export { formatDate } from "@/lib/datetime";
