import { Skeleton } from "@/components/ui/Skeleton";

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
