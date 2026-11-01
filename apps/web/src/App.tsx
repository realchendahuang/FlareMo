import { Link } from "@tanstack/react-router";
import {
  ArrowUpIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  EyeIcon,
  SparklesIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { MemoVisibility, Share } from "@/api";
import { MemoList } from "@/components/memo-list";
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt";
import { SpotlightSearch } from "@/components/spotlight-search";
import { Button } from "@/components/ui/button";
import { ShortcutsDialog } from "@/components/workspace/shortcuts-dialog";
import { TaskSearchResults } from "@/components/workspace/task-search-results";
import { WorkspaceFilterChips } from "@/components/workspace/workspace-filter-chips";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { WorkspaceComposer } from "@/components/workspace-composer";
import { useMemoMutations } from "@/hooks/use-memo-mutations";
import { useWorkspaceFilters } from "@/hooks/use-workspace-filters";
import { useWorkspaceQueries } from "@/hooks/use-workspace-queries";
import { useWorkspaceShortcuts } from "@/hooks/use-workspace-shortcuts";
import { useI18n } from "@/i18n";
import { focusComposerInput } from "@/lib/composer-focus";
import { AppRoutes } from "@/router-tree";
import { indexRoute, registerWorkspaceComponent } from "@/routes/index-route";

// Breaks the App ↔ router-tree import cycle: the route tree renders the
// workspace through this registry instead of importing `@/App`. Module-eval
// order guarantees registration before the router's first render.
registerWorkspaceComponent(FlareMoApp);

export function FlareMoApp() {
  const { t } = useI18n();
  const search = indexRoute.useSearch();
  const {
    activeTag,
    clearFilters,
    composeRequested,
    dayFilter,
    query,
    setActiveTag,
    setQuery,
    setSpace,
    setUntagged,
    setView,
    space,
    untagged,
    view,
  } = useWorkspaceFilters(search);
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const mainRef = useRef<HTMLElement | null>(null);
  const [isTimelineScrolled, setIsTimelineScrolled] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  const scrollToTop = useCallback(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const searchQuery = query.trim();
  const isSearching = Boolean(searchQuery);

  const {
    attachmentsByMemo,
    canPublishTeam,
    sharedTeam,
    captureStatusQuery,
    displayedMemos,
    isReader,
    isSemanticSearch,
    keywordSearch,
    matchingTasks,
    memosQuery,
    reviewRemaining,
    semanticEnabled,
    semanticMode,
    semanticResultsQuery,
    showOnThisDayBanner,
    stats,
    taskSearchQuery,
    teamExpired,
    toggleSemantic,
    vectorUsageQuery,
  } = useWorkspaceQueries({
    activeTag,
    dayFilter,
    isSearching,
    searchQuery,
    space,
    timeZone,
    untagged,
    view,
  });

  const {
    displayedMemosRef,
    focusedMemoId,
    handleArchiveRef,
    handlePinRef,
    setShowShortcutsOpen,
    setSpotlightOpen,
    shortcutsOpen,
    spotlightOpen,
  } = useWorkspaceShortcuts();
  const {
    hardDeleteMutation,
    restoreMutation,
    revokeShareMutation,
    sharesByMemo,
    shareMutation,
    trashMutation,
    updateMutation,
  } = useMemoMutations();

  const { mutate: updateMemo, mutateAsync: updateMemoAsync } = updateMutation;
  const { mutate: trashMemo } = trashMutation;
  const { mutate: restoreMemo } = restoreMutation;
  const { mutateAsync: shareMemo } = shareMutation;
  const { mutateAsync: hardDeleteMemo } = hardDeleteMutation;
  const handleArchive = useCallback(
    (id: string) => {
      const source = displayedMemos.find(
        (item) => item.name === id || item.id === id,
      );
      updateMemo({
        id,
        input: { status: source?.state === "archived" ? "normal" : "archived" },
      });
    },
    [displayedMemos, updateMemo],
  );
  const handlePin = useCallback(
    (id: string, pinned: boolean) => updateMemo({ id, input: { pinned } }),
    [updateMemo],
  );
  displayedMemosRef.current = displayedMemos;
  handleArchiveRef.current = handleArchive;
  handlePinRef.current = handlePin;
  const handleUpdate = useCallback(
    async (
      id: string,
      input: { content: string; visibility: MemoVisibility },
    ) => {
      await updateMemoAsync({ id, input });
    },
    [updateMemoAsync],
  );
  const handleHardDelete = useCallback(
    async (id: string) => {
      await hardDeleteMemo(id);
    },
    [hardDeleteMemo],
  );
  const { fetchNextPage, refetch, isFetchNextPageError } = memosQuery;
  const { refetch: refetchSemantic } = semanticResultsQuery;
  const handleLoadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);
  const handleRetry = useCallback(() => {
    if (isSemanticSearch) void refetchSemantic();
    else if (isFetchNextPageError) void fetchNextPage();
    else void refetch();
  }, [
    isSemanticSearch,
    isFetchNextPageError,
    fetchNextPage,
    refetch,
    refetchSemantic,
  ]);
  const isUpdating = isSemanticSearch
    ? semanticResultsQuery.isFetching
    : memosQuery.isFetching && !memosQuery.isFetchingNextPage;
  const hasFilters = Boolean(query.trim() || activeTag || untagged);

  // Stable identity: MemoList is memoized, and this callback sits on every
  // card, so an inline arrow here invalidated every card on each re-render.
  const handleRevokeShare = useCallback(
    (share: Share) => revokeShareMutation.mutate(share.id),
    [revokeShareMutation],
  );

  return (
    <>
      <WorkspaceLayout
        contentMaxWidth={640}
        header={(shell) => (
          <WorkspaceHeader
            activeQuery={dayFilter ? "" : query}
            explorer={shell.explorer}
            isTimelineScrolled={isTimelineScrolled}
            mobileSheetOpen={shell.mobileSheetOpen}
            setMobileSheetOpen={shell.setMobileSheetOpen}
            setQuery={setQuery}
            setSpace={setSpace}
            setSpotlightOpen={setSpotlightOpen}
            setView={setView}
            sidebarCollapsed={shell.sidebarCollapsed}
            space={space}
            team={sharedTeam}
            toggleSidebarCollapsed={shell.toggleSidebarCollapsed}
            view={view}
          />
        )}
        mainRef={mainRef}
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          const scrolled = top > 4;
          setIsTimelineScrolled((prev) =>
            prev === scrolled ? prev : scrolled,
          );
          const showTop = top > 400;
          setShowScrollToTop((prev) => (prev === showTop ? prev : showTop));
        }}
      >
        <div className="flex flex-col gap-3">
          {teamExpired && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground motion-safe:animate-rise">
              <EyeIcon aria-hidden="true" className="size-3.5 shrink-0" />
              {t("space.expiredNotice")}
            </div>
          )}
          {isReader && space === "team" && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground motion-safe:animate-rise">
              <EyeIcon aria-hidden="true" className="size-3.5 shrink-0" />
              {t("space.readonlyNotice")}
            </div>
          )}
          <WorkspaceComposer
            visible={view === "all" && !(isReader && space === "team")}
            composeRequested={composeRequested}
            space={space}
            hasTeam={canPublishTeam}
            tags={stats.tags}
            captureAvailable={Boolean(captureStatusQuery.data?.available)}
          />
          {hasFilters && (
            <WorkspaceFilterChips
              activeTag={activeTag}
              clearFilters={clearFilters}
              dayFilter={dayFilter}
              hasFilters={hasFilters}
              isSemanticSearch={isSemanticSearch}
              query={query}
              setActiveTag={setActiveTag}
              setQuery={setQuery}
              setUntagged={setUntagged}
              untagged={untagged}
            />
          )}
          {isSemanticSearch && semanticResultsQuery.data?.degraded ? (
            <p className="mb-3 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {t("search.semanticDegraded")}
            </p>
          ) : null}
          {keywordSearch && matchingTasks.length > 0 && (
            <TaskSearchResults tasks={matchingTasks} />
          )}
          {showOnThisDayBanner && (
            <Link
              className="mb-3 flex items-center gap-2.5 rounded-xl border border-brand-300/40 bg-brand-50/50 px-3.5 py-2.5 text-sm text-foreground motion-safe:animate-rise motion-safe:transition-[background-color,border-color] motion-safe:duration-150 hover:bg-brand-50 dark:border-brand-400/25 dark:bg-brand-400/5 dark:hover:bg-brand-400/10"
              data-testid="on-this-day-banner"
              to="/review/daily"
            >
              <CalendarDaysIcon className="shrink-0 text-brand-500 dark:text-brand-400" />
              <span className="min-w-0 flex-1 truncate">
                {t("review.onThisDayBanner", { count: reviewRemaining })}
              </span>
              <ChevronRightIcon className="shrink-0 text-muted-foreground" />
            </Link>
          )}
          {semanticEnabled &&
            !isSemanticSearch &&
            !dayFilter &&
            searchQuery &&
            displayedMemos.length === 0 &&
            !memosQuery.isLoading &&
            !memosQuery.isFetchingNextPage &&
            !memosQuery.isError && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground motion-safe:animate-rise">
                <SparklesIcon className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  {t("search.noResultsHint")}
                </span>
                <Button
                  className="h-7 px-2 text-xs"
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={toggleSemantic}
                >
                  {t("search.semanticToggle")}
                </Button>
              </div>
            )}
          <MemoList
            attachmentsByMemo={attachmentsByMemo}
            commentsEnabled={Boolean(sharedTeam)}
            emptyIcon={view}
            emptyDescription={
              isSemanticSearch
                ? t("search.semanticEmpty")
                : hasFilters
                  ? t("list.filteredEmptyDescription")
                  : view === "archived"
                    ? t("list.archiveEmptyDescription")
                    : view === "trashed"
                      ? t("list.trashEmptyDescription")
                      : undefined
            }
            hasError={
              isSemanticSearch
                ? semanticResultsQuery.isError
                : memosQuery.isError
            }
            hasNextPage={
              isSemanticSearch ? false : Boolean(memosQuery.hasNextPage)
            }
            isFetchingNextPage={
              isSemanticSearch ? false : memosQuery.isFetchingNextPage
            }
            isLoading={
              isSemanticSearch
                ? semanticResultsQuery.isLoading
                : memosQuery.isLoading
            }
            memos={displayedMemos}
            focusedMemoId={focusedMemoId}
            searchQuery={searchQuery || undefined}
            sharesByMemo={sharesByMemo}
            onArchive={handleArchive}
            onHardDelete={handleHardDelete}
            onLoadMore={handleLoadMore}
            onPin={handlePin}
            onRestore={restoreMemo}
            onRetry={handleRetry}
            onRevokeShare={handleRevokeShare}
            onShare={shareMemo}
            onTagClick={setActiveTag}
            onTrash={trashMemo}
            onUpdate={handleUpdate}
            onClearFilters={hasFilters ? clearFilters : undefined}
            isUpdating={isUpdating}
            isPaginationError={!isSemanticSearch && isFetchNextPageError}
            isRetrying={
              isSemanticSearch
                ? semanticResultsQuery.isFetching
                : memosQuery.isFetching
            }
            emptyTitle={
              hasFilters
                ? t("list.filteredEmptyTitle")
                : view === "all"
                  ? t("list.emptyTitle")
                  : view === "archived"
                    ? t("list.archiveEmptyTitle")
                    : t("list.trashEmptyTitle")
            }
          />
          {showScrollToTop && (
            <Button
              aria-label={t("common.scrollToTop")}
              className="fixed bottom-6 right-6 z-30 size-9 rounded-full border border-border/60 bg-background/85 p-0 text-muted-foreground shadow-sm backdrop-blur-md hover:bg-muted hover:text-foreground active:scale-95 motion-safe:animate-scale-in motion-safe:transition-all sm:right-8"
              size="icon"
              title={t("common.scrollToTop")}
              type="button"
              variant="outline"
              onClick={scrollToTop}
            >
              <ArrowUpIcon className="size-4" />
            </Button>
          )}
        </div>
      </WorkspaceLayout>
      <SpotlightSearch
        open={spotlightOpen}
        onOpenChange={setSpotlightOpen}
        query={dayFilter ? "" : query}
        onQueryChange={setQuery}
        onNewMemo={focusComposerInput}
        tasks={taskSearchQuery.data?.tasks ?? []}
        memos={displayedMemos}
        semanticMode={semanticMode}
        onToggleSemantic={semanticEnabled ? toggleSemantic : undefined}
        semanticPending={vectorUsageQuery.isPending}
        isSearching={isUpdating}
      />
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShowShortcutsOpen}
      />
    </>
  );
}

export default function App() {
  return (
    <>
      <PwaUpdatePrompt />
      <AppRoutes />
    </>
  );
}
