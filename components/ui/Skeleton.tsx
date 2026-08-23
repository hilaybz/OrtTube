import { cn } from "./cn";

/**
 * A placeholder block for content a route is still fetching.
 *
 * Deliberately plain: a skeleton's whole job is to hold the page's shape for
 * the moment before the real thing arrives, so it borrows the glass surfaces'
 * own translucency rather than introducing a colour of its own, and it never
 * carries text. Anything a reader could try to read is a thing they will read
 * twice.
 *
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

/**
 * A skeleton in the shape of a `GlassCard`, for the common case where the thing
 * being waited on is a card in a list or grid.
 */
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
