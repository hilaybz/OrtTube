import { formatDate } from "./datetime";

function attemptsPhrase(count: number): string {
  return count === 1 ? "ניסיון אחד" : `${count} ניסיונות`;
}

export function analyticsAtRiskNotice(count: number): string {
  return `לחידון הזה נאספו ${attemptsPhrase(count)}. כל שינוי בשאלות, בתשובות או בנקודות העצירה יפסיק לספור אותם בכל הניתוחים.`;
}

/**
 * What actually happens, spelled out — including the retake trap. A student is
 * blocked only once their completed attempts reach the class's allowance, which
 * the cutoff does not lower, so the copy names exhaustion as the condition and
 * raising the allowance as the remedy.
 */
export const ANALYTICS_RESET_CONSEQUENCE =
  "הנתונים לא נמחקים, אך הם יפסיקו להופיע בדוחות: תלמידים שכבר סיימו יופיעו כמי שלא התחילו, ותלמיד שניצל את כל הניסיונות שהוקצו לכיתה לא יוכל לענות על הגרסה החדשה — אלא אם תגדילו את מספר הניסיונות המותר.";

/**
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
