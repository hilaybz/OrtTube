import { cn } from "./cn";

/**
 * A frosted glass surface (see `.glass` in globals.css). `interactive` adds the
 * hover treatment for clickable cards; static cards get no hover per the spec.
 */
export function GlassCard({
  as: As = "div",
  interactive = false,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  as?: React.ElementType;
  interactive?: boolean;
}) {
  return (
    <As
      className={cn(
        "glass p-5",
        interactive &&
          "cursor-pointer transition-colors hover:bg-[var(--glass-bg-hover)]",
        className
      )}
      {...props}
    >
      {children}
    </As>
  );
}
