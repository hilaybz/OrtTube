import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/components/ui/cn";
import { QuizThumb, ThumbChip } from "@/components/ui/QuizThumb";
import type { MyQuiz } from "@/lib/quiz";
import type { SharedQuiz } from "@/lib/sharing";
import type { ClassTag, QuizAllocationTags } from "@/lib/allocations";
import type { Language } from "@/lib/lang";
import { durationChipText } from "@/lib/quizDuration";

export const LANG_LABEL: Record<Language, string> = {
  he: "עברית",
  ar: "ערבית",
  en: "אנגלית",
};

export function cardHeading(quiz: { title: string | null; video_title: string | null }) {
  return quiz.title ?? quiz.video_title ?? "חידון";
}

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

const THUMB_CHIP_HOVER_HIDE =
  "transition-opacity duration-200 group-focus-within:opacity-0 group-hover:opacity-0";

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

function classesPhrase(verb: string, classes: ClassTag[]): string {
  return classes.length === 1
    ? `${verb} ב${classes[0].class_name}`
    : `${verb} ב-${classes.length} כיתות`;
}

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
  tags?: QuizAllocationTags;
  onRequestDelete?: (quiz: MyQuiz) => void;
  href?: string;
  className?: string;
}

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
  cloning: boolean;
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
