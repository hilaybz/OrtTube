import { IconLink } from "@/components/ui/IconButton";
import { withBackTarget } from "@/components/ui/backTarget";
import { formatToday, greetingFor } from "@/lib/datetime";

/**
 * A brighter wash over the panel, in the app gradient's own lilac and mint.
 * Written as an inline style rather than a token because it exists once, here:
 * it is this screen's welcome, not a reusable surface treatment.
 */
const WASH =
  "radial-gradient(38% 120% at 100% 0%, rgba(184,255,217,0.55), transparent 70%)," +
  "radial-gradient(34% 110% at 0% 100%, rgba(216,180,254,0.45), transparent 70%)";

/**
 * The overview's opening panel — the first thing a teacher sees after signing
 * in. A time-of-day greeting by name, today's date, a one-line read on where
 * things stand, and the one action worth putting in front of them (author a
 * quiz). Built on the raw `.glass` surface rather than `GlassCard` so it can
 * carry the roomier padding a page header wants.
 */
export function WelcomeHeader({
  name,
  subtitle,
  now,
}: {
  name: string | null;
  subtitle: string;
  now: Date;
}) {
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
          <p className="mt-2 max-w-prose text-[var(--body)]">{subtitle}</p>
        </div>
        {/* The one action on the overview: author a quiz. `label` is both the
            accessible name and the hover text, so the "+" always says what it
            makes. It points upward because the button sits on the panel's
            bottom edge — with a bubble below it, there is nothing between the
            trigger and the end of the surface for the label to sit on.

            The origin travels with the link so the new-quiz page — and the
            editor it hands off to — send the teacher back here rather than to
            the quiz library they never visited. */}
        <IconLink
          name="plus"
          label="חידון חדש"
          href={withBackTarget("/dashboard/quizzes/new", "overview")}
          variant="brand"
          size="lg"
          tooltipPlacement="top"
        />
      </div>
    </header>
  );
}
