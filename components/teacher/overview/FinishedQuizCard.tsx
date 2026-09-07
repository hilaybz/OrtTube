import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { withBackTarget } from "@/components/ui/backTarget";
import { classQuizAnalyticsHref } from "@/components/teacher/analyticsLinks";
import { QuizThumb, ThumbChip } from "@/components/ui/QuizThumb";
import { closedAtMeta, quizHeading, type RecentlyFinishedQuiz } from "./aggregate";

/**
 * `now` is a prop rather than a `new Date()` inside the card so the relative
 * phrasing of the closing time is computed from the same instant the rest of
 * the page was rendered against, and stays a pure function of its inputs.
 */
export function FinishedQuizCard({
  quiz,
  now,
}: {
  quiz: RecentlyFinishedQuiz;
  now: Date;
}) {
  const heading = quizHeading(quiz);
  const closed = closedAtMeta(quiz.closedAt, now);
  return (
    <div className="glass group relative flex h-full flex-col transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[var(--glass-bg-hover)]">
      <Link
        href={withBackTarget(
          classQuizAnalyticsHref(quiz.classId, quiz.quizId),
          "overview"
        )}
        aria-label={`תוצאות ${heading} ב${quiz.className}`}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
      <QuizThumb youtubeVideoId={quiz.youtubeVideoId}>
        <div className="absolute inset-0 bg-white/45" />
        <ThumbChip className="bottom-2 start-2">
          <Icon name="quiz" size={12} />
          <span className="tabular-nums">{quiz.questionCount}</span> שאלות
        </ThumbChip>
        <ThumbChip className="top-2 start-2">
          <Icon name="checkCircle" size={12} />
          הסתיים
        </ThumbChip>
      </QuizThumb>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3
          className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--heading)]"
          title={heading}
        >
          {heading}
        </h3>
        <div className="mt-auto flex flex-col gap-1 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-[var(--body)]">
            <Icon name="class" size={13} className="flex-none text-[var(--body-subtle)]" />
            <span className="truncate">{quiz.className}</span>
          </span>
          <span className="flex items-center gap-1.5 text-[var(--body-subtle)]">
            <Icon name="calendar" size={13} className="flex-none" />
            <span>{closed.phrase}</span>
            {closed.date && (
              <time dateTime={quiz.closedAt} className="tabular-nums">
                · {closed.date}
              </time>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
