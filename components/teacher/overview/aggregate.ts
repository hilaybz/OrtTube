import type { ClassStats } from "@/lib/analytics";
import type { ClassRow, AssignedQuiz } from "@/lib/classes";
import { allocationState, type AllocationState } from "@/lib/allocationState";
import { SCHOOL_TIME_ZONE, schoolDayNumber } from "@/lib/schoolClock";

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
 * A per-class summary ready for a class card: roster size and the class's own
 * lifecycle split — how many quizzes it can answer, how many are behind it.
 * Those two are the class-scoped reading of the same question the KPI row asks
 * across all classes, so a teacher can tell at a glance which class is mid-work
 * and which is idle.
 *
 * Neither an assigned-quiz total nor a completion count is here: a raw
 * "3 quizzes" says nothing about whether any of them is running, and totals are
 * one click away in analytics. Average grade is absent for the same reason — a
 * cross-quiz mean flattens exactly the differences analytics exists to show.
 */
export interface ClassSummary {
  id: string;
  name: string;
  memberCount: number;
  /** Quizzes this class can answer now, plus those scheduled to open. */
  activeQuizzes: number;
  /** Quizzes whose window has already closed for this class. */
  finishedQuizzes: number;
}

/**
 * The one definition of "active" behind both the KPI row and the class cards:
 * a window the class is inside right now, or one that will open. Drafts are
 * neither active nor finished — nobody has been given them yet.
 *
 * Both readings go through this predicate so a class card and the tile above it
 * can never disagree about the same allocation.
 */
function isActive(state: AllocationState): boolean {
  return state === "live" || state === "scheduled";
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
 * Reduce one class into a `ClassSummary`: the roster size comes from
 * `class_stats`, the lifecycle split from that class's own allocation rows.
 *
 * The two sources fail independently and so degrade independently — a class
 * whose stats could not be read still shows a truthful quiz split, and a class
 * whose allocations could not be read still shows its roster.
 *
 * Each quiz has exactly one allocation per class, so counting allocation states
 * here is already a per-quiz count; no de-duplication is needed (unlike the
 * cross-class KPI row, where one quiz spans several classes).
 */
export function summarizeClass(
  klass: ClassRow,
  stats: ClassStats | null,
  quizzes: readonly AssignedQuiz[],
  now: Date = new Date()
): ClassSummary {
  let activeQuizzes = 0;
  let finishedQuizzes = 0;
  for (const quiz of quizzes) {
    const state = allocationState(quiz, now);
    if (isActive(state)) activeQuizzes += 1;
    else if (state === "done") finishedQuizzes += 1;
  }
  return {
    id: klass.id,
    name: klass.name,
    memberCount: stats?.current_member_count ?? 0,
    activeQuizzes,
    finishedQuizzes,
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
      if (isActive(state)) entry.openable = true;
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
 * How a closing time reads on a finished-quiz card. Two parts rather than one
 * sentence: a phrase the teacher can scan ("נסגר אתמול") and, next to it, the
 * date itself — because "אתמול" answers "is this still fresh?" while the date
 * answers "which lesson was that?".
 *
 * `date` is null exactly when the phrase already names the date, so the card
 * never prints the same day twice.
 */
export interface ClosedAtMeta {
  phrase: string;
  date: string | null;
}

/**
 * Phrase a closing time relative to today, in *school-local calendar days* —
 * a window that closed at 23:00 last night is "אתמול" even though barely a few
 * hours passed, which is how a teacher thinks about it. Beyond a week the
 * relative phrasing stops helping and the date carries it alone.
 */
export function closedAtMeta(iso: string, now: Date = new Date()): ClosedAtMeta {
  const days = schoolDayNumber(now) - schoolDayNumber(new Date(iso));
  if (days <= 0) return { phrase: "נסגר היום", date: formatShortDate(iso) };
  if (days === 1) return { phrase: "נסגר אתמול", date: formatShortDate(iso) };
  if (days < 7)
    return { phrase: `נסגר לפני ${days} ימים`, date: formatShortDate(iso) };
  return { phrase: `נסגר ב־${formatShortDate(iso)}`, date: null };
}

