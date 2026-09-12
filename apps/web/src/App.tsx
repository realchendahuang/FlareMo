import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarIcon,
  DownloadIcon,
  LanguagesIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  getMemoStats,
  getTagHierarchy,
  getVectorUsage,
  listMemos,
  type MemoStatsResponse,
  semanticSearchMemos,
} from "@/api";
import type { ExplorerView as ViewMode } from "@/components/flaremo-explorer";
import { FlareMoExplorer } from "@/components/flaremo-explorer";
import { InfoTip } from "@/components/info-tip";
import { MemoComposer } from "@/components/memo-composer";
import { MemoList } from "@/components/memo-list";
import { NotificationBell } from "@/components/notification-bell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { UpdateStatus } from "@/components/update-status";
import { useDataTransfer } from "@/hooks/use-data-transfer";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useMemoMutations, viewToMemoState } from "@/hooks/use-memo-mutations";
import { useNewMemoCapture } from "@/hooks/use-new-memo-capture";
import { type TranslationKey, useI18n } from "@/i18n";
import { dayFilterFromQuery, formatDayTitle } from "@/lib/calendar-date";
import {
  enqueueMemoSubmission,
  flushQueuedMemoSubmissions,
  getNewMemoDraftId,
  isBrowserOnline,
  type MemoCaptureInput,
} from "@/lib/local-memo-capture";
import {
  shouldContinueQueuedSubmissionAfterFailure,
  shouldQueueAfterFailure,
  validateMemoCaptureSubmission,
} from "@/lib/memo-submission";
import { cn } from "@/lib/utils";
import { AppRoutes } from "@/router-tree";
import { indexRoute, registerWorkspaceComponent } from "@/routes/index-route";

const PAGE_SIZE = 30;
const EMPTY_STATS: MemoStatsResponse = {
  counts: { normal: 0, archived: 0, trashed: 0, total: 0 },
  active_days: 0,
  tags: [],
  activity: [],
};

// Breaks the App ↔ router-tree import cycle: the route tree renders the
// workspace through this registry instead of importing `@/App`. Module-eval
// order guarantees registration before the router's first render.
registerWorkspaceComponent(FlareMoApp);

