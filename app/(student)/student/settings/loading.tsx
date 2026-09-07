import { Skeleton } from "@/components/ui/Skeleton";

export default function StudentSettingsLoading() {
  return (
    <div className="mx-auto max-w-2xl py-2">
      <Skeleton className="mb-1 h-9 w-40" />
      <Skeleton className="mb-6 h-5 w-64" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
