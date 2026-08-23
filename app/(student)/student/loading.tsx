import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

/**
 * What the student sees while their feed is being read.
 *
 * The feed is a dynamic, session-scoped route, so nothing about it can be
 * prerendered and every visit waits on the server. This boundary is what turns
 * that wait into a navigation that has visibly started: without it Next has no
 * shell to prefetch and nothing to show, so pressing a link leaves the previous
 * screen sitting there and the app reads as unresponsive.
 *
 * It mirrors the real page's shape — welcome panel, control bar, one section of
 * cards — so the arriving content settles into the layout rather than replacing
 * it.
 */
export default function StudentFeedLoading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 py-2">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-20 w-full" />
      <section>
        <Skeleton className="mb-3 h-6 w-32" />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
