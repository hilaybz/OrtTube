import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { withBackTarget } from "@/components/ui/backTarget";
import { QuizThumb } from "@/components/teacher/QuizCard";
import { closedAtMeta, quizHeading, type RecentlyFinishedQuiz } from "./aggregate";

/**
 * A quiz whose window just closed for one class. Built on the teacher quiz
 * card's frame — the same glass shell, the same flush 16:9 thumbnail band, the
 * same one-fact body — because it sits a row above those cards on the overview
 * and any difference in the frame would read as a bug. What changes is the one
 * fact it carries: a finished quiz is about which class and when it closed, and
 * the card leads into that class's results rather than into the editor.
 *
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
      {/* Stretched link: the whole card opens this class's results for the quiz.
          Those results are usually reached by drilling down through analytics,
          so the link says it came from the overview instead. */}
      <Link
        href={withBackTarget(
          `/dashboard/classes/${quiz.classId}/analytics/${quiz.quizId}`,
          "overview"
        )}
        aria-label={`תוצאות ${heading} ב${quiz.className}`}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
      <QuizThumb youtubeVideoId={quiz.youtubeVideoId}>
        {/* The thumbnail of a closed quiz is desaturated, so a glance at the
            row separates "over" from "running" before any label is read. */}
        <div className="absolute inset-0 bg-white/45" />
        <span className="absolute bottom-2 start-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          <Icon name="quiz" size={12} />
          <span className="tabular-nums">{quiz.questionCount}</span> שאלות
        </span>
        <span className="absolute top-2 start-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          <Icon name="checkCircle" size={12} />
          הסתיים
        </span>
      </QuizThumb>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3
          className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--heading)]"
          title={heading}
        >
          {heading}
        </h3>
        {/* Two meta facts, each with its own glyph, rather than one sentence:
            the class the teacher would open next, and how long ago the window
            closed. "אתמול" answers whether the results are still fresh; the
            date beside it answers which lesson it was, and is dropped when the
            phrase already names the date. */}
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
