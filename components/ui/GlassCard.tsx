import { cn } from "./cn";

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
