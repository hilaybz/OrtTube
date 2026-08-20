/**
 * How a score is presented to a student: a grade out of 100 (the school
 * convention here), never a raw percentage. Nothing about the stored data
 * changes — attempts still record `num_correct` / `num_questions`, and the RPCs
 * still return exactly that; this module only decides how that ratio is worded
 * on the feed, the results screen and the review.
 */

export const GRADE_MAX = 100;

/**
 * The grade for a completed attempt, or `null` when there is nothing to grade
 * (no questions were recorded) — callers show a plain "completed" label in that
 * case rather than a meaningless 0.
 */
export function gradeOf(
  correct: number | null | undefined,
  total: number | null | undefined
): number | null {
  if (total == null || total <= 0) return null;
  return Math.round(((correct ?? 0) / total) * GRADE_MAX);
}

/** "ציון 87" — the number plus the word that pins the scale it is on. */
export function formatGrade(grade: number): string {
  return `ציון ${grade}`;
}
