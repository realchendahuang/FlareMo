import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleAlertIcon, InboxIcon, SearchIcon } from "lucide-react";
import {
  lazy,
  memo,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Attachment, Memo, MemoVisibility, Share } from "@/api";
import { MemoVisibilityDialog } from "@/components/memo-visibility-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import { getMemoResourceId } from "@/lib/memo";
import { MemoCard } from "./memo-card";

// The share-image dialog pulls in html-to-image and the plugin card registry;
// keep it out of the entry chunk — it only downloads on first open.
const ShareImageDialog = lazy(() =>
  import("@/components/share-image-dialog").then((module) => ({
    default: module.ShareImageDialog,
  })),
);

/** Shared empty list so attachment-less memos keep a stable prop reference. */
const EMPTY_ATTACHMENTS: Attachment[] = [];
/** Shared empty index list so the extractor keeps a stable reference. */
const EMPTY_INDEXES: number[] = [];

/**
 * Below this many rendered cards the plain map is cheaper than virtualization:
 * the whole list is mounted anyway, and the extra wrappers would only add
 * measurement work. Above it, a few hundred cards is where the DOM — not the
 * network — becomes the bottleneck.
 */
const VIRTUALIZE_THRESHOLD = 40;

/** Overscan in cards, so a fast scroll never flashes an empty gap. */
const VIRTUAL_OVERSCAN = 6;

/** Gap between cards; mirrors the `gap-2.5` class on the plain list. */
const CARD_GAP_PX = 10;

