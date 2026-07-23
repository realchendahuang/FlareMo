import { CircleAlertIcon, InboxIcon, Loader2Icon } from "lucide-react";
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

export function MemoList({
  isLoading,
  hasError,
  hasNextPage,
  isFetchingNextPage,
  memos,
  attachmentsByMemo,
  sharesByMemo,
  searchQuery,
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
      <div className="flex flex-col gap-4 pt-2 motion-safe:animate-fade">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
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
          <EmptyDescription>{t("list.emptyDescription")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <div className="flex flex-col divide-y motion-safe:animate-fade">
        {memos.map((memo, index) => (
          <MemoListItem
            attachments={attachmentsByMemo.get(memo.name) ?? []}
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
            {isFetchingNextPage ? t("list.loadingMore") : t("list.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}

function MemoListItem({
  memo,
  attachments,
  share,
  searchQuery,
  index,
  onArchive,
  onPin,
  onShare,
  onUpdate,
  onTrash,
  onRestore,
  onHardDelete,
  onTagClick,
}: Omit<
  MemoListProps,
  | "isLoading"
  | "hasError"
  | "hasNextPage"
  | "isFetchingNextPage"
  | "memos"
  | "attachmentsByMemo"
  | "sharesByMemo"
  | "onLoadMore"
  | "onRetry"
> & {
  memo: Memo;
  attachments: Attachment[];
  share?: Share;
  searchQuery?: string;
  index: number;
}) {
  const shareUrl = share
    ? `${globalThis.location.origin}/share/${share.token}`
    : undefined;
  return (
    <MemoCard
      attachments={attachments}
      index={index}
      memo={memo}
      searchQuery={searchQuery}
      share={share}
      shareUrl={shareUrl}
      onArchive={onArchive}
      onHardDelete={onHardDelete}
      onPin={onPin}
      onRestore={onRestore}
      onShare={onShare}
      onTagClick={onTagClick}
      onTrash={onTrash}
      onUpdate={onUpdate}
    />
  );
}
