import type { Memory } from "@/api";
import { QueryErrorState } from "@/components/query-error-state";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { MemoryCard } from "./memory-card";

export function MemoryList({
  memories,
  loading,
  hasError,
  isRetrying,
  onRetry,
  onMutated,
  emptyTitle,
  hideProject = false,
  review = false,
  onSelectProject,
}: {
  memories: Memory[];
  loading: boolean;
  hasError?: boolean;
  isRetrying?: boolean;
  onRetry?: () => void;
  onMutated: () => void;
  emptyTitle?: string;
  /** Inside a project view the project chip on every card is noise. */
  hideProject?: boolean;
  review?: boolean;
  onSelectProject?: (projectKey: string) => void;
}) {
  const { t } = useI18n();

  if (hasError) {
    return (
      <QueryErrorState
        className="min-h-56"
        isRetrying={isRetrying}
        onRetry={onRetry ?? (() => undefined)}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <Empty className="min-h-40 border border-dashed">
        <EmptyHeader>
          <EmptyTitle className="text-sm font-normal text-muted-foreground">
            {emptyTitle ??
              (review ? t("memory.reviewEmpty") : t("memory.listEmpty"))}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {memories.map((memory) => (
        <MemoryCard
          key={memory.id}
          memory={memory}
          hideProject={hideProject}
          review={review}
          onSelectProject={onSelectProject}
          onMutated={onMutated}
        />
      ))}
    </div>
  );
}