type MemoListProps = {
  hasError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  isUpdating?: boolean;
  isRetrying?: boolean;
  isPaginationError?: boolean;
  memos: Memo[];
  attachmentsByMemo: Map<string, Attachment[]>;
  sharesByMemo: Map<string, Share>;
  searchQuery?: string;
  focusedMemoId?: string | null;
  /** Overrides the generic empty-state copy (e.g. semantic search). */
  emptyDescription?: string;
  emptyTitle?: string;
  onClearFilters?: () => void;
  onArchive: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  /** Creates (or reuses) the memo's public share and resolves with it. */
  onShare: (id: string) => Promise<Share>;
  /** Tear down the public link after a memo leaves "public". */
  onRevokeShare?: (share: Share) => void;
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

type VirtualizedCardsProps = {
  attachmentsByMemo: Map<string, Attachment[]>;
  editingMemoNames: Set<string>;
  focusedMemoId?: string | null;
  isUpdating: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  memos: Memo[];
  onArchive: (id: string) => void;
  onEditingChange: (memoName: string, editing: boolean) => void;
  onHardDelete: (id: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => void;
  onRequestDelete: (memo: Memo) => void;
  onRequestShareImage: (memo: Memo) => void;
  onRequestVisibility: (memo: Memo) => void;
  onRestore: (id: string) => void;
  onRevokeShare?: (share: Share) => void;
  onShare: (id: string) => Promise<Share>;
  onTagClick?: (tag: string) => void;
  onTrash: (id: string) => void;
  onUpdate: (
    id: string,
    input: { content: string; visibility: MemoVisibility },
  ) => Promise<void>;
  searchQuery?: string;
  sharesByMemo: Map<string, Share>;
};

/**
 * The long-timeline renderer.
 *
 * A few hundred mounted cards cost more than the network does: each one holds a
 * header, a body, an attachment gallery and its own observers, and the browser
 * keeps laying all of them out on every scroll. Virtualizing keeps the DOM at
 * roughly a screenful plus overscan, so scroll work stops scaling with history
 * length.
 *
 * Two behaviours are deliberate:
 * - Cards with an open editor are pinned into the rendered window. Unmounting
 *   one would drop the draft mid-typing, which is far worse than a slightly
 *   larger window.
 * - Measurement is dynamic: cards collapse, expand and swap in an editor, so
 *   heights are observed rather than assumed.
 */
function VirtualizedCards({
  attachmentsByMemo,
  editingMemoNames,
  focusedMemoId,
  isUpdating,
  listRef,
  memos,
  onArchive,
  onEditingChange,
  onHardDelete,
  onPin,
  onRequestDelete,
  onRequestShareImage,
  onRequestVisibility,
  onRestore,
  onRevokeShare,
  onShare,
  onTagClick,
  onTrash,
  onUpdate,
  searchQuery,
  sharesByMemo,
}: VirtualizedCardsProps) {
  // The timeline scrolls with the page's <main>, not with this element, so the
  // virtualizer is told to read that scroller. Both the scroller and the list's
  // offset inside it are only known after mount, so they are re-read on a
  // layout effect — a value captured during the first render would be null and
  // the list would measure against the wrong origin forever. Re-running when
  // the list length changes keeps the margin honest as the page above it
  // settles (banner appearing, skeleton swapping out).
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // Indexes of cards with an open editor. Computed once per memo/edit change
  // rather than inside the scroll-time range extractor.
  const editingIndexes = useMemo(() => {
    if (editingMemoNames.size === 0) return EMPTY_INDEXES;
    const indexes: number[] = [];
    memos.forEach((memo, index) => {
      if (editingMemoNames.has(memo.name)) indexes.push(index);
    });
    return indexes;
  }, [editingMemoNames, memos]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: listRef is a ref (its identity never changes) and `memos.length` is the deliberate re-measure trigger, not a value the effect reads.
  useLayoutEffect(() => {
    const element = listRef.current;
    const parent = element?.closest<HTMLElement>("main") ?? null;
    setScroller(parent);
    if (element && parent) {
      // Distance from the scroll container's content origin to this list. The
      // timeline renders a search box, chips and the "on this day" banner above
      // it, so a flat zero would offset every card by that height.
      const elementRect = element.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      setScrollMargin(elementRect.top - parentRect.top + parent.scrollTop);
    }
  }, [memos.length]);

  const virtualizer = useVirtualizer({
    count: memos.length,
    getScrollElement: () => scroller,
    estimateSize: () => 150,
    getItemKey: (index) => memos[index]?.name ?? index,
    overscan: VIRTUAL_OVERSCAN,
    gap: CARD_GAP_PX,
    scrollMargin,
    // `rangeExtractor` runs on every virtualizer state change, i.e. on every
    // scroll frame. Building the editing-index set inside it meant scanning all
    // loaded memos per frame once a single card was open; the indexes are
    // derived from props instead, so the extractor only merges two small sets.
    rangeExtractor: (range) => {
      const indexes = new Set<number>();
      for (let index = range.startIndex; index <= range.endIndex; index += 1) {
        indexes.add(index);
      }
      for (const index of editingIndexes) indexes.add(index);
      return [...indexes]
        .filter((index) => index >= 0 && index < memos.length)
        .sort((a, b) => a - b);
    },
  });

  // J/K keyboard navigation asks for a card by id. In a virtualized list that
  // card is often not mounted yet, so the shortcut hook's `scrollIntoView`
  // finds nothing; scrolling to the index is what materializes it.
  useEffect(() => {
    if (!focusedMemoId) return;
    const index = memos.findIndex(
      (memo) => (memo.id || memo.name) === focusedMemoId,
    );
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "auto" });
  }, [focusedMemoId, memos, virtualizer]);

  return (
    <div
      ref={listRef}
      aria-busy={isUpdating}
      className="relative motion-safe:animate-fade"
      data-virtualized="true"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const memo = memos[item.index];
        if (!memo) return null;
        return (
          <div
            data-index={item.index}
            key={item.key}
            ref={virtualizer.measureElement}
            style={{
              left: 0,
              position: "absolute",
              top: 0,
              transform: `translateY(${item.start - scrollMargin}px)`,
              width: "100%",
            }}
          >
            <MemoCard
              attachments={
                attachmentsByMemo.get(memo.name) ?? EMPTY_ATTACHMENTS
              }
              canManage={memo.can_manage === true}
              canGovern={memo.can_govern === true}
              index={item.index}
              isFocused={focusedMemoId === (memo.id || memo.name)}
              memo={memo}
              onArchive={onArchive}
              onEditingChange={onEditingChange}
              onHardDelete={onHardDelete}
              onPin={onPin}
              onRequestDelete={onRequestDelete}
              onRequestShareImage={onRequestShareImage}
              onRequestVisibility={onRequestVisibility}
              onRestore={onRestore}
              onRevokeShare={onRevokeShare}
              onShare={onShare}
              onTagClick={onTagClick}
              onTrash={onTrash}
              onUpdate={onUpdate}
              searchQuery={searchQuery}
              share={sharesByMemo.get(memo.name)}
            />
          </div>
        );
      })}
    </div>
  );
}

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
      <div className="flex flex-col gap-1.5 py-1">
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
  focusedMemoId,
  emptyDescription,
  emptyTitle,
  onClearFilters,
  isUpdating = false,
  isRetrying = false,
  isPaginationError = false,
  onArchive,
  onPin,
  onShare,
  onRevokeShare,
  onUpdate,
  onTrash,
  onRestore,
  onHardDelete,
  onLoadMore,
  onRetry,
  onTagClick,
}: MemoListProps) {
  const { t } = useI18n();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Memos holding an open editor: the virtualizer may never unmount these, or
  // the draft the user is typing disappears with the card.
  const [editingMemoNames, setEditingMemoNames] = useState<Set<string>>(
    () => new Set(),
  );

  const handleEditingChange = useCallback(
    (memoName: string, editing: boolean) => {
      setEditingMemoNames((previous) => {
        const has = previous.has(memoName);
        if (has === editing) return previous;
        const next = new Set(previous);
        if (editing) next.add(memoName);
        else next.delete(memoName);
        return next;
      });
    },
    [],
  );

  // Singleton dialog states to prevent hundreds of dialog DOM instances in long lists
  const [deleteTargetMemo, setDeleteTargetMemo] = useState<Memo | null>(null);
  const [shareImageMemo, setShareImageMemo] = useState<Memo | null>(null);
  const [visibilityMemo, setVisibilityMemo] = useState<Memo | null>(null);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || hasError) return;
    const element = sentinelRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore();
        }
      },
      { rootMargin: "300px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, hasError, onLoadMore]);

  if (isLoading && !hasError && memos.length === 0) {
    return (
      <div
        role="status"
        aria-label={t("common.loading")}
        aria-busy="true"
        className="flex flex-col gap-2.5 pt-1 motion-safe:animate-fade"
      >
        <MemoCardSkeleton />
        <MemoCardSkeleton />
        <MemoCardSkeleton />
      </div>
    );
  }

  if (hasError && memos.length === 0) {
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
          <Button
            disabled={isRetrying}
            size="sm"
            variant="outline"
            onClick={onRetry}
          >
            {isRetrying && <Spinner data-icon="inline-start" />}
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
            className="bg-accent text-accent-foreground"
            variant="icon"
          >
            {onClearFilters ? <SearchIcon /> : <InboxIcon />}
          </EmptyMedia>
          <EmptyTitle>{emptyTitle ?? t("list.emptyTitle")}</EmptyTitle>
          <EmptyDescription>
            {emptyDescription ?? t("list.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
        {onClearFilters && (
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={onClearFilters}>
              {t("common.clearFilters")}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }

  const retryNotice = hasError ? (
    <Alert className="flex items-center justify-between gap-3">
      <AlertDescription>
        {t(isPaginationError ? "list.loadMoreError" : "list.refreshError")}
      </AlertDescription>
      <Button
        disabled={isRetrying}
        size="sm"
        variant="outline"
        onClick={onRetry}
      >
        {isRetrying && <Spinner data-icon="inline-start" />}
        {t("common.retry")}
      </Button>
    </Alert>
  ) : null;

  return (
    <>
      {!isPaginationError && retryNotice}
      {isUpdating && (
        <div role="status" className="sr-only">
          <Spinner className="size-3.5" />
          {t("list.updating")}
        </div>
      )}
      {memos.length > VIRTUALIZE_THRESHOLD ? (
        <VirtualizedCards
          attachmentsByMemo={attachmentsByMemo}
          editingMemoNames={editingMemoNames}
          focusedMemoId={focusedMemoId}
          isUpdating={isUpdating}
          listRef={listRef}
          memos={memos}
          onArchive={onArchive}
          onEditingChange={handleEditingChange}
          onHardDelete={onHardDelete}
          onPin={onPin}
          onRequestDelete={setDeleteTargetMemo}
          onRequestShareImage={setShareImageMemo}
          onRequestVisibility={setVisibilityMemo}
          onRestore={onRestore}
          onRevokeShare={onRevokeShare}
          onShare={onShare}
          onTagClick={onTagClick}
          onTrash={onTrash}
          onUpdate={onUpdate}
          searchQuery={searchQuery}
          sharesByMemo={sharesByMemo}
        />
      ) : (
        <div
          aria-busy={isUpdating}
          className="flex flex-col gap-2.5 motion-safe:animate-fade"
        >
          {memos.map((memo, index) => (
            <MemoCard
              attachments={
                attachmentsByMemo.get(memo.name) ?? EMPTY_ATTACHMENTS
              }
              canManage={memo.can_manage === true}
              canGovern={memo.can_govern === true}
              index={index}
              isFocused={focusedMemoId === (memo.id || memo.name)}
              key={memo.name}
              memo={memo}
              onEditingChange={handleEditingChange}
              onRequestDelete={setDeleteTargetMemo}
              onRequestShareImage={setShareImageMemo}
              onRequestVisibility={setVisibilityMemo}
              searchQuery={searchQuery}
              share={sharesByMemo.get(memo.name)}
              onArchive={onArchive}
              onHardDelete={onHardDelete}
              onPin={onPin}
              onRestore={onRestore}
              onRevokeShare={onRevokeShare}
              onShare={onShare}
              onTagClick={onTagClick}
              onTrash={onTrash}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}
      {isPaginationError && retryNotice}
      {hasNextPage && !hasError && (
        <div className="flex flex-col items-center justify-center py-5">
          <div
            ref={sentinelRef}
            className="h-2 w-full pointer-events-none"
            aria-hidden="true"
          />
          <Button
            disabled={isFetchingNextPage}
            size="sm"
            variant="outline"
            onClick={onLoadMore}
          >
            {isFetchingNextPage && <Spinner data-icon="inline-start" />}
            {isFetchingNextPage ? t("common.loading") : t("list.loadMore")}
          </Button>
        </div>
      )}
      {deleteTargetMemo && (
        <AlertDialog
          open={Boolean(deleteTargetMemo)}
          onOpenChange={(open) => {
            if (!open) setDeleteTargetMemo(null);
          }}
        >
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("memo.deleteConfirmTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("memo.deleteConfirmDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel variant="ghost">
                {t("common.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  const id = getMemoResourceId(deleteTargetMemo);
                  void onHardDelete(id);
                  setDeleteTargetMemo(null);
                }}
              >
                {t("memo.deleteForever")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {shareImageMemo && (
        <Suspense fallback={null}>
          <ShareImageDialog
            memo={shareImageMemo}
            open={Boolean(shareImageMemo)}
            onOpenChange={(open) => {
              if (!open) setShareImageMemo(null);
            }}
          />
        </Suspense>
      )}
      {visibilityMemo && (
        <MemoVisibilityDialog
          memo={visibilityMemo}
          open={Boolean(visibilityMemo)}
          onOpenChange={(open) => {
            if (!open) setVisibilityMemo(null);
          }}
          onRevokeShare={onRevokeShare}
          onShare={onShare}
          onUpdateVisibility={async (visibility) => {
            const id = getMemoResourceId(visibilityMemo);
            await onUpdate(id, {
              content: visibilityMemo.content,
              visibility,
            });
            setVisibilityMemo(null);
          }}
          share={sharesByMemo.get(visibilityMemo.name)}
        />
      )}
    </>
  );
});
