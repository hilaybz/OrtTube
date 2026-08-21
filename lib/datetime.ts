/**
 * Date/time formatting for the UI.
 *
 * Everything here pins an explicit timezone and locale, and that is the whole
 * point. These strings are produced during server rendering AND again when React
 * hydrates in the browser; if the two disagree by so much as a character, React
 * throws a hydration error (#418) and discards the server tree.
 *
 * They *did* disagree. Vercel's functions run with TZ=UTC while the audience is
 * in Israel, so `toLocaleString("he-IL", …)` rendered "20.8, 15:19" on the
 * server and "20.8, 18:19" in the browser — a guaranteed mismatch on every row
 * carrying a date, not an intermittent one.
 *
 * Pinning to Asia/Jerusalem rather than deferring the render to the client is
 * deliberate: this is a schools product with one timezone, so the fixed zone is
 * also the CORRECT time for every viewer, and there is no blank flash while the
 * client catches up. A user abroad sees Israeli school time, which is what a
 * deadline means here.
 */

export const APP_TIME_ZONE = "Asia/Jerusalem";
export const APP_LOCALE = "he-IL";

/** "D.M, HH:mm" — a scheduling-window bound. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(APP_LOCALE, {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}

/** "D.M" — a date with no time of day. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(APP_LOCALE, {
    day: "numeric",
    month: "numeric",
    timeZone: APP_TIME_ZONE,
  });
}

/** "HH:mm" — a time with no date. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(APP_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}

/**
 * Whether `iso` falls on today's date **in Israel**.
 *
 * `Date.toDateString()` would answer this in the runtime's own zone, which puts
 * the server three hours behind the viewer and makes "today" disagree for a
 * three-hour window every single day — the same hydration mismatch in a form
 * that is easy to miss, because it only shows up late in the evening.
 */
export function isToday(iso: string, now: Date = new Date()): boolean {
  const day = (d: Date) =>
    d.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE }); // YYYY-MM-DD
  return day(new Date(iso)) === day(now);
}
