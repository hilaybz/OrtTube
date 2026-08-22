"use client";

import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { Pager } from "@/components/ui/Pager";
import { usePagedList } from "@/components/ui/usePagedList";
import { HBar } from "./HBar";
import { pct } from "./chartTheme";
import type { ClassQuizQuestionStat } from "@/lib/analytics";

/**
 * Per-question breakdown: correct-% and one bar per option showing how many
 * students (latest completed attempt) chose it. The correct option is
 * marked with a badge; soft-deleted questions/options are dimmed and noted
 * rather than hidden, so a since-edited question's history stays visible —
 * same "keep, don't hide" precedent as `question_stats`.
 *
 * Paged: each question is a whole card of bars, and a long quiz is otherwise a
 * page a teacher scrolls past rather than reads.
 */
export function QuestionBreakdown({
  questions,
}: {
  questions: ClassQuizQuestionStat[];
}) {
  const paged = usePagedList(questions, { pageSize: 5 });

  if (questions.length === 0) {
    return (
      <GlassCard>
        <p className="text-sm text-[var(--body-subtle)]">אין שאלות בחידון זה.</p>
      </GlassCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {paged.slice.map((q, i) => (
        <GlassCard
          key={q.question_id}
          className={q.deleted ? "opacity-60" : undefined}
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <h4 className="font-medium text-[var(--heading)]">
              {paged.page * paged.pageSize + i + 1}. {q.prompt ?? "שאלה"}
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
      <Pager {...paged} label="ניווט בין השאלות" />
    </div>
  );
}
