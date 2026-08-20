import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { QuizThumb } from "@/components/teacher/QuizCard";
import {
  formatShortDate,
  quizHeading,
  type RecentlyFinishedQuiz,
} from "./aggregate";

/**
 * A quiz whose window just closed for one class. Built on the teacher quiz
 * card's frame — the same glass shell, the same flush 16:9 thumbnail band, the
 * same one-fact body — because it sits a row above those cards on the overview
 * and any difference in the frame would read as a bug. What changes is the one
 * fact it carries: a finished quiz is about which class and when it closed, and
 * the card leads into that class's results rather than into the editor.
 */
export function FinishedQuizCard({ quiz }: { quiz: RecentlyFinishedQuiz }) {
  const heading = quizHeading(quiz);
  return (
    <div className="glass group relative flex h-full flex-col transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[var(--glass-bg-hover)]">
      {/* Stretched link: the whole card opens this class's results for the quiz. */}
      <Link
        href={`/dashboard/classes/${quiz.classId}/analytics/${quiz.quizId}`}
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
        <p className="mt-auto flex items-center gap-1.5 truncate text-xs font-medium text-[var(--body)]">
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--gray)]" />
          <span className="truncate">
            {quiz.className} · נסגר ב־{formatShortDate(quiz.closedAt)}
          </span>
        </p>
      </div>
    </div>
  );
}
