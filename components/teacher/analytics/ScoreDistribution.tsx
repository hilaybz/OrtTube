import { GlassCard } from "@/components/ui/GlassCard";
import { HBar } from "./HBar";
import type { ScoreBucket } from "@/lib/analytics";

/** "0–20%" / "80–100%" label for one score band. */
function bucketLabel(b: ScoreBucket): string {
  return `${Math.round(b.bucket_min * 100)}–${Math.round(b.bucket_max * 100)}%`;
}

/**
 * Score distribution across the class's latest completed attempts, as 5
 * horizontal bars (0–20% .. 80–100%). `students_completed` is the shared
 * denominator so bar widths are comparable to each other.
 */
export function ScoreDistribution({
  buckets,
  studentsCompleted,
}: {
  buckets: ScoreBucket[];
  studentsCompleted: number;
}) {
  return (
    <GlassCard className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold text-[var(--heading)]">
        התפלגות ציונים
      </h3>
      {studentsCompleted === 0 ? (
        <p className="text-sm text-[var(--body-subtle)]">
          עדיין אין תלמידים שסיימו את החידון.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {[...buckets].reverse().map((b) => (
            <HBar
              key={b.bucket_min}
              label={bucketLabel(b)}
              count={b.count}
              total={studentsCompleted}
            />
          ))}
        </div>
      )}
    </GlassCard>
  );
}
