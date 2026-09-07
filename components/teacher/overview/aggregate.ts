import type { ClassRow, AssignedQuiz } from "@/lib/classes";
import { allocationState, type AllocationState } from "@/lib/allocationState";
import { formatDate, schoolDayNumber } from "@/lib/datetime";

export const RECENTLY_FINISHED_LOOKBACK_DAYS = 7;

export interface ClassAssignments {
  klass: ClassRow;
  quizzes: readonly AssignedQuiz[];
}

export interface ClassSummary {
  id: string;
  name: string;
  memberCount: number;
  activeQuizzes: number;
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

export interface OverviewTotals {
  classCount: number;
  studentCount: number;
  openQuizzes: number;
  finishedQuizzes: number;
}

/**
 * Each quiz has exactly one allocation per class, so counting allocation states
 * here is already a per-quiz count; no de-duplication is needed (unlike the
 * cross-class KPI row, where one quiz spans several classes).
 */
export function summarizeClass(
  klass: ClassRow,
  memberCount: number,
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
    memberCount,
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

export interface RecentlyFinishedQuiz {
  key: string;
  quizId: string;
  classId: string;
  className: string;
  title: string | null;
  videoTitle: string | null;
  youtubeVideoId: string;
  questionCount: number;
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

export function quizHeading(quiz: {
  title: string | null;
  videoTitle: string | null;
}): string {
  return quiz.title ?? quiz.videoTitle ?? "חידון";
}

/**
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
  if (days <= 0) return { phrase: "נסגר היום", date: formatDate(iso) };
  if (days === 1) return { phrase: "נסגר אתמול", date: formatDate(iso) };
  if (days < 7)
    return { phrase: `נסגר לפני ${days} ימים`, date: formatDate(iso) };
  return { phrase: `נסגר ב־${formatDate(iso)}`, date: null };
}
