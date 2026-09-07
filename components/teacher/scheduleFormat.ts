import { allocationState, type AllocationState } from "@/lib/allocationState";
import { formatDate, formatDateTime } from "@/lib/datetime";
import type { IconName } from "@/components/ui/Icon";

export const STATE_LABEL: Record<AllocationState, string> = {
  draft: "מוסתר",
  scheduled: "מתוזמן",
  live: "פעיל",
  done: "הסתיים",
};

/** Same colour per state as `allocationStatus`, so one allocation cannot read
 *  as two different things depending on which screen shows it. */
export const STATE_VARIANT: Record<AllocationState, "warning" | "gray" | "success"> = {
  draft: "gray",
  scheduled: "warning",
  live: "success",
  done: "gray",
};

/**
 * Pinned rather than local: this renders on the server (UTC) and again on the
 * client, and the two must agree or React discards the tree with a hydration
 * error. See `lib/datetime.ts`.
 */
export function formatWindowPart(iso: string | null): string {
  if (!iso) return "";
  return formatDateTime(iso);
}

export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Hebrew counts, with the dual form the language actually uses — "בעוד
 * שעתיים", not "בעוד 2 שעות".
 */
function counted(n: number, one: string, two: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  return `${n} ${many}`;
}

export function formatShortDate(date: Date): string {
  return formatDate(date);
}

function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function calendarDayDiff(date: Date, now: Date): number {
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(date) - startOf(now)) / DAY);
}

export function formatUntilThen(date: Date, now: Date = new Date()): string {
  const ms = date.getTime() - now.getTime();
  if (ms <= MINUTE) return "עוד רגע";
  if (ms < HOUR) {
    return `בעוד ${counted(Math.round(ms / MINUTE), "דקה", "שתי דקות", "דקות")}`;
  }
  if (ms < 6 * HOUR) {
    return `בעוד ${counted(Math.round(ms / HOUR), "שעה", "שעתיים", "שעות")}`;
  }
  const days = calendarDayDiff(date, now);
  if (days <= 0) return `היום בשעה ${formatTime(date)}`;
  if (days === 1) return "מחר";
  if (days < 7) return `בעוד ${days} ימים`;
  return `ב־${formatShortDate(date)}`;
}

export function formatSinceThen(date: Date, now: Date = new Date()): string {
  const days = calendarDayDiff(date, now);
  if (days >= 0) return `היום בשעה ${formatTime(date)}`;
  if (days === -1) return "אתמול";
  if (days > -7) return `לפני ${-days} ימים`;
  return `ב־${formatShortDate(date)}`;
}

export interface AllocationStatus {
  state: AllocationState;
  label: string;
  variant: "success" | "warning" | "gray";
  icon: IconName;
}

export function allocationStatus(
  allocation: {
    published: boolean;
    available_from: string | null;
    available_until: string | null;
  },
  now: Date = new Date()
): AllocationStatus {
  const state = allocationState(allocation, now);
  const from = allocation.available_from ? new Date(allocation.available_from) : null;
  const until = allocation.available_until ? new Date(allocation.available_until) : null;

  switch (state) {
    case "live":
      return {
        state,
        variant: "success",
        icon: "timer",
        label: until ? `נסגר ${formatUntilThen(until, now)}` : "פעיל · ללא מועד סיום",
      };
    case "scheduled":
      return {
        state,
        variant: "warning",
        icon: "calendar",
        label: from ? `נפתח ${formatUntilThen(from, now)}` : "מתוזמן",
      };
    case "done":
      return {
        state,
        variant: "gray",
        icon: "checkCircle",
        label: until ? `הסתיים ${formatSinceThen(until, now)}` : "הסתיים",
      };
    case "draft":
      return {
        state,
        variant: "gray",
        icon: "eyeOff",
        label: "מוסתר מתלמידים",
      };
  }
}
