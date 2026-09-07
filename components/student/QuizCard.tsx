import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/ui/Icon";
import { QuizThumb, ThumbChip } from "@/components/ui/QuizThumb";
import { cn } from "@/components/ui/cn";
import type { StudentFeedItem } from "@/lib/classes";
import { feedHeading } from "@/lib/studentFeedFilters";
import { durationChipText } from "@/lib/quizDuration";
import { formatGrade, gradeOf } from "./grade";
import type { StatusTone } from "./StatusBlock";
import { formatDate } from "@/lib/datetime";
import { deadlineView, URGENCY_TONE } from "./deadline";

export function attemptsChipText(item: StudentFeedItem): string {
  return item.max_attempts != null
    ? `נותרו ${item.attempts_left} מתוך ${item.max_attempts}`
    : "ללא הגבלה";
}

export function badgeFor(item: StudentFeedItem): {
  text: string;
  variant: "brand" | "gray" | "success";
} {
  if (item.status === "in_progress") return { text: "בתהליך", variant: "brand" };
  if (item.status === "completed") return { text: "הושלם", variant: "success" };
  return { text: "טרם התחלת", variant: "gray" };
}

/**
 * Whether a finished quiz can still be taken again — live allocation and an
 * attempt left. Both halves matter: a closed window ends retakes even with
 * allowance to spare, and an exhausted allowance ends them while it is open.
 */
function canRetake(item: StudentFeedItem): boolean {
  return item.is_live && (item.attempts_left == null || item.attempts_left > 0);
}

export function ctaFor(item: StudentFeedItem): string {
  if (item.status === "in_progress") return "המשך";
  if (item.status === "completed") {
    return canRetake(item) ? "ניסיון נוסף" : "צפייה בתוצאות";
  }
  return "התחלה";
}

/**
 * Where the card goes. A finished quiz with no retake left has nothing to open
 * a player for, so it goes straight to its results — the player's own opening
 * screen would only be a thumbnail with a "show results" button on it, and a
 * screen whose single purpose is a link to the next screen is a step, not a
 * page. Everything else opens the player, which is what "התחלה" / "המשך" /
 * "ניסיון נוסף" all mean.
 */
export function hrefFor(item: StudentFeedItem): string {
  const base = `/student/quiz/${item.class_id}/${item.quiz_id}`;
  return item.status === "completed" && !canRetake(item) ? `${base}/results` : base;
}

export interface FeedStatus {
  icon: IconName;
  tone: StatusTone;
  headline: string;
  meta: string | null;
  strong?: boolean;
}

export function feedStatus(item: StudentFeedItem, now: Date = new Date()): FeedStatus {
  if (item.status === "completed") {
    const grade = gradeOf(item.last_num_correct, item.last_num_questions);
    return {
      icon: "award",
      tone: "success",
      headline: grade != null ? formatGrade(grade) : "הושלם",
      strong: grade != null,
      meta: item.last_completed_at
        ? `הוגש ב-${formatDate(item.last_completed_at)}`
        : null,
    };
  }
  if (item.status === "missed") {
    return {
      icon: "closeCircle",
      tone: "danger",
      headline: "לא הוגש",
      meta: item.available_until
        ? `נסגר ב-${formatDate(item.available_until)}`
        : null,
    };
  }
  if (!item.available_until) {
    return {
      icon: "clock",
      tone: "neutral",
      headline: "ללא מועד הגשה",
      meta: "אפשר להתחיל מתי שנוח לך",
    };
  }
  const view = deadlineView(item.available_until, now);
  return {
    icon: view.urgency === "calm" ? "clock" : "timer",
    tone: URGENCY_TONE[view.urgency],
    headline: view.lead,
    meta: `מועד הגשה · ${view.exact}`,
  };
}

const BAR_TONE: Record<StatusTone, string> = {
  success: "bg-[var(--success-soft)] text-[var(--fg-success)]",
  danger: "bg-[var(--danger-soft)] text-[var(--fg-danger)]",
  warning: "bg-[var(--warning-soft)] text-[var(--fg-warning)]",
  brand: "bg-[var(--brand-softer)] text-[var(--fg-brand-strong)]",
  neutral: "bg-white/45 text-[var(--body)]",
};

function StatusBar({ status, cta }: { status: FeedStatus; cta?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-4 py-2.5",
        BAR_TONE[status.tone]
      )}
    >
      <Icon name={status.icon} size={16} className="flex-none" />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate leading-tight",
            status.strong ? "text-[15px] font-bold" : "text-[13px] font-semibold"
          )}
        >
          {status.headline}
        </span>
        {status.meta && (
          <span className="block truncate text-[11px] opacity-75">{status.meta}</span>
        )}
      </span>
      {cta && (
        <span className="flex flex-none items-center gap-1 text-[13px] font-semibold text-[var(--fg-brand-strong)]">
          {cta}
          <Icon name="arrow" size={14} />
        </span>
      )}
    </div>
  );
}

/**
 * A quiz card in the student feed. Renders one of two shapes:
 *  - `missed` — a closed allocation the student never attempted at all. There is
 *    no page to send them to (the player/results reads would raise
 *    `not_assigned` for a closed, never-started allocation), so this is a plain,
 *    non-interactive card — no attempts-left chip, since no allowance exists for
 *    it, and no call to action, since there is nothing to act on.
 *  - everything else (`not_started`/`in_progress`/`completed`) — the clickable
 *    card, opened by a stretched link over the whole surface.
 */
export function QuizCard({ item }: { item: StudentFeedItem }) {
  const heading = feedHeading(item);
  const status = feedStatus(item);
  const missed = item.status === "missed";
  const badge = missed
    ? { text: "פוספס", variant: "danger" as const }
    : badgeFor(item);
  const duration = durationChipText(item);

  return (
    <div
      className={cn(
        "glass relative flex h-full flex-col",
        !missed &&
          "group transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[var(--glass-bg-hover)]"
      )}
    >
      {!missed && (
        <Link
          href={hrefFor(item)}
          aria-label={`${ctaFor(item)} — ${heading}`}
          className="absolute inset-0 z-10 rounded-[inherit]"
        />
      )}

      <QuizThumb youtubeVideoId={item.youtube_video_id} playAffordance={!missed}>
        {missed && <div className="absolute inset-0 bg-white/45" />}
        <span className="absolute end-2 top-2">
          <Badge variant={badge.variant} pill>
            {badge.text}
          </Badge>
        </span>
        {duration && (
          <ThumbChip className="bottom-2 start-2">
            <Icon name="clock" size={12} label="אורך" />
            <span className="tabular-nums">{duration}</span>
          </ThumbChip>
        )}
        {!missed && (
          <ThumbChip className="bottom-2 end-2">
            <Icon name="refresh" size={12} label="ניסיונות" />
            {attemptsChipText(item)}
          </ThumbChip>
        )}
      </QuizThumb>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3
          className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--heading)]"
          title={heading}
        >
          {heading}
        </h3>
        <p className="truncate text-xs text-[var(--body-subtle)]">
          {item.class_name}
          {item.teacher_name && ` · ${item.teacher_name}`}
        </p>
      </div>

      <StatusBar status={status} cta={missed ? undefined : ctaFor(item)} />
    </div>
  );
}
