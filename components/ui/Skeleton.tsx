import { cn } from "./cn";

/**
 * `aria-hidden` because the loading state is announced by the boundary around
 * it, not by each block inside it — a screen reader hearing twelve "loading"
 * regions has learned less than one.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-xl bg-white/45", className)}
    />
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("glass flex flex-col gap-3 p-5", className)}>
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-6 w-4/5" />
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="mt-2 h-9 w-full" />
    </div>
  );
}
