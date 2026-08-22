import { allocationState, type AllocationState } from "@/lib/allocationState";
import { formatDateTime } from "@/lib/datetime";
import type { IconName } from "@/components/ui/Icon";

/**
 * Scheduling-window display helpers, shared by the two places an allocation's
 * state/window get rendered as a row — the editor's `AllocationsSection` and
 * the class page's `AssignedQuizzesSection` — plus the datetime<->ISO
 * conversion the assign/edit forms (`BulkAssignModal`, the allocations list's
 * per-row edit modal) need. One copy of each so the two UIs can't drift.
 *
 * Two levels of presentation live here. `STATE_LABEL`/`STATE_VARIANT` are the
 * bare state chip (a noun: "פעיל"). `allocationStatus` is the richer treatment
 * the class page uses: one chip that states what happens next in words a
 * teacher reads without decoding ("נסגר בעוד 3 ימים", "הסתיים אתמול"), so a
 * row never needs a state noun *and* a raw date range next to each other.
 */

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
 * "D.M HH:mm" for a window bound, in Israeli time.
 *
 * Pinned rather than local: this renders on the server (UTC) and again on the
 * client, and the two must agree or React discards the tree with a hydration
 * error. See `lib/datetime.ts`.
 */
export function formatWindowPart(iso: string | null): string {
  if (!iso) return "";
  return formatDateTime(iso);
}

/** ISO timestamp (or null) → datetime-local input value ("" when null/invalid). */
export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local input value ("" → null) → ISO timestamp for the API. */
export function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ── Human-readable status ────────────────────────────────────────────────────

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

/** "26.8", or "26.8.2025" when the date falls outside the current year. */
export function formatShortDate(date: Date, now: Date = new Date()): string {
  const day = `${date.getDate()}.${date.getMonth() + 1}`;
  return date.getFullYear() === now.getFullYear()
    ? day
    : `${day}.${date.getFullYear()}`;
}

/** "14:30", local time. */
function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Whole calendar days from `now`'s day to `date`'s day, in local time. */
function calendarDayDiff(date: Date, now: Date): number {
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(date) - startOf(now)) / DAY);
}

/**
 * A future instant as a phrase that completes a verb: "נסגר " + this reads
 * "נסגר בעוד 3 ימים". Near instants are relative (that's what a teacher acts
 * on); anything a week out is an absolute date, because "בעוד 23 ימים" is
 * harder to place on a calendar than "26.8".
 */
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
  return `ב־${formatShortDate(date, now)}`;
}

/** The past-facing twin: "הסתיים " + this reads "הסתיים אתמול". */
export function formatSinceThen(date: Date, now: Date = new Date()): string {
  const days = calendarDayDiff(date, now);
  if (days >= 0) return `היום בשעה ${formatTime(date)}`;
  if (days === -1) return "אתמול";
  if (days > -7) return `לפני ${-days} ימים`;
  return `ב־${formatShortDate(date, now)}`;
}

/** What an allocation row shows instead of a state noun plus a raw date range. */
export interface AllocationStatus {
  state: AllocationState;
  /** The whole story in one phrase — reads on its own, outside any section. */
  label: string;
  /** Chip colour: green while a quiz is open, neutral once it has ended. */
  variant: "success" | "warning" | "gray";
  icon: IconName;
}

/**
 * The one status treatment for an allocation, in every state. Colour follows
 * availability rather than urgency — open is green (students can reach it),
 * ended is neutral gray (settled and closed) — so a row's chip always matches
 * the section it sits in.
 *
 * Takes the same structural shape `allocationState` does, so it serves both an
 * `AssignedQuiz` (class → quizzes) and a `QuizAllocation` (quiz → classes).
 */
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
