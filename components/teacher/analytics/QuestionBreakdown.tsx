import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { HBar } from "./HBar";
import type { ClassQuizQuestionStat } from "@/lib/analytics";

/** Render a 0..1 fraction as a whole-percent string, or an em dash when null. */
function pct(fraction: number | null): string {
  return fraction == null ? "—" : `${Math.round(fraction * 100)}%`;
}

/**
 * Per-question breakdown: correct-% and one bar per option showing how many
 * students (latest completed attempt) chose it. The correct option is
 * marked with a badge; soft-deleted questions/options are dimmed and noted
 * rather than hidden, so a since-edited question's history stays visible —
 * same "keep, don't hide" precedent as `question_stats`.
 */
export function QuestionBreakdown({
  questions,
}: {
  questions: ClassQuizQuestionStat[];
}) {
  if (questions.length === 0) {
    return (
      <GlassCard>
        <p className="text-sm text-[var(--body-subtle)]">אין שאלות בחידון זה.</p>
      </GlassCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {questions.map((q, i) => (
        <GlassCard
          key={q.question_id}
          className={q.deleted ? "opacity-60" : undefined}
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <h4 className="font-medium text-[var(--heading)]">
              {i + 1}. {q.prompt ?? "שאלה"}
            </h4>
            <div className="flex flex-none items-center gap-2">
              {q.deleted && <Badge variant="gray">נמחקה</Badge>}
              <Badge variant="success">{pct(q.correct_pct)} נכונות</Badge>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {q.options.map((o) => (
              <div key={o.option_id} className="flex items-center gap-2">
                <HBar
                  label={o.text ?? "אפשרות"}
                  count={o.selection_count}
                  total={q.answered_count}
                  variant={o.is_correct ? "success" : "brand"}
                />
                {o.is_correct && <Badge variant="success">נכונה</Badge>}
                {o.deleted && <Badge variant="gray">נמחקה</Badge>}
              </div>
            ))}
          </div>
        </GlassCard>
      ))}
    </div>
  );
}
