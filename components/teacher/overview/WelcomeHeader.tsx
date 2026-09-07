import { IconLink } from "@/components/ui/IconButton";
import { withBackTarget } from "@/components/ui/backTarget";
import { formatToday, greetingFor } from "@/lib/datetime";

const WASH =
  "radial-gradient(38% 120% at 100% 0%, rgba(184,255,217,0.55), transparent 70%)," +
  "radial-gradient(34% 110% at 0% 100%, rgba(216,180,254,0.45), transparent 70%)";

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
