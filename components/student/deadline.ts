import { SCHOOL_TIME_ZONE, schoolDayNumber } from "@/lib/schoolClock";
import type { StatusTone } from "./StatusBlock";

/**
 * How a submission deadline reads to a student. Both places one appears — the
 * status block on a feed card and the live countdown on the screen that opens a
 * quiz — phrase `available_until` through here, so "due today" says the same
 * thing in both and neither invents its own wording.
 *
 * Calendar questions ("is that today?") are answered in the school's own zone,
 * the way the teacher side already answers them: a window closing at 23:30
 * tonight is "היום" for the student sitting in that classroom, whatever the
 * server's clock or the device's zone say. Duration questions ("how long do I
 * have?") are plain milliseconds — a zone cannot change how much time is left.
 *
 * Hebrew counts one, two and many differently, so the durations are worded
 * through `hebDays`/`hebHours`/`hebMinutes` rather than by gluing a number onto
 * a plural noun ("2 ימים" is wrong where "יומיים" is right).
 */

/** How pressing a deadline is — drives the status block's colour, not its text. */
export type DeadlineUrgency = "calm" | "soon" | "urgent" | "passed";

/**
 * Deadline pressure in the status block's palette — one mapping, so a card and
 * a ticking countdown never disagree about whether a deadline is worth a
 * colour: plain while there is time, amber inside a day, red inside hours.
 */
export const URGENCY_TONE: Record<DeadlineUrgency, StatusTone> = {
  calm: "neutral",
  soon: "warning",
  urgent: "danger",
  passed: "danger",
};

/** Under this much time left, a deadline is urgent however far off the date is. */
const URGENT_MS = 6 * 60 * 60 * 1000;

export interface DeadlineView {
  /** The lead line: "נותרו 43 דקות" / "היום" / "מחר" / "בעוד 4 ימים". */
  lead: string;
  /**
   * The calendar framing on its own — "היום" / "מחר" / "בעוד 4 ימים" — kept
   * apart from `lead` because a live countdown spends the lead on the ticking
   * figure and still has to say *which day* 18:00 means.
   */
  day: string;
  /** The instant itself, school time — "עד 18:00" or "14.3 בשעה 18:00". */
  exact: string;
  /**
   * Day and instant in one phrase, with nothing repeated: "היום · עד 18:00" for
   * the near dates whose instant alone would be ambiguous, and the dated
   * instant on its own for the ones where it isn't. For callers whose headline
   * is the countdown rather than the day.
   */
  when: string;
  urgency: DeadlineUrgency;
}

/** "18:00", school time. */
export function formatDeadlineClock(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: SCHOOL_TIME_ZONE,
  }).format(new Date(iso));
}

/** "14.3", school time. Any date a student reads, not deadlines alone. */
export function formatSchoolDate(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric",
    timeZone: SCHOOL_TIME_ZONE,
  }).format(new Date(iso));
}

/**
 * Join two duration parts with the conjunction Hebrew actually takes: "ו" binds
 * straight onto a word ("יומיים ושעתיים") but wants a hyphen before a numeral
 * ("יומיים ו-3 שעות").
 */
function joinParts(first: string, second: string): string {
  return /^\d/.test(second) ? `${first} ו-${second}` : `${first} ו${second}`;
}

function hebDays(days: number): string {
  if (days === 1) return "יום";
  if (days === 2) return "יומיים";
  return `${days} ימים`;
}

function hebHours(hours: number): string {
  if (hours === 1) return "שעה";
  if (hours === 2) return "שעתיים";
  return `${hours} שעות`;
}

function hebMinutes(minutes: number): string {
  if (minutes === 1) return "דקה";
  if (minutes === 2) return "שתי דקות";
  return `${minutes} דקות`;
}

/**
 * How much time is left, worded. Coarser the further out it is, because that is
 * how the answer is used: seconds matter in the last minutes before a window
 * closes and are noise a week ahead. Returns `null` once nothing is left — the
 * caller says "המועד עבר" rather than counting down through zero.
 */
export function formatRemaining(msLeft: number): string | null {
  if (msLeft <= 0) return null;
  const total = Math.floor(msLeft / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) {
    return hours > 0 ? joinParts(hebDays(days), hebHours(hours)) : hebDays(days);
  }
  if (hours > 0) {
    return minutes > 0 ? joinParts(hebHours(hours), hebMinutes(minutes)) : hebHours(hours);
  }
  // The last hour is the one a student watches tick, so it ticks: mm:ss.
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * How often a live countdown has to repaint to stay honest at its own
 * granularity: every second inside the last hour (it shows mm:ss), every half
 * minute inside the day, every minute beyond that.
 */
export function countdownTickMs(msLeft: number): number {
  if (msLeft < 60 * 60 * 1000) return 1000;
  if (msLeft < 24 * 60 * 60 * 1000) return 30_000;
  return 60_000;
}

/**
 * The static reading of a deadline, for a card that is not ticking: the human
 * distance to it plus the instant itself, and how urgent that is.
 *
 * The distance is stated in calendar days once it is more than an hour out
 * ("מחר" is what a student plans around, not "בעוד 19 שעות"), and switches to
 * the remaining-time wording inside the last hour, where the date has stopped
 * being the useful part.
 */
export function deadlineView(iso: string, now: Date = new Date()): DeadlineView {
  const due = new Date(iso);
  const msLeft = due.getTime() - now.getTime();
  const clock = formatDeadlineClock(iso);
  const date = formatSchoolDate(iso);
  const days = schoolDayNumber(due) - schoolDayNumber(now);
  const day = days <= 0 ? "היום" : days === 1 ? "מחר" : `בעוד ${hebDays(days)}`;

  if (msLeft <= 0) {
    return {
      lead: "המועד עבר",
      day: `${date} בשעה ${clock}`,
      exact: `${date} בשעה ${clock}`,
      when: `${date} בשעה ${clock}`,
      urgency: "passed",
    };
  }

  const urgency: DeadlineUrgency =
    msLeft < URGENT_MS ? "urgent" : days <= 1 ? "soon" : "calm";
  // Past tomorrow the date has to appear somewhere, so it appears in the
  // instant; today and tomorrow are already named, and repeating the date
  // there would only add digits to read.
  const exact = days <= 1 ? `עד ${clock}` : `${date} בשעה ${clock}`;
  const when = days <= 1 ? `${day} · ${exact}` : exact;

  if (msLeft < 60 * 60 * 1000) {
    return { lead: `נותרו ${formatRemaining(msLeft)}`, day, exact, when, urgency };
  }
  return { lead: day, day, exact, when, urgency };
}
