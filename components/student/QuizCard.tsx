import Link from "next/link";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { StudentFeedItem } from "@/lib/classes";
import { feedHeading } from "@/lib/studentFeedFilters";
import { quizDurationMinutes } from "@/lib/quizDuration";
import { formatGrade, gradeOf } from "./grade";
import { StatusBlock, type StatusTone } from "./StatusBlock";
import { formatDate } from "@/lib/datetime";
import { deadlineView, URGENCY_TONE } from "./deadline";

export function attemptsNote(item: StudentFeedItem): string {
  return item.max_attempts != null
    ? `נותרו ${item.attempts_left} מתוך ${item.max_attempts} ניסיונות`
    : "ניסיונות ללא הגבלה";
}

/**
 * Badge shown on a not-started/in-progress/completed card (never `missed` — see
 * `QuizCard`). It names the state and nothing else: the grade a finished quiz
 * earned is the card's headline figure and belongs in the status block, where it
 * gets the room and the emphasis a grade deserves, rather than shrunk into a
 * corner pill that also has to carry the word "הושלם".
 */
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
  /** The headline is a figure worth sizing up — only a grade ever is. */
  strong?: boolean;
}

/**
 * The status block's content for one feed card — pure, so the wording of every
 * state can be pinned by unit tests rather than read off a rendered card.
 *
 * Each status answers a different question, and the block answers whichever one
 * the student actually has: a finished quiz answers "what did I get?", a missed
 * one "when did I lose it?", and one still open "how long do I have?".
 */
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

function ClassTeacherLine({ item }: { item: StudentFeedItem }) {
  return (
    <p className="text-xs text-[var(--body-subtle)]">
      {item.class_name}
      {item.teacher_name && ` · ${item.teacher_name}`}
    </p>
  );
}

/**
 * Length and attempt allowance on one quiet line — two small facts that used to
 * take a paragraph each. The duration half omits itself when nothing can be
 * shown (an unrestricted quiz whose video length isn't known yet — see
 * `lib/quizDuration.ts`).
 */
function MetaLine({ item }: { item: StudentFeedItem }) {
  const d = quizDurationMinutes(item);
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--body-subtle)]">
      {d && (
        <>
          <span>
            {d.estimated && "~"}
            <span className="tabular-nums">{d.minutes}</span> דקות
          </span>
          <span aria-hidden="true">·</span>
        </>
      )}
      <span>{attemptsNote(item)}</span>
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
 * A quiz card in the student feed. Renders one of two shapes:
 *  - `missed` — a closed allocation the student never attempted at all. There is
 *    no page to send them to (the player/results reads would raise
 *    `not_assigned` for a closed, never-started allocation), so this is a plain,
 *    non-interactive card — no attempts-left UI, since none exists for it.
 *  - everything else (`not_started`/`in_progress`/`completed`) — the clickable
 *    card, carrying the class + teacher name, the length/attempts line, and the
 *    status block for whichever question this state raises (see `feedStatus`).
 *
 * Both shapes end in the same status block rather than a stray sentence: it is
 * the part a student reads first, so it is the part with a surface, an icon and
 * a colour that means something.
 */
export function QuizCard({ item }: { item: StudentFeedItem }) {
  const heading = feedHeading(item);
  const status = feedStatus(item);

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
          <StatusBlock
            className="mt-auto"
            icon={status.icon}
            tone={status.tone}
            headline={status.headline}
            meta={status.meta}
          />
        </div>
      </GlassCard>
    );
  }

  const badge = badgeFor(item);
  const cta = ctaFor(item);

  return (
    <Link href={hrefFor(item)} className="group block focus-visible:outline-none">
      <GlassCard interactive className="flex h-full flex-col gap-3 p-0">
        <Thumbnail youtubeVideoId={item.youtube_video_id} badge={badge} interactive />
        <div className="flex flex-1 flex-col gap-2 px-4 pb-4">
          <h3 className="font-semibold text-[var(--heading)]">{heading}</h3>
          <ClassTeacherLine item={item} />
          <MetaLine item={item} />
          <StatusBlock
            className="mt-auto"
            icon={status.icon}
            tone={status.tone}
            headline={status.headline}
            meta={status.meta}
            strong={status.strong}
          />
          <span className="inline-flex items-center gap-1.5 pt-0.5 text-sm font-medium text-[var(--fg-brand)]">
            {cta}
            <Icon name="arrow" size={16} />
          </span>
        </div>
      </GlassCard>
    </Link>
  );
}
