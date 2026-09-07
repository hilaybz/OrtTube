/**
 * Where the class screens send a teacher who wants numbers.
 *
 * Analytics itself is a search-driven hub (`/dashboard/analytics`) that renders
 * whichever entity the URL selects, so a link out of the class screens is a
 * scope plus an id rather than a nested route. Every such destination is built
 * here, and only here: the class page owns none of those routes, so if the hub
 * changes its query contract this file is the single edit.
 */

/** The hub with one student selected — their cross-class analytics view. */
export function studentAnalyticsHref(studentId: string): string {
  return `/dashboard/analytics?scope=student&id=${encodeURIComponent(studentId)}`;
}

/** The hub with this class selected. */
export function classAnalyticsHref(classId: string): string {
  return `/dashboard/analytics?scope=class&id=${encodeURIComponent(classId)}`;
}

/** The hub with one quiz selected — its numbers across every class it runs in. */
export function quizAnalyticsHref(quizId: string): string {
  return `/dashboard/analytics?scope=quiz&id=${encodeURIComponent(quizId)}`;
}

/**
 * That same quiz narrowed to one class — the per-(class, quiz) breakdown.
 *
 * A filter on the quiz view rather than a route of its own, so a teacher
 * comparing classes stays on the quiz and swaps the class rather than
 * navigating back out to each one in turn.
 */
export function classQuizAnalyticsHref(classId: string, quizId: string): string {
  return `${quizAnalyticsHref(quizId)}&class=${encodeURIComponent(classId)}`;
}
