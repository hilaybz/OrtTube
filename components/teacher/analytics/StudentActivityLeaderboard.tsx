import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Avatar } from "@/components/ui/Avatar";
import { studentAnalyticsHref } from "@/components/teacher/analyticsLinks";
import type {
  ClassRosterProgress,
  RosterMemberProgress,
} from "@/lib/analyticsProgress";
import { grade } from "./chartTheme";

const TOP_N = 5;

function topByActivity(members: RosterMemberProgress[]): RosterMemberProgress[] {
  return [...members]
    .sort((a, b) => {
      if (b.quizzes_completed !== a.quizzes_completed) {
        return b.quizzes_completed - a.quizzes_completed;
      }
      return (b.average_best_score ?? -1) - (a.average_best_score ?? -1);
    })
    .slice(0, TOP_N);
}

export function StudentActivityLeaderboard({
  roster,
}: {
  roster: ClassRosterProgress;
}) {
  const top = topByActivity(roster.members);

  return (
    <GlassCard className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-[var(--heading)]">
          פעילות תלמידים
        </h2>
        <p className="mt-0.5 text-xs text-[var(--body-subtle)]">
          התלמידים הפעילים ביותר בכיתה, לפי מספר חידונים שהושלמו
        </p>
      </div>

      {top.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--body-subtle)]">
          עדיין אין תלמידים בכיתה.
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {top.map((m, i) => {
            const name = m.display_name ?? m.email;
            return (
              <li key={m.student_id}>
                <Link
                  href={studentAnalyticsHref(m.student_id)}
                  className="flex items-center gap-3 rounded-[var(--radius-d)] px-2 py-2 transition-colors hover:bg-[var(--glass-bg-hover)]"
                >
                  <span className="w-4 flex-none text-center text-xs font-medium text-[var(--body-subtle)]">
                    {i + 1}
                  </span>
                  <Avatar name={name} size={32} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--heading)]">
                    {name}
                  </span>
                  <span className="flex-none text-xs text-[var(--body-subtle)]">
                    {m.quizzes_completed}/{m.total_assigned} חידונים
                  </span>
                  <span className="flex-none text-sm font-semibold tabular-nums text-[var(--heading)]">
                    {grade(m.average_best_score)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </GlassCard>
  );
}