export function FlareMoApp() {
  const { locale, t, toggleLocale } = useI18n();
  const navigate = useNavigate({ from: "/" });
  const search = indexRoute.useSearch();
  const view = search.view ?? "all";
  const activeTag = search.tag;
  const untagged = Boolean(search.untagged);
  const query = search.q ?? "";
  // A query that is exactly one local day is not a text search; it renders as
  // a removable date chip and the search box stays empty.
  const dayFilter = dayFilterFromQuery(query);
  const setView = (nextView: ViewMode) =>
    void navigate({
      replace: true,
      search: (current) => ({ ...current, view: nextView }),
    });
  const setActiveTag = (tag: string | undefined) =>
    void navigate({
      replace: true,
      search: (current) => ({ ...current, tag, untagged: undefined }),
    });
  const setUntagged = (next: boolean) =>
    void navigate({
      replace: true,
      search: (current) => ({
        ...current,
        tag: undefined,
        untagged: next ? true : undefined,
      }),
    });
  const setQuery = (q: string) =>
    void navigate({
      replace: true,
      search: (current) => ({
        ...current,
        q: q || undefined,
        // A text query includes timeline and archived notes by default; trash
        // remains available through the explicit `in:trash` search operator.
        view: q.trim() ? "all" : view,
      }),
    });
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [newMemoDraftId] = useState(getNewMemoDraftId);
  const capture = useNewMemoCapture({ draftId: newMemoDraftId });
  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const [isTimelineScrolled, setIsTimelineScrolled] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [shortcutsOpen, setShowShortcutsOpen] = useState(false);
  const isQueueFlushing = useRef(false);
  const isQueueFlushPending = useRef(false);
  const isCaptureSubmitting = useRef(false);
  const restoredDraftNotified = useRef(false);
  const [isCaptureSubmissionPending, setIsCaptureSubmissionPending] =
    useState(false);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const isSearching = Boolean(debouncedQuery);
  const [semanticMode, setSemanticMode] = useState(false);

  const vectorUsageQuery = useQuery({
    queryKey: ["vector-usage"],
    queryFn: () => getVectorUsage(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  // Semantic search is hidden when the plan has no budget for it (quota 0)
  // or the capability itself is disabled server-side.
  const semanticEnabled = useMemo(() => {
    const plan = vectorUsageQuery.data?.plan;
    if (!plan) return false;
    const limit =
      plan.user?.limits.semanticSearchQueriesPerMonth ??
      plan.limits.semanticSearchQueriesPerMonth;
    return typeof limit === "number" && limit > 0;
  }, [vectorUsageQuery.data]);

  const semanticResultsQuery = useQuery({
    queryKey: ["semantic-search", debouncedQuery],
    enabled: semanticMode && Boolean(debouncedQuery),
    queryFn: () => semanticSearchMemos(debouncedQuery, 20),
    retry: false,
  });
  const semanticMemos = useMemo(
    () => semanticResultsQuery.data?.memos ?? [],
    [semanticResultsQuery.data],
  );

  useEffect(() => {
    const focusSearch = () => {
      const desktop = window.matchMedia("(min-width: 768px)").matches;
      (desktop ? desktopSearchRef : mobileSearchRef).current?.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === "k"
      ) {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (event.key === "/" && !editable) {
        event.preventDefault();
        focusSearch();
        return;
      }
      // "c" jumps straight into the composer for quick capture.
      if (event.key.toLocaleLowerCase() === "c" && !editable) {
        const composer = document.getElementById("flaremo-composer-input");
        if (composer instanceof HTMLTextAreaElement) {
          event.preventDefault();
          composer.focus();
        }
      }
      // "?" lists the available keyboard shortcuts.
      if (event.key === "?" && !editable) {
        event.preventDefault();
        setShowShortcutsOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const memosQuery = useInfiniteQuery({
    queryKey: ["memos", view, debouncedQuery, activeTag, untagged],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listMemos({
        include_deleted: !isSearching && view === "trashed",
        page_size: PAGE_SIZE,
        page_token: pageParam,
        q: debouncedQuery || undefined,
        state: isSearching ? undefined : viewToMemoState(view),
        tag: activeTag,
        untagged,
      }),
    getNextPageParam: (lastPage) => lastPage.next_page_token,
    retry: false,
  });
  const statsQuery = useQuery({
    queryKey: ["memo-stats", timeZone],
    queryFn: () => getMemoStats(timeZone),
    retry: false,
  });
  const tagHierarchyQuery = useQuery({
    queryKey: ["tag-hierarchy"],
    queryFn: () => getTagHierarchy(),
    retry: false,
  });

  const memos = useMemo(
    () => memosQuery.data?.pages.flatMap((page) => page.memos) ?? [],
    [memosQuery.data],
  );
  const attachmentsByMemo = useMemo(
    () =>
      new Map(
        memos.map((memo) => [memo.name, memo.attachments ?? []] as const),
      ),
    [memos],
  );
  const stats = statsQuery.data ?? EMPTY_STATS;

  const {
    createMemoAsync,
    isCreatingMemo,
    deleteTagMutation,
    handleMutationError,
    hardDeleteMutation,
    invalidateWorkspace,
    renameTagMutation,
    restoreMutation,
    sharesByMemo,
    shareMutation,
    trashMutation,
    updateMutation,
  } = useMemoMutations();

  const { handleExport, handleImportFile } = useDataTransfer({
    handleMutationError,
    invalidateWorkspace,
  });

  const flushQueuedCaptures = useCallback(async () => {
    if (!isBrowserOnline()) return;
    // An "online" event that lands while a flush is running (e.g. the mount
    // flush) must schedule another pass instead of being swallowed.
    if (isQueueFlushing.current) {
      isQueueFlushPending.current = true;
      return;
    }

    isQueueFlushing.current = true;
    try {
      let submitted = 0;
      let failed = 0;
      do {
        isQueueFlushPending.current = false;
        const result = await flushQueuedMemoSubmissions(
          (submission) => createMemoAsync(submission),
          {
            shouldContinueAfterFailure:
              shouldContinueQueuedSubmissionAfterFailure,
          },
        );
        submitted += result.submittedIds.length;
        failed += result.failedIds.length;
      } while (isQueueFlushPending.current && isBrowserOnline());
      if (submitted > 0) {
        toast.success(t("toast.queueSynced"));
      }
      if (failed > 0) {
        toast.error(t("toast.queueNeedsAttention", { count: failed }));
      }
    } finally {
      isQueueFlushing.current = false;
    }
  }, [createMemoAsync, t]);

  useEffect(() => {
    void flushQueuedCaptures();
    const handleOnline = () => void flushQueuedCaptures();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [flushQueuedCaptures]);

  useEffect(() => {
    if (!capture.didRestoreStoredDraft || restoredDraftNotified.current) return;
    restoredDraftNotified.current = true;
    toast.success(t("toast.draftRestored"));
  }, [capture.didRestoreStoredDraft, t]);

  const handleCaptureSubmit = async (input: MemoCaptureInput) => {
    if (isCaptureSubmitting.current) return;

    isCaptureSubmitting.current = true;
    setIsCaptureSubmissionPending(true);
    const submission = {
      ...input,
      content: input.content || t("toast.untitledAttachment"),
    };
    try {
      const validationError = validateMemoCaptureSubmission(submission, t);
      if (validationError) {
        handleMutationError(validationError);
        throw validationError;
      }

      if (!isBrowserOnline()) {
        const queued = await enqueueMemoSubmission(submission);
        if (!queued) {
          const error = new Error(t("toast.offlineStorageUnavailable"));
          handleMutationError(error);
          throw error;
        }
        await capture.discardDraft();
        toast.success(t("toast.queuedForSync"));
        return;
      }

      try {
        await createMemoAsync(submission);
        await capture.discardDraft();
        toast.success(t("toast.saved"));
      } catch (error) {
        if (!shouldQueueAfterFailure(error)) {
          handleMutationError(error);
          throw error;
        }

        const queued = await enqueueMemoSubmission(submission);
        if (!queued) {
          handleMutationError(error);
          throw error;
        }
        await capture.discardDraft();
        toast.success(t("toast.queuedForSync"));
      }
    } finally {
      isCaptureSubmitting.current = false;
      setIsCaptureSubmissionPending(false);
    }
  };

  const renderExplorer = (importInputId: string, onNavigate?: () => void) => (
    <FlareMoExplorer
      activeTag={activeTag}
      activeView={view}
      headerAction={
        <div className="mr-8 flex items-center gap-1 lg:mr-0">
          <NotificationBell />
          <UpdateStatus />
          <Button
            asChild
            aria-label={t("auth.accountTitle")}
            size="icon-sm"
            variant="ghost"
          >
            <Link
              onClick={onNavigate}
              title={t("auth.accountTitle")}
              to="/account"
            >
              <SettingsIcon />
            </Link>
          </Button>
        </div>
      }
      footer={
        <div className="flex items-center gap-1 text-muted-foreground">
          <Button
            aria-label={t("language.toggle")}
            className="w-12 px-2"
            size="sm"
            title={t("language.toggle")}
            variant="ghost"
            onClick={toggleLocale}
          >
            <LanguagesIcon data-icon="inline-start" />
            <span className="text-xs font-medium">{t("language.next")}</span>
          </Button>
          <Button
            aria-label={t("common.export")}
            size="icon-sm"
            title={t("common.export")}
            variant="ghost"
            onClick={() => void handleExport()}
          >
            <DownloadIcon />
          </Button>
          <Button asChild size="icon-sm" variant="ghost">
            <label
              aria-label={t("common.import")}
              htmlFor={importInputId}
              title={t("common.import")}
            >
              <UploadIcon />
              <Input
                accept="application/json"
                className="hidden"
                id={importInputId}
                type="file"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  try {
                    const text = await file.text();
                    void handleImportFile(JSON.parse(text) as unknown);
                  } catch {
                    toast.error(t("toast.invalidImport"));
                  }
                }}
              />
            </label>
          </Button>
        </div>
      }
      stats={stats}
      hierarchy={tagHierarchyQuery.data?.tags ?? []}
      untagged={untagged}
      onDeleteTag={(tag) => deleteTagMutation.mutate(tag)}
      onRenameTag={(from, to) => renameTagMutation.mutate({ from, to })}
      onTagChange={setActiveTag}
      onUntaggedChange={setUntagged}
      onViewChange={setView}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="h-svh overflow-hidden bg-background">
      <div className="mx-auto flex h-full w-full max-w-[950px]">
        <div className="no-scrollbar hidden h-full w-[312px] shrink-0 overflow-y-auto border-r bg-background lg:block">
          {renderExplorer("flaremo-import-file-desktop")}
        </div>
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <header
            className={cn(
              "z-20 shrink-0 border-b bg-background/90 backdrop-blur-md motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200",
              isTimelineScrolled
                ? "border-border shadow-xs"
                : "border-transparent",
            )}
          >
            <div className="flex h-14 items-center gap-2 px-5 lg:px-3">
              <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
                <SheetTrigger asChild>
                  <Button
                    aria-label={t("sidebar.toggle")}
                    className="lg:hidden"
                    size="icon-sm"
                    variant="ghost"
                  >
                    <MenuIcon />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  className="w-[312px] overflow-hidden p-0"
                  side="left"
                >
                  <SheetTitle className="sr-only">
                    {t("sidebar.title")}
                  </SheetTitle>
                  <div
                    className="no-scrollbar h-full overflow-y-auto overscroll-contain"
                    data-testid="mobile-sidebar-scroll"
                  >
                    {renderExplorer("flaremo-import-file-mobile", () =>
                      setMobileSheetOpen(false),
                    )}
                  </div>
                </SheetContent>
              </Sheet>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="hidden text-muted-foreground sm:inline">
                  /
                </span>
                <div className="truncate px-1.5 py-1 text-sm font-semibold">
                  {dayFilter
                    ? formatDayTitle(dayFilter, locale)
                    : query.trim()
                      ? t("search.results")
                      : viewTitle(view, t)}
                </div>
              </div>
              <SearchBox
                className="hidden w-[243px] md:block motion-safe:transition-[width] motion-safe:duration-200 focus-within:w-[300px]"
                inputRef={desktopSearchRef}
                onToggleSemantic={
                  semanticEnabled
                    ? () => setSemanticMode((value) => !value)
                    : undefined
                }
                query={dayFilter ? "" : query}
                semanticMode={semanticMode}
                setQuery={setQuery}
                t={t}
              />
            </div>
          </header>
          <main
            className="mx-auto min-h-0 w-full max-w-[640px] flex-1 overflow-y-auto px-5 pt-1 pb-8 lg:px-3"
            onScroll={(event) => {
              const scrolled = event.currentTarget.scrollTop > 4;
              setIsTimelineScrolled((prev) =>
                prev === scrolled ? prev : scrolled,
              );
            }}
          >
            <SearchBox
              className="mb-3 md:hidden motion-safe:animate-rise"
              inputRef={mobileSearchRef}
              onToggleSemantic={
                semanticEnabled
                  ? () => setSemanticMode((value) => !value)
                  : undefined
              }
              query={dayFilter ? "" : query}
              semanticMode={semanticMode}
              setQuery={setQuery}
              t={t}
            />
            <div className="flex flex-col gap-3">
              {view === "all" && (
                <MemoComposer
                  draft={capture.draft}
                  isPending={isCreatingMemo || isCaptureSubmissionPending}
                  onDraftChange={capture.updateDraft}
                  onSubmit={handleCaptureSubmit}
                />
              )}
              {(activeTag || query.trim()) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground motion-safe:animate-rise">
                  {query.trim() && !dayFilter && (
                    <span className="rounded-md bg-muted px-2 py-1">
                      {t("search.globalScope")}
                    </span>
                  )}
                  {dayFilter && (
                    <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                      <CalendarIcon
                        aria-hidden="true"
                        className="size-3 shrink-0"
                      />
                      {formatDayTitle(dayFilter, locale)}
                      <button
                        aria-label={t("filter.clearDate")}
                        className="-mr-1 rounded p-0.5 hover:text-foreground"
                        type="button"
                        onClick={() => setQuery("")}
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    </span>
                  )}
                  {activeTag && (
                    <button
                      className="rounded-md bg-muted px-2 py-1 motion-safe:transition-colors hover:text-foreground"
                      type="button"
                      onClick={() => setActiveTag(undefined)}
                    >
                      #{activeTag}
                    </button>
                  )}
                  {query.trim() && !dayFilter && (
                    <button
                      className="rounded-md px-2 py-1 motion-safe:transition-colors hover:bg-muted hover:text-foreground"
                      type="button"
                      onClick={() => {
                        setActiveTag(undefined);
                        setQuery("");
                      }}
                    >
                      {t("common.clearFilters")}
                    </button>
                  )}
                </div>
              )}
              {query.trim() && !dayFilter && !semanticMode && (
                <div className="-mt-1">
                  <InfoTip text={t("search.syntaxHint")} />
                </div>
              )}
              <MemoList
                attachmentsByMemo={attachmentsByMemo}
                emptyDescription={
                  semanticMode && debouncedQuery
                    ? t("search.semanticEmpty")
                    : undefined
                }
                hasError={
                  semanticMode
                    ? semanticResultsQuery.isError
                    : memosQuery.isError
                }
                hasNextPage={
                  semanticMode ? false : Boolean(memosQuery.hasNextPage)
                }
                isFetchingNextPage={
                  semanticMode ? false : memosQuery.isFetchingNextPage
                }
                isLoading={
                  semanticMode
                    ? semanticResultsQuery.isLoading
                    : memosQuery.isLoading
                }
                memos={semanticMode ? semanticMemos : memos}
                searchQuery={debouncedQuery || undefined}
                sharesByMemo={sharesByMemo}
                onArchive={(id) => {
                  const source = semanticMode ? semanticMemos : memos;
                  const memo = source.find(
                    (item) => item.name === id || item.id === id,
                  );
                  updateMutation.mutate({
                    id,
                    input: {
                      status:
                        memo?.state === "archived" ? "normal" : "archived",
                    },
                  });
                }}
                onHardDelete={async (id) => {
                  await hardDeleteMutation.mutateAsync(id);
                }}
                onLoadMore={() => {
                  if (!semanticMode) void memosQuery.fetchNextPage();
                }}
                onPin={(id, pinned) =>
                  updateMutation.mutate({ id, input: { pinned } })
                }
                onRestore={(id) => restoreMutation.mutate(id)}
                onRetry={() => {
                  if (semanticMode) void semanticResultsQuery.refetch();
                  else void memosQuery.refetch();
                }}
                onShare={(id) => shareMutation.mutate(id)}
                onTagClick={setActiveTag}
                onTrash={(id) => trashMutation.mutate(id)}
                onUpdate={async (id, input) => {
                  await updateMutation.mutateAsync({ id, input });
                }}
              />
            </div>
          </main>
        </div>
      </div>
      <Dialog open={shortcutsOpen} onOpenChange={setShowShortcutsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("shortcuts.title")}</DialogTitle>
            <DialogDescription>{t("shortcuts.subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col divide-y divide-border/60">
            {(
              [
                ["shortcuts.search", "⌘K / /"],
                ["shortcuts.composer", "C"],
                ["shortcuts.send", "Enter"],
                ["shortcuts.linebreak", "Shift + Enter"],
                ["shortcuts.saveEdit", "⌘Enter"],
              ] as const
            ).map(([key, combo]) => (
              <div
                className="flex items-center justify-between gap-3 py-2 text-sm"
                key={key}
              >
                <span className="text-muted-foreground">
                  {t(key as TranslationKey)}
                </span>
                <kbd className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs">
                  {combo}
                </kbd>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SearchBox({
  className,
  inputRef,
  query,
  semanticMode = false,
  onToggleSemantic,
  setQuery,
  t,
}: {
  className: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  query: string;
  semanticMode?: boolean;
  onToggleSemantic?: () => void;
  setQuery: (value: string) => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <div className={className}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={t("common.search")}
          className="h-9 rounded-xl border-0 bg-muted pr-11 pl-9 shadow-none transition-[box-shadow,background-color] focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-flame-400/30"
          placeholder={
            semanticMode
              ? t("search.semanticPlaceholder")
              : t("search.placeholder")
          }
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {onToggleSemantic && (
          <button
            aria-label={t("search.semanticToggle")}
            aria-pressed={semanticMode}
            className={cn(
              "absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 transition-colors",
              semanticMode
                ? "bg-flame-500/15 text-flame-500"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={t("search.semanticToggle")}
            type="button"
            onClick={onToggleSemantic}
          >
            <SparklesIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function viewTitle(view: ViewMode, t: (key: TranslationKey) => string) {
  switch (view) {
    case "archived":
      return t("view.archive");
    case "trashed":
      return t("view.trash");
    default:
      return t("view.timeline");
  }
}

export default function App() {
  return <AppRoutes />;
}
