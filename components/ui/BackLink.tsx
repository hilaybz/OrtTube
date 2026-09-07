import Link from "next/link";
import { cn } from "./cn";
import { Icon } from "./Icon";
import { resolveBackTarget } from "./backTarget";

export function BackLink({
  href,
  label,
  from,
  className,
}: {
  href: string;
  label: string;
  from?: string | string[] | null;
  className?: string;
}) {
  const target = resolveBackTarget(from, { href, label });
  return (
    <Link
      href={target.href}
      className={cn(
        "group -ms-1.5 inline-flex w-fit items-center gap-1 rounded-[var(--radius-d)] px-1.5 py-1 text-sm font-medium text-[var(--body)] transition-colors hover:bg-[var(--neutral-quaternary)] hover:text-[var(--heading)]",
        className
      )}
    >
      <Icon
        name="chevronRight"
        size={16}
        className="flex-none transition-transform group-hover:translate-x-0.5"
      />
      {target.label}
    </Link>
  );
}
