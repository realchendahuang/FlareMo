import { CircleAlertIcon, InboxIcon, Loader2Icon } from "lucide-react";
import { memo } from "react";
import type { Attachment, Memo, MemoVisibility, Share } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { MemoCard } from "./memo-card";

type MemoListProps = {
  hasError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  memos: Memo[];
  attachmentsByMemo: Map<string, Attachment[]>;
  sharesByMemo: Map<string, Share>;
  searchQuery?: string;
  /** Overrides the generic empty-state copy (e.g. semantic search). */
  emptyDescription?: string;
  onArchive: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onShare: (id: string) => void;
  onUpdate: (
    id: string,
    input: { content: string; visibility: MemoVisibility },
  ) => Promise<void>;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onHardDelete: (id: string) => Promise<void>;
  onLoadMore: () => void;
  onRetry: () => void;
  onTagClick?: (tag: string) => void;
};

function MemoCardSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border/50 bg-card/50 px-3.5 py-4 shadow-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton className="h-3 w-20 rounded" />
        </div>
        <Skeleton className="h-4 w-12 rounded" />
      </div>
      <div className="space-y-1.5 py-1">
        <Skeleton className="h-3.5 w-full rounded" />
        <Skeleton className="h-3.5 w-3/4 rounded" />
      </div>
      <div className="flex items-center gap-1.5 pt-0.5">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    </div>
  );
}

export const MemoList = memo(function MemoList({
  isLoading,
  hasError,
  hasNextPage,
  isFetchingNextPage,
  memos,
  attachmentsByMemo,
  sharesByMemo,
  searchQuery,
  emptyDescription,
  onArchive,
  onPin,
  onShare,
  onUpdate,
  onTrash,
  onRestore,
  onHardDelete,
  onLoadMore,
  onRetry,
  onTagClick,
}: MemoListProps) {
  const { t } = useI18n();

  if (isLoading && !hasError) {
    return (
      <div className="flex flex-col gap-2.5 pt-1 motion-safe:animate-fade">
        <MemoCardSkeleton />
        <MemoCardSkeleton />
        <MemoCardSkeleton />
      </div>
    );
  }

  if (hasError) {
    return (
      <Empty className="min-h-64 text-muted-foreground motion-safe:animate-rise">
        <EmptyHeader>
          <EmptyMedia
            className="bg-destructive/10 text-destructive"
            variant="icon"
          >
            <CircleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{t("list.errorTitle")}</EmptyTitle>
          <EmptyDescription>{t("list.errorDescription")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (memos.length === 0) {
    return (
      <Empty className="min-h-64 text-muted-foreground motion-safe:animate-rise">
        <EmptyHeader>
          <EmptyMedia
            className="bg-flame-100 text-flame-600 dark:bg-flame-400/12 dark:text-flame-300"
            variant="icon"
          >
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>{t("list.emptyTitle")}</EmptyTitle>
          <EmptyDescription>
            {emptyDescription ?? t("list.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2.5 motion-safe:animate-fade">
        {memos.map((memo, index) => (
          <MemoCard
            attachments={attachmentsByMemo.get(memo.name) ?? []}
            canManage={memo.can_manage === true}
            index={index}
            key={memo.name}
            memo={memo}
            searchQuery={searchQuery}
            share={sharesByMemo.get(memo.name)}
            onArchive={onArchive}
            onHardDelete={onHardDelete}
            onPin={onPin}
            onRestore={onRestore}
            onShare={onShare}
            onTagClick={onTagClick}
            onTrash={onTrash}
            onUpdate={onUpdate}
          />
        ))}
      </div>
      {hasNextPage && (
        <div className="flex justify-center py-5">
          <Button
            disabled={isFetchingNextPage}
            size="sm"
            variant="outline"
            onClick={onLoadMore}
          >
            {isFetchingNextPage && (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            )}
            {isFetchingNextPage ? t("common.loading") : t("list.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
});
