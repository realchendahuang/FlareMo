import { InboxIcon } from "lucide-react";
import type { Attachment, Memo, MemoVisibility, Share } from "@/api";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { MemoCard } from "./memo-card";

type MemoListProps = {
  hasError?: boolean;
  isLoading: boolean;
  memos: Memo[];
  attachmentsByMemo: Map<string, Attachment[]>;
  sharesByMemo: Map<string, Share>;
  onArchive: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onShare: (id: string) => void;
  onUpdate: (
    id: string,
    input: { content: string; visibility: MemoVisibility },
  ) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onHardDelete: (id: string) => void;
};

export function MemoList({
  isLoading,
  hasError,
  memos,
  attachmentsByMemo,
  sharesByMemo,
  onArchive,
  onPin,
  onShare,
  onUpdate,
  onTrash,
  onRestore,
  onHardDelete,
}: MemoListProps) {
  const { t } = useI18n();

  if (isLoading && !hasError) {
    return (
      <div className="flex flex-col gap-4 pt-2 motion-safe:animate-[flaremo-fade_160ms_ease-out_both]">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    );
  }

  if (memos.length === 0) {
    return (
      <Empty className="min-h-64 text-muted-foreground motion-safe:animate-[flaremo-rise_180ms_ease-out_both]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>{t("list.emptyTitle")}</EmptyTitle>
          <EmptyDescription>{t("list.emptyDescription")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col divide-y motion-safe:animate-[flaremo-fade_160ms_ease-out_both]">
      {memos.map((memo) => (
        <MemoListItem
          attachments={attachmentsByMemo.get(memo.name) ?? []}
          key={memo.name}
          memo={memo}
          share={sharesByMemo.get(memo.name)}
          onArchive={onArchive}
          onHardDelete={onHardDelete}
          onPin={onPin}
          onRestore={onRestore}
          onShare={onShare}
          onTrash={onTrash}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  );
}

function MemoListItem({
  memo,
  attachments,
  share,
  onArchive,
  onPin,
  onShare,
  onUpdate,
  onTrash,
  onRestore,
  onHardDelete,
}: Omit<
  MemoListProps,
  "isLoading" | "memos" | "attachmentsByMemo" | "sharesByMemo"
> & {
  memo: Memo;
  attachments: Attachment[];
  share?: Share;
}) {
  const shareUrl = share
    ? `${globalThis.location.origin}/share/${share.token}`
    : undefined;
  return (
    <MemoCard
      attachments={attachments}
      memo={memo}
      share={share}
      shareUrl={shareUrl}
      onArchive={onArchive}
      onHardDelete={onHardDelete}
      onPin={onPin}
      onRestore={onRestore}
      onShare={onShare}
      onTrash={onTrash}
      onUpdate={onUpdate}
    />
  );
}
