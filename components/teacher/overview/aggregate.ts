import type { ClassStats } from "@/lib/analytics";
import type { ClassRow } from "@/lib/classes";

/**
 * A per-class summary reduced from the raw `class_stats` payload, ready for a
 * class card: roster size, count of currently-assigned (non-deleted) quizzes,
 * total completions, and the completion-weighted mean score.
 */
export interface ClassSummary {
  id: string;
  name: string;
  memberCount: number;
  assignedCount: number;
  completions: number;
  /** Completion-weighted mean fraction correct (0..1), or `null`. */
  avgScore: number | null;
}

/**
 * Cross-class totals for the KPI row: classes, students, completions, and the
 * overall completion-weighted mean score across every assigned quiz.
 */
export interface OverviewTotals {
  classCount: number;
  studentCount: number;
  completions: number;
  /** Completion-weighted mean fraction correct (0..1), or `null`. */
  avgScore: number | null;
}

/**
 * Combine a completion-weighted average incrementally: each quiz contributes
 * its `average_score` weighted by how many completed attempts produced it, so
 * the result is the true mean over completed attempts rather than a mean of
 * per-quiz means. Quizzes with no completed attempts (null score) are ignored.
 */
class WeightedMean {
  private weightedSum = 0;
  private totalWeight = 0;

  add(score: number | null, weight: number): void {
    if (score == null || weight <= 0) return;
    this.weightedSum += score * weight;
    this.totalWeight += weight;
  }

  get value(): number | null {
    return this.totalWeight > 0 ? this.weightedSum / this.totalWeight : null;
  }
}

/**
 * Reduce one class's `class_stats` (paired with its roster row for the name)
 * into a `ClassSummary`. Only currently-assigned quizzes (`deleted === false`)
 * count toward the assigned/completion/score figures. Member count prefers the
 * stats denominator and falls back to zero when stats are unavailable.
 */
export function summarizeClass(
  klass: ClassRow,
  stats: ClassStats | null
): ClassSummary {
  const active = stats?.quizzes.filter((q) => !q.deleted) ?? [];
  const mean = new WeightedMean();
  let completions = 0;
  for (const q of active) {
    completions += q.completion_count;
    mean.add(q.average_score, q.completion_count);
  }
  return {
    id: klass.id,
    name: klass.name,
    memberCount: stats?.current_member_count ?? 0,
    assignedCount: active.length,
    completions,
    avgScore: mean.value,
  };
}

/** Aggregate per-class summaries into the cross-class KPI totals. */
export function totalsFromSummaries(
  summaries: readonly ClassSummary[],
  perClassStats: ReadonlyArray<ClassStats | null>
): OverviewTotals {
  const mean = new WeightedMean();
  for (const stats of perClassStats) {
    for (const q of stats?.quizzes ?? []) {
      if (q.deleted) continue;
      mean.add(q.average_score, q.completion_count);
    }
  }
  return {
    classCount: summaries.length,
    studentCount: summaries.reduce((sum, s) => sum + s.memberCount, 0),
    completions: summaries.reduce((sum, s) => sum + s.completions, 0),
    avgScore: mean.value,
  };
}

/** Render a 0..1 fraction as a whole-percent string, or an em dash when null. */
export function pct(fraction: number | null): string {
  return fraction == null ? "—" : `${Math.round(fraction * 100)}%`;
}
