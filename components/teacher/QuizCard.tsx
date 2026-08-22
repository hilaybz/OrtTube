import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/components/ui/cn";
import type { MyQuiz } from "@/lib/quiz";
import type { SharedQuiz } from "@/lib/sharing";
import type { ClassTag, QuizAllocationTags } from "@/lib/allocations";
import type { Language } from "@/lib/lang";
import { quizDurationMinutes } from "@/lib/quizDuration";

/**
 * The teacher quiz card — the reference surface for every card in the teacher
 * app (the overview page's tiles match its frame).
 *
 * Its whole design is a hierarchy: the video thumbnail identifies the quiz at a
 * glance, the title is the only prominent text, and exactly ONE fact rides
 * along under it — where the quiz stands right now. Everything else the card
 * used to stack into a wall of badges (source video, channel, language,
 * creation date) moved into the hover panel over the thumbnail, and the actions
 * only surface on hover/focus, so a grid of cards reads as a grid of quizzes
 * rather than a grid of forms.
 *
 * Hover content is dimmed with opacity, never unmounted, so it stays in the
 * accessibility tree and `group-focus-within` brings it up for keyboard users.
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

/** Shared frame: glass surface, flush media band on top, padded body below. */
function CardShell({
  interactive,
  className,
  children,
}: {
  interactive?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "glass group relative flex h-full flex-col",
        interactive &&
          "transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[var(--glass-bg-hover)]",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * The 16:9 thumbnail band. YouTube's `mqdefault` is the only 16:9 still every
 * video has, so it never letterboxes. `children` are chips/overlays positioned
 * over it.
 *
 * Hover is a *lift*, not a dim: the still scales up a touch inside its own
 * clipped band (the frame stays as bright as it was — nothing is greyed out to
 * make room for text), and on a card that opens somewhere a light play disc
 * fades in to say so. The old treatment dropped a flat 70%-black sheet over
 * the whole image, which read as "disabled" rather than "hovered".
 */
export function QuizThumb({
  youtubeVideoId,
  playAffordance,
  children,
}: {
  youtubeVideoId: string;
  /** Show the hover play disc — only on a card that actually navigates. */
  playAffordance?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-[var(--neutral-tertiary)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://i.ytimg.com/vi/${youtubeVideoId}/mqdefault.jpg`}
        alt=""
        className="h-full w-full object-cover transition-transform duration-300 ease-out group-focus-within:scale-[1.04] group-hover:scale-[1.04]"
      />
      {playAffordance && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="flex h-11 w-11 scale-90 items-center justify-center rounded-full bg-white/85 text-[var(--fg-brand-strong)] opacity-0 shadow-[var(--shadow-xs)] backdrop-blur-sm transition duration-200 ease-out group-focus-within:scale-100 group-focus-within:opacity-100 group-hover:scale-100 group-hover:opacity-100">
            <Icon name="play" size={18} />
          </span>
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * The quiz's length as students see it: the teacher's stated cap, or a `~`
 * estimate from the video. `null` when neither is known, so callers can skip
 * the chip entirely rather than render an empty one.
 */
export function durationChipText(quiz: {
  time_restricted: boolean;
  duration_minutes: number | null;
  duration_seconds: number | null;
}): string | null {
  const d = quizDurationMinutes(quiz);
  return d ? `${d.estimated ? "~" : ""}${d.minutes} דק׳` : null;
}

/** Dark pill sitting on the thumbnail — legible over any frame of any video. */
function ThumbChip({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "absolute inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm",
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * The chips along the thumbnail's bottom edge share that edge with the hover
 * details, so they step aside while the details are up — the band swaps its
 * size facts for its identity facts instead of stacking both in one strip.
 */
const THUMB_CHIP_HOVER_HIDE =
  "transition-opacity duration-200 group-focus-within:opacity-0 group-hover:opacity-0";

/**
 * The secondary facts, revealed over the thumbnail on hover/focus: the source
 * video and its channel (skipped when the heading is already the video's own
 * title), the authoring teacher on a catalog card, and the base language.
 *
 * The backdrop is a bottom-up gradient rather than a flat sheet: the text sits
 * on the darkest part of it while the top of the frame — the part that
 * identifies the video — stays fully visible.
 */
function ThumbDetails({
  quiz,
  authorName,
}: {
  quiz: { title: string | null; video_title: string | null; channel_name: string | null; base_language: Language };
  authorName?: string | null;
}) {
  const showVideoTitle = !!quiz.title && !!quiz.video_title;
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-end gap-1 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-3 text-[11px] leading-relaxed text-white opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100">
      {showVideoTitle && (
        <p className="flex items-center gap-1.5">
          <Icon name="video" size={12} className="flex-none opacity-80" />
          <span className="line-clamp-2">{quiz.video_title}</span>
        </p>
      )}
      {quiz.channel_name && (
        <p className="truncate opacity-80">{quiz.channel_name}</p>
      )}
      {authorName && <p className="opacity-80">מאת {authorName}</p>}
      <p className="opacity-80">{LANG_LABEL[quiz.base_language] ?? quiz.base_language}</p>
    </div>
  );
}

/**
 * "In one class" reads as its name; more than one reads as a count — the whole
 * roster would never fit on a card, and the count is what a teacher checks.
 */
function classesPhrase(verb: string, classes: ClassTag[]): string {
  return classes.length === 1
    ? `${verb} ב${classes[0].class_name}`
    : `${verb} ב-${classes.length} כיתות`;
}

/** One state of the allocation line: an icon, a phrase, and its tone. */
function AllocationTag({
  icon,
  text,
  tone,
}: {
  icon: IconName;
  text: string;
  tone: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", tone)}>
      <Icon name={icon} size={13} className="flex-none" />
      <span className="truncate">{text}</span>
    </span>
  );
}

/**
 * Where the quiz stands across its classes. Live and scheduled are shown
 * TOGETHER: a quiz that is open in one class and starts next week in another
 * used to report only the first, hiding the rollout the teacher planned.
 *
 * Closed classes only speak when nothing is open or upcoming — that is exactly
 * the "finished" state the library's status filter and the home KPI tiles
 * count — and with `closed` now a real bucket of
 * `list_my_quiz_allocation_tags`, an all-drafts quiz is finally
 * distinguishable from a finished one and says "טיוטה" honestly.
 *
 * Icons and tones follow `scheduleFormat`'s `allocationStatus`, so one quiz
 * wears the same vocabulary on a card and in a class's allocation row.
 * `undefined` tags mean the quiz has no allocation at all and render nothing.
 */
function AllocationLine({ tags }: { tags: QuizAllocationTags | undefined }) {
  if (!tags) return null;
  const { live, scheduled, closed } = tags;
  const open = live.length > 0 || scheduled.length > 0;

  return (
    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium">
      {live.length > 0 && (
        <AllocationTag
          icon="timer"
          text={classesPhrase("זמין", live)}
          tone="text-[var(--fg-success)]"
        />
      )}
      {scheduled.length > 0 && (
        <AllocationTag
          icon="calendar"
          text={classesPhrase("מתוזמן", scheduled)}
          tone="text-[var(--fg-warning)]"
        />
      )}
      {!open && closed.length > 0 && (
        <AllocationTag
          icon="checkCircle"
          text={classesPhrase("הסתיים", closed)}
          tone="text-[var(--body)]"
        />
      )}
      {!open && closed.length === 0 && (
        <AllocationTag
          icon="eyeOff"
          text="טיוטה — מוסתר מתלמידים"
          tone="text-[var(--body-subtle)]"
        />
      )}
    </div>
  );
}

export interface QuizCardProps {
  quiz: MyQuiz;
  /** Allocation buckets for the status line. Omit when they weren't fetched. */
  tags?: QuizAllocationTags;
  /** Wire this to a confirmation dialog to show the card's delete action. */
  onRequestDelete?: (quiz: MyQuiz) => void;
  /** Where the card navigates. Defaults to this quiz's editor. */
  href?: string;
  className?: string;
}

/**
 * A card for one of the teacher's OWN quizzes. The whole card is a link to the
 * editor (a stretched anchor, so the card-wide target needs no button nested in
 * an anchor); the delete action floats above that link.
 */
export function QuizCard({
  quiz,
  tags,
  onRequestDelete,
  href,
  className,
}: QuizCardProps) {
  const heading = cardHeading(quiz);
  const shared = quiz.visibility === "shared";
  const durationText = durationChipText(quiz);
  return (
    <CardShell interactive className={className}>
      <Link
        href={href ?? `/dashboard/quizzes/${quiz.quiz_id}/edit`}
        aria-label={`עריכת ${heading}`}
        className="absolute inset-0 z-10 rounded-[inherit]"
      />
      <QuizThumb youtubeVideoId={quiz.youtube_video_id} playAffordance>
        <ThumbChip className={cn("bottom-2 start-2", THUMB_CHIP_HOVER_HIDE)}>
          <Icon name="quiz" size={12} />
          <span className="tabular-nums">{quiz.question_count}</span> שאלות
        </ThumbChip>
        {durationText && (
          <ThumbChip className={cn("bottom-2 end-2", THUMB_CHIP_HOVER_HIDE)}>
            <Icon name="clock" size={12} />
            <span className="tabular-nums">{durationText}</span>
          </ThumbChip>
        )}
        <ThumbChip className="top-2 start-2">
          <Icon
            name={shared ? "share" : "lock"}
            size={12}
            label={shared ? "משותף לבית הספר" : "פרטי"}
          />
        </ThumbChip>
        <ThumbDetails quiz={quiz} />
      </QuizThumb>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3
          className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--heading)]"
          title={heading}
        >
          {heading}
        </h3>
        <AllocationLine tags={tags} />
      </div>

      {/* Above the stretched link, or the link swallows the click. `.glass > *`
          in globals.css pins every direct child to z-index 2 — and because that
          makes this wrapper a stacking context, a z-index on the button alone
          would be trapped inside it and could never beat the link. So the
          wrapper is lifted and made click-through, leaving only the button
          interactive; the rest of the card keeps opening the editor. */}
      {onRequestDelete && (
        <div className="pointer-events-none absolute end-2 top-2 z-20">
          <IconButton
            name="trash"
            label="מחיקת החידון"
            variant="danger"
            size="sm"
            tooltipPlacement="bottom"
            onClick={() => onRequestDelete(quiz)}
            // Hidden until the card is hovered or focused — and always visible
            // where there is no hover at all, so a touch device can still reach it.
            className="pointer-events-auto bg-white/90 opacity-0 shadow-[var(--shadow-xs)] backdrop-blur-sm transition-opacity hover:bg-white focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          />
        </div>
      )}
    </CardShell>
  );
}

/**
 * The same frame for a quiz in the school catalog: no editor to link to (the
 * viewer doesn't own it), so the actions — preview, clone — are the card's own
 * footer instead of a stretched link, and the authoring teacher joins the hover
 * panel.
 */
export function CatalogQuizCard({
  quiz,
  onPreview,
  onClone,
  cloning,
  cloneDisabled,
  className,
}: {
  quiz: SharedQuiz;
  onPreview: (quizId: string) => void;
  onClone: (quizId: string) => void;
  /** THIS card's clone is in flight — shows the spinner on its own button. */
  cloning: boolean;
  /** Some other card's clone is in flight — one at a time. */
  cloneDisabled?: boolean;
  className?: string;
}) {
  const heading = cardHeading(quiz);
  const durationText = durationChipText(quiz);
  return (
    <CardShell className={className}>
      <QuizThumb youtubeVideoId={quiz.youtube_video_id}>
        <ThumbChip className={cn("bottom-2 start-2", THUMB_CHIP_HOVER_HIDE)}>
          <Icon name="quiz" size={12} />
          <span className="tabular-nums">{quiz.question_count}</span> שאלות
        </ThumbChip>
        {durationText && (
          <ThumbChip className={cn("bottom-2 end-2", THUMB_CHIP_HOVER_HIDE)}>
            <Icon name="clock" size={12} />
            <span className="tabular-nums">{durationText}</span>
          </ThumbChip>
        )}
        {quiz.is_own && (
          <span className="absolute top-2 start-2">
            <Badge variant="brand">שלי</Badge>
          </span>
        )}
        <ThumbDetails quiz={quiz} authorName={quiz.author_name} />
      </QuizThumb>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3
          className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--heading)]"
          title={heading}
        >
          {heading}
        </h3>
        <div className="mt-auto flex items-center gap-1 pt-1">
          <IconButton
            name="play"
            label="תצוגה מקדימה"
            onClick={() => onPreview(quiz.quiz_id)}
          />
          <IconButton
            name="copy"
            label="שכפול"
            variant="brand"
            busy={cloning}
            disabled={cloneDisabled}
            onClick={() => onClone(quiz.quiz_id)}
          />
        </div>
      </div>
    </CardShell>
  );
}
