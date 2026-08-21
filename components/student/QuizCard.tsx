import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import type { StudentFeedItem } from "@/lib/classes";
import { feedHeading } from "@/lib/studentFeedFilters";
import { quizDurationMinutes } from "@/lib/quizDuration";
import { formatDate, formatTime, isToday } from "@/lib/datetime";

/**
 * "עד 18:00 · היום" for a deadline later today, otherwise "עד 18:00 · 14.3".
 * Only ever called on a still-open deadline (not-started/in-progress cards),
 * so no "overdue" wording is needed here — a closed one is `formatClosedDate`.
 */
function formatDueDate(iso: string): string {
  const time = formatTime(iso);
  if (isToday(iso)) return `עד ${time} · היום`;
  return `עד ${time} · ${formatDate(iso)}`;
}

/** Past-tense sibling of `formatDueDate`, for a `missed` card's closed window. */
function formatClosedDate(iso: string): string {
  return `הסתיים ב-${formatDate(iso)}`;
}

export function attemptsNote(item: StudentFeedItem): string {
  return item.max_attempts != null
    ? `נותרו ${item.attempts_left} מתוך ${item.max_attempts} ניסיונות`
    : "ניסיונות ללא הגבלה";
}

/** Badge shown on a not-started/in-progress/completed card (never `missed` — see `QuizCard`). */
export function badgeFor(item: StudentFeedItem): {
  text: string;
  variant: "brand" | "gray" | "success";
} {
  if (item.status === "in_progress") return { text: "בתהליך", variant: "brand" };
  if (item.status === "completed") {
    const text =
      item.last_num_questions != null && item.last_num_questions > 0
        ? `${Math.round(((item.last_num_correct ?? 0) / item.last_num_questions) * 100)}%`
        : "הושלם";
    return { text, variant: "success" };
  }
  return { text: "טרם התחלת", variant: "gray" };
}

export function ctaFor(item: StudentFeedItem): string {
  if (item.status === "in_progress") return "המשך";
  if (item.status === "completed") {
    const canRetry = item.is_live && (item.attempts_left == null || item.attempts_left > 0);
    return canRetry ? "ניסיון נוסף" : "צפייה בתוצאות";
  }
  return "התחלה";
}

function ClassTeacherLine({ item }: { item: StudentFeedItem }) {
  return (
    <p className="text-xs text-[var(--body-subtle)]">
      {item.class_name}
      {item.teacher_name && ` · ${item.teacher_name}`}
    </p>
  );
}

/** Omits itself entirely when nothing can be shown (unrestricted quiz whose
 * video length isn't known yet) — see `lib/quizDuration.ts`. */
function DurationLine({ item }: { item: StudentFeedItem }) {
  const d = quizDurationMinutes(item);
  if (!d) return null;
  return (
    <p className="text-xs text-[var(--body-subtle)]">
      {d.estimated && "~"}
      <span className="tabular-nums">{d.minutes}</span> דקות
    </p>
  );
}

function Thumbnail({
  youtubeVideoId,
  badge,
  interactive,
}: {
  youtubeVideoId: string;
  badge: { text: string; variant: "brand" | "gray" | "success" | "danger" };
  interactive: boolean;
}) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-t-[var(--radius)] bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`}
        alt=""
        className={
          interactive
            ? "h-full w-full object-cover opacity-95 transition group-hover:scale-[1.03]"
            : "h-full w-full object-cover opacity-60"
        }
      />
      <span className="absolute end-2 top-2">
        <Badge variant={badge.variant} pill>
          {badge.text}
        </Badge>
      </span>
    </div>
  );
}

/**
 * A quiz card in the student feed (backlog: two-section redesign). Renders
 * one of two shapes:
 *  - `missed` — a closed allocation the student never attempted at all
 *    (issue #69's student-side gap). There is no page to send them to (the
 *    player/results reads would raise `not_assigned` for a closed, never-
 *    started allocation), so this is a plain, non-interactive card — no
 *    grade/attempts-left UI, since neither exists for it.
 *  - everything else (`not_started`/`in_progress`/`completed`) — the
 *    original clickable card shape, now also carrying the class + teacher
 *    name, with the badge/CTA/attempts-note derived per status.
 */
export function QuizCard({ item }: { item: StudentFeedItem }) {
  const heading = feedHeading(item);

  if (item.status === "missed") {
    return (
      <GlassCard className="flex h-full flex-col gap-3 p-0">
        <Thumbnail
          youtubeVideoId={item.youtube_video_id}
          badge={{ text: "פוספס", variant: "danger" }}
          interactive={false}
        />
        <div className="flex flex-1 flex-col gap-2 px-4 pb-4">
          <h3 className="font-semibold text-[var(--heading)]">{heading}</h3>
          <ClassTeacherLine item={item} />
          {item.available_until && (
            <p className="text-xs text-[var(--body-subtle)]">
              {formatClosedDate(item.available_until)}
            </p>
          )}
        </div>
      </GlassCard>
    );
  }

  const badge = badgeFor(item);
  const cta = ctaFor(item);

  return (
    <Link
      href={`/student/quiz/${item.class_id}/${item.quiz_id}`}
      className="group block focus-visible:outline-none"
    >
      <GlassCard interactive className="flex h-full flex-col gap-3 p-0">
        <Thumbnail youtubeVideoId={item.youtube_video_id} badge={badge} interactive />
        <div className="flex flex-1 flex-col gap-2 px-4 pb-4">
          <h3 className="font-semibold text-[var(--heading)]">{heading}</h3>
          <ClassTeacherLine item={item} />
          <DurationLine item={item} />
          <p className="text-xs text-[var(--body-subtle)]">{attemptsNote(item)}</p>
          {item.status !== "completed" && item.available_until && (
            <p className="text-xs font-medium text-[var(--fg-warning)]">
              {formatDueDate(item.available_until)}
            </p>
          )}
          <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-[var(--fg-brand)]">
            {cta}
            <Icon name="arrow" size={16} />
          </span>
        </div>
      </GlassCard>
    </Link>
  );
}
