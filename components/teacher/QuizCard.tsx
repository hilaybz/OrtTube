import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import type { MyQuiz } from "@/lib/quiz";
import type { QuizAllocationTags } from "@/lib/allocations";
import type { Language } from "@/lib/lang";

/**
 * Shared teacher-quiz card + its building blocks — extracted from
 * `QuizLibrary.tsx`'s "mine" tab so the library page and the dashboard
 * landing section render identical cards (backlog 1.5 / 2A.4) instead of two
 * markups drifting apart.
 */

export const LANG_LABEL: Record<Language, string> = {
  he: "עברית",
  ar: "ערבית",
  en: "אנגלית",
};

/** The heading shown on a card: the teacher's own title, else the video's. */
export function cardHeading(quiz: { title: string | null; video_title: string | null }) {
  return quiz.title ?? quiz.video_title ?? "חידון";
}

/**
 * The source video, shown under the heading. Rendered only when the teacher
 * gave the quiz its own title — otherwise `cardHeading` is already showing
 * the video title and repeating it says nothing.
 */
export function VideoLine({
  quiz,
}: {
  quiz: { title: string | null; video_title: string | null };
}) {
  if (!quiz.title || !quiz.video_title) return null;
  return (
    <p
      className="flex items-center gap-1.5 truncate text-xs text-[var(--body-subtle)]"
      title={quiz.video_title}
    >
      <Icon name="play" size={12} className="flex-none" />
      <span className="truncate">{quiz.video_title}</span>
    </p>
  );
}

export function QuizMeta({
  baseLanguage,
  questionCount,
}: {
  baseLanguage: Language;
  questionCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="gray">{LANG_LABEL[baseLanguage] ?? baseLanguage}</Badge>
      <span className="text-xs text-[var(--body-subtle)]">
        <span className="tabular-nums">{questionCount}</span> שאלות
      </span>
    </div>
  );
}

/**
 * Allocation status: `זמין:` (live) / `מתוזמן:` (scheduled) rows of per-class
 * chips, each row omitted when empty. When BOTH are empty, a single neutral
 * badge stands in instead — so a card always says something about where the
 * quiz stands rather than going silent.
 *
 * That badge deliberately does NOT say "טיוטה" (draft): both buckets are also
 * empty for an allocation whose window has already closed (see the deferred
 * "quiz finished" issue, #69) — `list_my_quiz_allocation_tags` only reports
 * live/scheduled, so this component genuinely cannot tell "never allocated or
 * still a draft" apart from "was live and finished" from the response alone.
 * Claiming "draft" for a quiz that already ran would be a real factual error,
 * not just an incomplete one — "לא פעיל" (not active) is accurate either way.
 */
function AllocationTagsRow({ tags }: { tags: QuizAllocationTags | undefined }) {
  const live = tags?.live ?? [];
  const scheduled = tags?.scheduled ?? [];
  if (live.length === 0 && scheduled.length === 0) {
    return (
      <div>
        <Badge variant="warning">לא פעיל</Badge>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {live.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[var(--body-subtle)]">זמין:</span>
          {live.map((c) => (
            <Badge key={c.class_id} variant="success">
              {c.class_name}
            </Badge>
          ))}
        </div>
      )}
      {scheduled.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[var(--body-subtle)]">מתוזמן:</span>
          {scheduled.map((c) => (
            <Badge key={c.class_id} variant="gray">
              {c.class_name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A quiz card for one of the teacher's own quizzes. Used by both the library
 * page (`onRequestDelete` wired to its delete-confirm modal) and the
 * dashboard landing section (no delete affordance, and only rendered for
 * quizzes that have at least one allocation). `tags` is optional so a caller
 * without allocation data (or that hasn't fetched it) simply omits the rows —
 * `undefined` skips the block entirely, distinct from "fetched, has none"
 * (which would render the `טיוטה` badge).
 */
export function QuizCard({
  quiz,
  tags,
  onRequestDelete,
}: {
  quiz: MyQuiz;
  tags?: QuizAllocationTags;
  onRequestDelete?: (quiz: MyQuiz) => void;
}) {
  return (
    <GlassCard interactive className="relative flex h-full flex-col gap-3">
      {/* Stretched link: the whole card opens the editor, while the delete
          control sits above it and stays separately clickable. Keeps the
          card-wide target without nesting a button in an anchor. */}
      <Link
        href={`/dashboard/quizzes/${quiz.quiz_id}/edit`}
        aria-label={`עריכת ${cardHeading(quiz)}`}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://i.ytimg.com/vi/${quiz.youtube_video_id}/mqdefault.jpg`}
          alt=""
          className="h-10 w-16 flex-none rounded-[var(--radius-sm)] object-cover"
        />
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          <h3 className="min-w-0 truncate font-semibold text-[var(--heading)]">
            {cardHeading(quiz)}
          </h3>
          <Badge variant={quiz.visibility === "shared" ? "brand" : "gray"}>
            {quiz.visibility === "shared" ? "משותף" : "פרטי"}
          </Badge>
        </div>
      </div>
      <VideoLine quiz={quiz} />
      <QuizMeta baseLanguage={quiz.base_language} questionCount={quiz.question_count} />
      {tags !== undefined && <AllocationTagsRow tags={tags} />}
      {/* This row must sit ABOVE the stretched link, or the link swallows the
          delete click. `.glass > *` in globals.css pins every direct child to
          z-index 2 — and because that makes this row a stacking context, a
          z-index on the button alone is trapped inside it and can never beat
          the link. So the row is lifted, and made click-through, leaving only
          the button itself interactive: "עריכה" keeps falling through to the
          card link. */}
      <div className="pointer-events-none relative z-20 mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--fg-brand)]">
          עריכה
          <Icon name="arrow" size={16} />
        </span>
        {onRequestDelete && (
          <button
            type="button"
            onClick={() => onRequestDelete(quiz)}
            className="pointer-events-auto rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--body-subtle)] hover:bg-[var(--neutral-quaternary)] hover:text-[var(--fg-danger)]"
          >
            מחיקה
          </button>
        )}
      </div>
    </GlassCard>
  );
}
