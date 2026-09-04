/**
 * Copy for the analytics cutoff (`quizzes.content_updated_at`).
 *
 * Editing a quiz's questions or answers moves that timestamp, and every
 * teacher-facing analytic then counts only attempts started at or after it. Two
 * audiences need words for that and must not drift apart: the editor, warning
 * before the edit, and the analytics screens, explaining a report that suddenly
 * reads thin. So the sentences live here, once.
 *
 * The copy never says "deleted", because nothing is: the rows survive, students
 * keep seeing their own results, and the figures simply stop counting them.
 */
import { formatDate } from "./datetime";

/** Hebrew count phrase for attempts currently feeding analytics. */
function attemptsPhrase(count: number): string {
  return count === 1 ? "ניסיון אחד" : `${count} ניסיונות`;
}

/** The editor's standing notice while a quiz with collected results is open. */
export function analyticsAtRiskNotice(count: number): string {
  return `לחידון הזה נאספו ${attemptsPhrase(count)}. כל שינוי בשאלות, בתשובות או בנקודות העצירה יפסיק לספור אותם בכל הניתוחים.`;
}

/** What actually happens, spelled out — including the retake trap. */
export const ANALYTICS_RESET_CONSEQUENCE =
  "הנתונים לא נמחקים, אך הם יפסיקו להופיע בדוחות: תלמידים שכבר סיימו יופיעו כמי שלא התחילו, ואם מספר הניסיונות בכיתה מוגבל הם לא יוכלו לענות שוב.";

/**
 * The cutoff date, or `null` for a missing or unparseable timestamp.
 *
 * Delegates the formatting rather than doing its own: this used to call
 * `toLocaleDateString` with no `timeZone`, which renders one day on Vercel
 * (TZ=UTC) and another in an Israeli browser — a hydration mismatch, and the
 * wrong date either way for a late-evening edit.
 */
export function formatCutoffDate(timestamp: string | null): string | null {
  if (!timestamp) return null;
  if (Number.isNaN(new Date(timestamp).getTime())) return null;
  return formatDate(timestamp);
}

/**
 * Explains a report that lost data to an edit, so thin numbers read as a cutoff
 * rather than as a bug.
 *
 * Keyed on `excludedCount`, NOT on the cutoff alone: authoring a quiz's first
 * question already stamps `content_updated_at` (the question set changed), so
 * nearly every quiz has one, and a note driven by that would appear on quizzes
 * that never lost a single result. `null` when nothing is being hidden — the
 * common case, where the screen should say nothing at all.
 */
export function analyticsCutoffNote(
  contentUpdatedAt: string | null,
  excludedCount: number
): string | null {
  if (excludedCount <= 0) return null;
  const date = formatCutoffDate(contentUpdatedAt);
  const since = date ? ` (${date})` : "";
  return `${attemptsPhrase(excludedCount)} נפתחו לפני העריכה האחרונה של החידון${since} ואינם נספרים בנתונים כאן.`;
}
