import type { ClassStats } from "@/lib/analytics";
import type { ClassRow, AssignedQuiz } from "@/lib/classes";
import { allocationState } from "@/lib/allocationState";

/**
 * Pure reductions behind the teacher overview. Everything here takes already
 * fetched rows and a clock, so the page stays a thin assembly layer and the
 * arithmetic is unit-testable.
 *
 * Lifecycle questions ("is this quiz still open?", "did it close recently?")
 * are answered by `allocationState` rather than by re-deriving dates here —
 * that predicate mirrors the SQL `_allocation_is_live` and is the one place
 * window semantics live.
 */

/** The school's wall clock. Times arrive as UTC instants; every date the
 *  teacher reads — and the time-of-day greeting — must be Israeli local time,
 *  not the server's. */
export const SCHOOL_TIME_ZONE = "Asia/Jerusalem";

/**
 * How far back "recently finished" reaches. A week is one school cycle: long
 * enough that a quiz that closed on Friday is still on the teacher's homepage
 * on Monday, short enough that the row stays a shortlist rather than an archive.
 */
export const RECENTLY_FINISHED_LOOKBACK_DAYS = 7;

/** A class paired with the quizzes currently assigned to it. */
export interface ClassAssignments {
  klass: ClassRow;
  quizzes: readonly AssignedQuiz[];
}

/**
 * A per-class summary reduced from the raw `class_stats` payload, ready for a
 * class card: roster size, count of currently-assigned (non-deleted) quizzes,
 * and total completions. Average grade is deliberately absent — a
 * cross-quiz mean tells a teacher nothing actionable, and per-quiz averages are
 * one click away in analytics.
 */
export interface ClassSummary {
  id: string;
  name: string;
  memberCount: number;
  assignedCount: number;
  completions: number;
}

/** Cross-class totals for the KPI row. */
export interface OverviewTotals {
  classCount: number;
  studentCount: number;
  /** Distinct quizzes with at least one class inside its window right now. */
  openQuizzes: number;
  /** Distinct quizzes that have run and have no class still open on them. */
  finishedQuizzes: number;
}

/**
 * Reduce one class's `class_stats` (paired with its roster row for the name)
 * into a `ClassSummary`. Only currently-assigned quizzes (`deleted === false`)
 * count toward the assigned/completion figures. Member count prefers the stats
 * denominator and falls back to zero when stats are unavailable.
 */
export function summarizeClass(
  klass: ClassRow,
  stats: ClassStats | null
): ClassSummary {
  const active = stats?.quizzes.filter((q) => !q.deleted) ?? [];
  return {
    id: klass.id,
    name: klass.name,
    memberCount: stats?.current_member_count ?? 0,
    assignedCount: active.length,
    completions: active.reduce((sum, q) => sum + q.completion_count, 0),
  };
}

/**
 * Count DISTINCT quizzes by lifecycle, not allocations: a quiz assigned to
 * three classes is one quiz on the teacher's mind. "Open" is any quiz at least
 * one class can answer right now; "finished" is a quiz that has closed
 * everywhere — so a quiz mid-rollout (closed in one class, still live in
 * another) counts as open only, never in both tiles.
 */
export function countQuizStates(
  assignments: readonly ClassAssignments[],
  now: Date = new Date()
): Pick<OverviewTotals, "openQuizzes" | "finishedQuizzes"> {
  const byQuiz = new Map<string, { openable: boolean; closed: boolean }>();
  for (const { quizzes } of assignments) {
    for (const quiz of quizzes) {
      const state = allocationState(quiz, now);
      const entry = byQuiz.get(quiz.quiz_id) ?? { openable: false, closed: false };
      if (state === "live" || state === "scheduled") entry.openable = true;
      if (state === "done") entry.closed = true;
      byQuiz.set(quiz.quiz_id, entry);
    }
  }
  let openQuizzes = 0;
  let finishedQuizzes = 0;
  for (const { openable, closed } of byQuiz.values()) {
    if (openable) openQuizzes += 1;
    else if (closed) finishedQuizzes += 1;
  }
  return { openQuizzes, finishedQuizzes };
}

/** Aggregate per-class summaries and quiz-state counts into the KPI totals. */
export function totalsFromSummaries(
  summaries: readonly ClassSummary[],
  quizStates: Pick<OverviewTotals, "openQuizzes" | "finishedQuizzes">
): OverviewTotals {
  return {
    classCount: summaries.length,
    studentCount: summaries.reduce((sum, s) => sum + s.memberCount, 0),
    ...quizStates,
  };
}

/**
 * One quiz that closed for one class inside the lookback window. Kept per
 * (class, quiz) rather than per quiz: the class is the thing the teacher wants
 * to look at next, and the same quiz can close on different days in different
 * classes.
 */
export interface RecentlyFinishedQuiz {
  /** Stable React key — a quiz appears once per class. */
  key: string;
  quizId: string;
  classId: string;
  className: string;
  title: string | null;
  videoTitle: string | null;
  youtubeVideoId: string;
  questionCount: number;
  /** When the window closed — always non-null for a `done` allocation. */
  closedAt: string;
}

/**
 * The allocations whose window closed within the lookback, newest first.
 * An allocation is only `done` when it has an `available_until` in the past, so
 * `closedAt` is always present; the guard is a type narrowing, not a fallback.
 */
export function recentlyFinishedQuizzes(
  assignments: readonly ClassAssignments[],
  now: Date = new Date()
): RecentlyFinishedQuiz[] {
  const floor =
    now.getTime() - RECENTLY_FINISHED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const finished: RecentlyFinishedQuiz[] = [];
  for (const { klass, quizzes } of assignments) {
    for (const quiz of quizzes) {
      if (allocationState(quiz, now) !== "done") continue;
      const closedAt = quiz.available_until;
      if (!closedAt) continue;
      if (new Date(closedAt).getTime() < floor) continue;
      finished.push({
        key: `${klass.id}:${quiz.quiz_id}`,
        quizId: quiz.quiz_id,
        classId: klass.id,
        className: klass.name,
        title: quiz.title,
        videoTitle: quiz.video_title,
        youtubeVideoId: quiz.youtube_video_id,
        questionCount: quiz.question_count,
        closedAt,
      });
    }
  }
  return finished.sort(
    (a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime()
  );
}

/** The heading for a quiz card: the teacher's own title, else the video's. */
export function quizHeading(quiz: {
  title: string | null;
  videoTitle: string | null;
}): string {
  return quiz.title ?? quiz.videoTitle ?? "חידון";
}

/** A short school-local day-and-month, e.g. `26.8`. */
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric",
    timeZone: SCHOOL_TIME_ZONE,
  }).format(new Date(iso));
}

/**
 * The greeting for a moment, keyed to the school's local time of day rather
 * than the server's clock — a Tel Aviv morning is the middle of the night in
 * UTC, and greeting a teacher "ערב טוב" at 09:00 is worse than not greeting
 * them. The small hours get a plain "שלום": every Hebrew night greeting is a
 * farewell.
 */
export function greetingFor(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: SCHOOL_TIME_ZONE,
    }).format(now)
  );
  // The small hours are tested FIRST: they wrap past midnight, so an
  // ascending chain that starts at 05:00 would greet 01:00 as noon.
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
