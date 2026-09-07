/**
 * Everything here pins an explicit timezone and locale, and that is the whole
 * point. These strings are produced during server rendering AND again when React
 * hydrates in the browser; if the two disagree by so much as a character, React
 * throws a hydration error (#418) and discards the server tree.
 *
 * Pinning to Asia/Jerusalem rather than deferring the render to the client is
 * deliberate: this is a schools product with one timezone, so the fixed zone is
 * also the CORRECT time for every viewer, and there is no blank flash while the
 * client catches up. A user abroad sees Israeli school time, which is what a
 * deadline means here.
 */

export const APP_TIME_ZONE = "Asia/Jerusalem";
export const APP_LOCALE = "he-IL";

/**
 * The locale is `en-GB` rather than `APP_LOCALE` purely for its separator and
 * ordering: `he-IL` numeric renders `5.8` with dots and no year, and a
 * zero-padded slashed date is what was asked for. The digits are the same either
 * way — Hebrew uses Western numerals — so nothing here is language-specific.
 */
const DATE_LOCALE = "en-GB";
const DATE_PARTS = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
} as const;

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

export function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString(DATE_LOCALE, {
    ...DATE_PARTS,
    timeZone: APP_TIME_ZONE,
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(APP_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}

export function formatToday(now: Date): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: APP_TIME_ZONE,
  }).format(now);
}

/**
 * A date's calendar day as a day count, so two instants can be compared by the
 * day the user lived through rather than by elapsed hours. Formatting to an ISO
 * date in the pinned zone and re-reading it as UTC does this without a timezone
 * library.
 */
export function schoolDayNumber(date: Date): number {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: APP_TIME_ZONE,
  }).format(date);
  return Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
}

export function greetingFor(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: APP_TIME_ZONE,
    }).format(now)
  );
  // The small hours are tested FIRST: they wrap past midnight, so an ascending
  // chain that starts at 05:00 would greet 01:00 as noon.
  if (hour < 5) return "שלום";
  if (hour < 12) return "בוקר טוב";
  if (hour < 17) return "צהריים טובים";
  if (hour < 22) return "ערב טוב";
  return "שלום";
}

export function firstName(displayName: string | null): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first ? first : null;
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
