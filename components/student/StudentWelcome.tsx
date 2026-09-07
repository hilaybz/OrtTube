import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { formatToday, greetingFor } from "@/lib/datetime";
import type { StudentFeedItem } from "@/lib/classes";
import { feedHeading, feedOutlook } from "@/lib/studentFeedFilters";
import { deadlineView } from "./deadline";
import { hrefFor } from "./QuizCard";

const WASH =
  "radial-gradient(38% 120% at 100% 0%, rgba(184,255,217,0.55), transparent 70%)," +
  "radial-gradient(34% 110% at 0% 100%, rgba(216,180,254,0.45), transparent 70%)";

function subtitleFor(pending: number): string {
  if (pending === 0) return "אין חידונים שממתינים לך כרגע.";
  if (pending === 1) return "חידון אחד ממתין לך.";
  return `${pending} חידונים ממתינים לך.`;
}

export function StudentWelcome({
  name,
  items,
  now,
}: {
  name: string | null;
  items: StudentFeedItem[];
  now: Date;
}) {
  const { pending, next } = feedOutlook(items);
  const due = next?.available_until ? deadlineView(next.available_until, now) : null;

  return (
    <header className="glass p-6 sm:p-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ background: WASH }}
      />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--body-subtle)]">
            {formatToday(now)}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
            {greetingFor(now)}
            {name ? `, ${name}` : ""}
          </h1>
          <p className="mt-2 max-w-prose text-[var(--body)]">{subtitleFor(pending)}</p>
        </div>
        {next && due && (
          <Link
            href={hrefFor(next)}
            className="inline-flex max-w-full items-center gap-3 rounded-[var(--radius)] border border-[var(--brand-soft)] bg-[var(--brand-softer)] px-4 py-3 transition-colors hover:bg-[var(--brand-soft)]"
          >
            <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-white/70">
              <Icon name="play" size={16} className="text-[var(--fg-brand-strong)]" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium text-[var(--body-subtle)]">
                הבא בתור · {due.lead}
              </span>
              <span className="block truncate font-semibold text-[var(--fg-brand-strong)]">
                {feedHeading(next)}
              </span>
            </span>
          </Link>
        )}
      </div>
    </header>
  );
}
