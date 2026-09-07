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

export function formatGrade(grade: number): string {
  return `ציון ${grade}`;
}
