import { formatDate, formatTime, schoolDayNumber } from "@/lib/datetime";
import type { StatusTone } from "./StatusBlock";

/**
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

export type DeadlineUrgency = "calm" | "soon" | "urgent" | "passed";

export const URGENCY_TONE: Record<DeadlineUrgency, StatusTone> = {
  calm: "neutral",
  soon: "warning",
  urgent: "danger",
  passed: "danger",
};

const URGENT_MS = 6 * 60 * 60 * 1000;

export interface DeadlineView {
  lead: string;
  day: string;
  exact: string;
  when: string;
  urgency: DeadlineUrgency;
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
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function countdownTickMs(msLeft: number): number {
  if (msLeft < 60 * 60 * 1000) return 1000;
  if (msLeft < 24 * 60 * 60 * 1000) return 30_000;
  return 60_000;
}

export function deadlineView(iso: string, now: Date = new Date()): DeadlineView {
  const due = new Date(iso);
  const msLeft = due.getTime() - now.getTime();
  const clock = formatTime(iso);
  const date = formatDate(iso);
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
  const exact = days <= 1 ? `עד ${clock}` : `${date} בשעה ${clock}`;
  const when = days <= 1 ? `${day} · ${exact}` : exact;

  if (msLeft < 60 * 60 * 1000) {
    return { lead: `נותרו ${formatRemaining(msLeft)}`, day, exact, when, urgency };
  }
  return { lead: day, day, exact, when, urgency };
}
