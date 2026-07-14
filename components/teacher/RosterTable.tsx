import { Icon } from "@/components/ui/Icon";
import type { ClassRosterProgress } from "@/lib/analyticsProgress";

/** Render a 0..1 fraction as a whole-percent string, or an em dash when null. */
function pct(fraction: number | null): string {
  return fraction == null ? "—" : `${Math.round(fraction * 100)}%`;
}

const HEAD_CELL =
  "whitespace-nowrap px-4 py-3 text-start text-sm font-medium text-[var(--body)]";
const BODY_CELL = "whitespace-nowrap px-4 py-4 text-sm tabular-nums";

/**
 * Per-student progress grid for one class: one row per current member, one
 * column per assigned quiz (best score `x/y`), plus a rollup column. Completion
 * is conveyed by a check icon + green text, never by color alone; the empty
 * cell carries a visually-hidden "לא הושלם" for screen readers.
 *
 * The table scrolls horizontally inside a rounded glass frame so a class with
 * many assigned quizzes stays usable.
 */
export function RosterTable({ roster }: { roster: ClassRosterProgress }) {
  const { members } = roster;

  // Column set = the assigned, non-deleted quizzes, in first-seen order across
  // members (every member shares the same assignment set).
  const quizCols: { quiz_id: string; title: string | null }[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    for (const q of m.quizzes) {
      if (!seen.has(q.quiz_id)) {
        seen.add(q.quiz_id);
        quizCols.push({ quiz_id: q.quiz_id, title: q.title });
      }
    }
  }

  if (members.length === 0) {
    return (
      <div className="glass p-5">
        <p className="text-[var(--body)]">
          עדיין אין תלמידים בכיתה. לאחר צירוף תלמידים, ההתקדמות שלהם תופיע כאן.
        </p>
      </div>
    );
  }

  return (
    <div className="glass">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-start">
          <caption className="sr-only">התקדמות התלמידים בחידונים שהוקצו</caption>
          <thead>
            <tr className="border-b border-[var(--glass-border-subtle)]">
              <th scope="col" className={HEAD_CELL}>
                תלמיד/ה
              </th>
              {quizCols.map((c, i) => (
                <th key={c.quiz_id} scope="col" className={HEAD_CELL}>
                  {c.title ?? `חידון ${i + 1}`}
                </th>
              ))}
              <th scope="col" className={HEAD_CELL}>
                סיכום
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m, rowIdx) => {
              const last = rowIdx === members.length - 1;
              return (
                <tr
                  key={m.student_id}
                  className={last ? "" : "border-b border-[var(--glass-border-subtle)]"}
                >
                  <th
                    scope="row"
                    className="whitespace-nowrap px-4 py-4 text-start align-top font-medium text-[var(--heading)]"
                  >
                    <span className="block">{m.display_name ?? m.email}</span>
                    {m.display_name && (
                      <span className="block text-xs font-normal text-[var(--body-subtle)]">
                        {m.email}
                      </span>
                    )}
                  </th>

                  {quizCols.map((c) => {
                    const q = m.quizzes.find((x) => x.quiz_id === c.quiz_id);
                    const done =
                      q?.completed &&
                      q.best_num_correct != null &&
                      q.best_num_questions != null;
                    return (
                      <td key={c.quiz_id} className={BODY_CELL}>
                        {done ? (
                          <span className="inline-flex items-center gap-1 font-medium text-[var(--fg-success)]">
                            <Icon name="check" size={16} />
                            {q!.best_num_correct}/{q!.best_num_questions}
                          </span>
                        ) : (
                          <span className="text-[var(--body-subtle)]">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">לא הושלם</span>
                          </span>
                        )}
                      </td>
                    );
                  })}

                  <td className={`${BODY_CELL} text-[var(--body)]`}>
                    <span className="block font-medium text-[var(--heading)]">
                      {m.quizzes_completed}/{m.total_assigned} הושלמו
                    </span>
                    <span className="block text-xs text-[var(--body-subtle)]">
                      ממוצע {pct(m.average_best_score)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
