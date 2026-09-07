/**
 * Analytics itself is a search-driven hub (`/dashboard/analytics`) that renders
 * whichever entity the URL selects, so a link out of the class screens is a
 * scope plus an id rather than a nested route. Every such destination is built
 * here, and only here: the class page owns none of those routes, so if the hub
 * changes its query contract this file is the single edit.
 */

export function studentAnalyticsHref(studentId: string): string {
  return `/dashboard/analytics?scope=student&id=${encodeURIComponent(studentId)}`;
}

export function classAnalyticsHref(classId: string): string {
  return `/dashboard/analytics?scope=class&id=${encodeURIComponent(classId)}`;
}

export function quizAnalyticsHref(quizId: string): string {
  return `/dashboard/analytics?scope=quiz&id=${encodeURIComponent(quizId)}`;
}

/**
 * The entity a reader drilled INTO this view from, so back returns there rather
 * than dropping the class filter.
 *
 * These are not `BACK_TARGETS` keys: that registry holds places, never a row
 * with an id, so an id-bearing destination is resolved by the page instead. A
 * class needs only the marker — its id is already in the href as `&class=` —
 * while a student's id has no other reason to be in the URL and travels with it.
 */
export type QuizViewOrigin =
  | { from: typeof CLASS_ORIGIN }
  | { from: typeof STUDENT_ORIGIN; studentId: string };

/** Back belongs at the class named by `&class=`. */
export const CLASS_ORIGIN = "class";
/** Back belongs at the student named by `&student=`. */
export const STUDENT_ORIGIN = "student";

/**
 * That quiz narrowed to one class. `origin` is opt-in and omitted by every
 * caller whose reader did not drill in from an entity — the class dropdown, the
 * quiz's own per-class table — for whom back correctly stays on the quiz.
 */
export function classQuizAnalyticsHref(
  classId: string,
  quizId: string,
  origin?: QuizViewOrigin
): string {
  const href = `${quizAnalyticsHref(quizId)}&class=${encodeURIComponent(classId)}`;
  if (!origin) return href;
  if (origin.from === STUDENT_ORIGIN) {
    return `${href}&from=${STUDENT_ORIGIN}&student=${encodeURIComponent(origin.studentId)}`;
  }
  return `${href}&from=${CLASS_ORIGIN}`;
}
