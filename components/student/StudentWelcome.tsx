import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { formatToday, greetingFor } from "@/lib/datetime";
import type { StudentFeedItem } from "@/lib/classes";
import { feedHeading, feedOutlook } from "@/lib/studentFeedFilters";
import { deadlineView } from "./deadline";
import { hrefFor } from "./QuizCard";

/**
 * The same brighter wash the teacher's welcome panel carries, in the app
 * gradient's own lilac and mint. Inline rather than a token because it exists
 * on exactly these two screens: it is a welcome, not a reusable surface.
 */
const WASH =
  "radial-gradient(38% 120% at 100% 0%, rgba(184,255,217,0.55), transparent 70%)," +
  "radial-gradient(34% 110% at 0% 100%, rgba(216,180,254,0.45), transparent 70%)";

/**
 * What the greeting says under the name. A student's version of the teacher's
 * "one line on where things stand": how much is still owed, since that is the
 * only cross-quiz figure a student acts on. Class counts are the teacher's
 * question — a student already knows which classes they are in.
 */
function subtitleFor(pending: number): string {
  if (pending === 0) return "אין חידונים שממתינים לך כרגע.";
  if (pending === 1) return "חידון אחד ממתין לך.";
  return `${pending} חידונים ממתינים לך.`;
}

/**
 * The student feed's opening panel — the same shape and register as the
 * teacher's overview header (`components/teacher/overview/WelcomeHeader.tsx`),
 * whose greeting and date helpers it imports rather than restates, with the one
 * action a student has on this screen: opening whatever is due next.
 *
 * "Due next" earns the button because it is the whole question a student brings
 * to their feed. When nothing has a deadline there is nothing to be next, and
 * the panel is a greeting and a count — no invented urgency.
 */
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
          // The deadline travels with the link: a student deciding whether to
          // start now needs the "when" next to the "what", not one screen away.
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
