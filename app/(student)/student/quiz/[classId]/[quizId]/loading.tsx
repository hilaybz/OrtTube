import { Skeleton } from "@/components/ui/Skeleton";

/**
 * What the student sees between pressing a quiz card and the player arriving.
 *
 * This is the wait the feed's cards lead into, and the one worth covering
 * first: opening a quiz is the student's main action, and the route has to
 * resolve their attempt state on the server before it can render anything. The
 * shape is the player's opening screen — back link, then the video stage with
 * its panel beside it — so the video lands where the placeholder stood.
 */
export default function QuizPlayerLoading() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 py-2">
      <Skeleton className="h-5 w-28" />
      <div className="flex flex-col gap-4 lg:flex-row">
        <Skeleton className="aspect-video w-full lg:flex-1" />
        <div className="flex flex-col gap-3 lg:w-72">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </div>
  );
}
