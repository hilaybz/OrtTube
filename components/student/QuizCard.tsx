import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import type { StudentAttemptState } from "@/lib/attempts";

export interface FeedQuiz {
  quiz_id: string;
  title: string | null;
  video_title: string | null;
  youtube_video_id: string;
  state: StudentAttemptState | null;
}

/**
 * "עד 18:00 · היום" for a deadline later today, otherwise "עד 18:00 · 14.3".
 * Only ever called with a live allocation's `available_until` (the feed only
 * lists live allocations — see list_assigned_for_student), so this is always
 * a future time; no "overdue" wording needed here.
 */
function formatDueDate(iso: string): string {
  const due = new Date(iso);
  const now = new Date();
  const time = due.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  if (due.toDateString() === now.toDateString()) return `עד ${time} · היום`;
  const date = due.toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
  return `עד ${time} · ${date}`;
}

/** Derive the card's status label + CTA from the attempt state. */
function status(state: StudentAttemptState | null): {
  badge: { text: string; variant: "brand" | "gray" | "success" };
  cta: string;
} {
  if (!state) return { badge: { text: "טרם התחלת", variant: "gray" }, cta: "התחלה" };
  if (state.in_progress)
    return { badge: { text: "בתהליך", variant: "brand" }, cta: "המשך" };
  if (state.completed_count > 0) {
    const score =
      state.last_num_questions != null && state.last_num_questions > 0
        ? `${state.last_num_correct}/${state.last_num_questions}`
        : "הושלם";
    const canRetry = state.attempts_left == null || state.attempts_left > 0;
    return {
      badge: { text: score, variant: "success" },
      cta: canRetry ? "ניסיון נוסף" : "צפייה בתוצאות",
    };
  }
  return { badge: { text: "טרם התחלת", variant: "gray" }, cta: "התחלה" };
}

export function QuizCard({
  classId,
  quiz,
}: {
  classId: string;
  quiz: FeedQuiz;
}) {
  const s = status(quiz.state);
  const attemptsNote =
    quiz.state && quiz.state.max_attempts != null
      ? `נותרו ${quiz.state.attempts_left} מתוך ${quiz.state.max_attempts} ניסיונות`
      : "ניסיונות ללא הגבלה";

  return (
    <Link
      href={`/student/quiz/${classId}/${quiz.quiz_id}`}
      className="group block focus-visible:outline-none"
    >
      <GlassCard interactive className="flex h-full flex-col gap-3 p-0">
        <div className="relative aspect-video overflow-hidden rounded-t-[var(--radius)] bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${quiz.youtube_video_id}/hqdefault.jpg`}
            alt=""
            className="h-full w-full object-cover opacity-95 transition group-hover:scale-[1.03]"
          />
          <span className="absolute end-2 top-2">
            <Badge variant={s.badge.variant} pill>
              {s.badge.text}
            </Badge>
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-2 px-4 pb-4">
          <h3 className="font-semibold text-[var(--heading)]">
            {quiz.title ?? quiz.video_title ?? "חידון"}
          </h3>
          <p className="text-xs text-[var(--body-subtle)]">{attemptsNote}</p>
          {quiz.state?.available_until && (
            <p className="text-xs font-medium text-[var(--fg-warning)]">
              {formatDueDate(quiz.state.available_until)}
            </p>
          )}
          <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-[var(--fg-brand)]">
            {s.cta}
            <Icon name="arrow" size={16} />
          </span>
        </div>
      </GlassCard>
    </Link>
  );
}
