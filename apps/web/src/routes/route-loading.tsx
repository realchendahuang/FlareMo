import { Skeleton } from "@/components/ui/skeleton";

export function RouteLoading() {
  return (
    <div className="min-h-svh bg-background px-4 py-5 sm:py-8 motion-safe:animate-fade">
      <main className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="size-6 rounded-md" />
        </div>
        <div className="pt-2">
          <Skeleton className="h-6 w-36 rounded" />
        </div>
        <div className="flex flex-col gap-3 pt-2">
          <div className="flex flex-col gap-2.5 rounded-xl border border-border/50 bg-card/50 p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="h-4 w-12 rounded" />
            </div>
            <div className="space-y-2 py-1">
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-3/4 rounded" />
            </div>
          </div>
          <div className="flex flex-col gap-2.5 rounded-xl border border-border/50 bg-card/50 p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-4 w-12 rounded" />
            </div>
            <div className="space-y-2 py-1">
              <Skeleton className="h-4 w-5/6 rounded" />
              <Skeleton className="h-4 w-2/3 rounded" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
