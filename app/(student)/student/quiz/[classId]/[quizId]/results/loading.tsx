import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Results' own boundary rather than the player's: the score screen is a column
 * of cards, not a video stage, and inheriting the player's placeholder would
 * promise a video that never appears.
 */
export default function QuizResultsLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-2">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
