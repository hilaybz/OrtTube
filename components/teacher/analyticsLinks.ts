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

export function classQuizAnalyticsHref(classId: string, quizId: string): string {
  return `${quizAnalyticsHref(quizId)}&class=${encodeURIComponent(classId)}`;
}
