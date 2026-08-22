/**
 * The school's wall clock, shared by both roles. Times arrive as UTC instants,
 * but every date a user reads — and every "is that today?" question — has to be
 * answered in the school's own zone rather than the server's.
 *
 * A leaf module with no imports, so client components on either side can use it
 * without dragging anything else into their bundle.
 */

export const SCHOOL_TIME_ZONE = "Asia/Jerusalem";

/**
 * A date's school-local calendar day as a day count, so two instants can be
 * compared by the day the user lived through rather than by elapsed hours.
 * Formatting to an ISO date in the school zone and re-reading it as UTC is the
 * standard way to do this without a timezone library.
 */
export function schoolDayNumber(date: Date): number {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: SCHOOL_TIME_ZONE,
  }).format(date);
  return Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
}

/**
 * The greeting for a moment, keyed to the school's local time of day: a Tel Aviv
 * morning is the middle of the night in UTC. The small hours get a plain "שלום"
 * — every Hebrew night greeting is a farewell.
 */
export function greetingFor(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: SCHOOL_TIME_ZONE,
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

/** The name to greet by: the first word of a display name, or nothing. */
export function firstName(displayName: string | null): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** A long school-local weekday and date, e.g. `יום חמישי, 20 באוגוסט`. */
export function formatToday(now: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: SCHOOL_TIME_ZONE,
  }).format(now);
}
