import type { ListMemosResponse } from "@flaremo/contracts";
import {
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import {
  DownloadIcon,
  LanguagesIcon,
  MenuIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import {
  lazy,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  ApiError,
  createMemo,
  createShare,
  exportData,
  getMemoStats,
  hardDeleteMemo,
  importData,
  listMemos,
  type Memo,
  type MemoState,
  type MemoStatsResponse,
  type Share,
  trashMemo,
  updateMemo,
  uploadAttachment,
} from "@/api";
import { FlareMoExplorer } from "@/components/flaremo-explorer";
import type { MemoView as ViewMode } from "@/components/flaremo-sidebar";
import { MemoComposer } from "@/components/memo-composer";
import { MemoList } from "@/components/memo-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UpdateStatus } from "@/components/update-status";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useNewMemoCapture } from "@/hooks/use-new-memo-capture";
import { type TranslationKey, useI18n } from "@/i18n";
import {
  enqueueMemoSubmission,
  flushQueuedMemoSubmissions,
  getNewMemoDraftId,
  isBrowserOnline,
  type MemoCaptureInput,
} from "@/lib/local-memo-capture";
import { cn } from "@/lib/utils";

const MemoDetailPage = lazy(() =>
  import("@/pages/memo-detail-page").then((module) => ({
    default: module.MemoDetailPage,
  })),
);
const PublicSharePage = lazy(() =>
  import("@/pages/public-share-page").then((module) => ({
    default: module.PublicSharePage,
  })),
);

const PAGE_SIZE = 30;
const EMPTY_STATS: MemoStatsResponse = {
  counts: { normal: 0, archived: 0, trashed: 0, total: 0 },
  active_days: 0,
  tags: [],
  activity: [],
};

function FlareMoApp() {
  const { t, toggleLocale } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/" });
  const search = indexRoute.useSearch();
  const view = search.view ?? "all";
  const activeTag = search.tag;
  const query = search.q ?? "";
  const setView = (nextView: ViewMode) =>
    void navigate({
      replace: true,
      search: (current) => ({ ...current, view: nextView }),
    });
  const setActiveTag = (tag: string | undefined) =>
    void navigate({
      replace: true,
      search: (current) => ({ ...current, tag }),
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
  const [sharesByMemo, setSharesByMemo] = useState<Map<string, Share>>(
    new Map(),
  );
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [newMemoDraftId] = useState(getNewMemoDraftId);
  const capture = useNewMemoCapture({ draftId: newMemoDraftId });
  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const [isTimelineScrolled, setIsTimelineScrolled] = useState(false);
  const isQueueFlushing = useRef(false);
  const isQueueFlushPending = useRef(false);
  const isCaptureSubmitting = useRef(false);
  const restoredDraftNotified = useRef(false);
  const [isCaptureSubmissionPending, setIsCaptureSubmissionPending] =
    useState(false);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const isSearching = Boolean(debouncedQuery);

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
      // "c" jumps straight into the composer, like Memos' quick capture.
      if (event.key.toLocaleLowerCase() === "c" && !editable) {
        const composer = document.getElementById("flaremo-composer-input");
        if (composer instanceof HTMLTextAreaElement) {
          event.preventDefault();
          composer.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const memosQuery = useInfiniteQuery({
    queryKey: ["memos", view, debouncedQuery, activeTag],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listMemos({
        include_deleted: !isSearching && view === "trashed",
        page_size: PAGE_SIZE,
        page_token: pageParam,
        q: debouncedQuery || undefined,
        state: isSearching ? undefined : viewToMemoState(view),
        tag: activeTag,
      }),
    getNextPageParam: (lastPage) => lastPage.next_page_token,
    retry: false,
  });
  const statsQuery = useQuery({
    queryKey: ["memo-stats", timeZone],
    queryFn: () => getMemoStats(timeZone),
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

  const invalidateWorkspace = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["memos"] }),
      queryClient.invalidateQueries({ queryKey: ["memo-stats"] }),
    ]);
  const handleMutationError = (error: unknown) => {
    const normalizedError = toError(error);
    if (
      normalizedError instanceof ApiError &&
      (normalizedError.status === 401 || normalizedError.status === 403)
    ) {
      toast.error(t("toast.accessRequired"));
      return;
    }
    toast.error(normalizedError.message);
  };

  const { mutateAsync: createMemoAsync, isPending: isCreatingMemo } =
    useMutation({
      mutationFn: createMemoWithAttachments,
      onSuccess: () => {
        void invalidateWorkspace();
      },
      // A memo can be created before one of its attachment uploads loses the
      // network response. Refresh the list even on failure so the durable
      // memo is not hidden while its queued attachment retry is pending.
      onError: () => {
        void invalidateWorkspace();
      },
    });

  const trashMutation = useMutation({
    mutationFn: trashMemo,
    onMutate: (id) =>
      optimisticallyPatchMemo(queryClient, id, { state: "trashed" }),
    onSuccess: () => {
      toast.success(t("toast.movedToTrash"));
    },
    onError: (error, _id, snapshot) => {
      restoreMemoSnapshot(queryClient, snapshot);
      handleMutationError(error);
    },
    onSettled: () => void invalidateWorkspace(),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => updateMemo(id, { status: "normal" }),
    onMutate: (id) =>
      optimisticallyPatchMemo(queryClient, id, { state: "normal" }),
    onSuccess: () => {
      toast.success(t("toast.restored"));
    },
    onError: (error, _id, snapshot) => {
      restoreMemoSnapshot(queryClient, snapshot);
      handleMutationError(error);
    },
    onSettled: () => void invalidateWorkspace(),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof updateMemo>[1];
    }) => updateMemo(id, input),
    onMutate: ({ id, input }) =>
      optimisticallyPatchMemo(queryClient, id, memoPatchFromUpdate(input)),
    onSuccess: () => {
      toast.success(t("toast.updated"));
    },
    onError: (error, _variables, snapshot) => {
      restoreMemoSnapshot(queryClient, snapshot);
      handleMutationError(error);
    },
    onSettled: () => void invalidateWorkspace(),
  });

  const hardDeleteMutation = useMutation({
    mutationFn: hardDeleteMemo,
    onMutate: (id) => optimisticallyPatchMemo(queryClient, id, null),
    onSuccess: () => {
      toast.success(t("toast.deleted"));
    },
    onError: (error, _id, snapshot) => {
      restoreMemoSnapshot(queryClient, snapshot);
      handleMutationError(error);
    },
    onSettled: () => void invalidateWorkspace(),
  });

  const shareMutation = useMutation({
    mutationFn: createShare,
    onSuccess: (share) => {
      setSharesByMemo((current) => new Map(current).set(share.memo, share));
      toast.success(t("toast.shareCreated"));
    },
    onError: handleMutationError,
  });

  const importMutation = useMutation({
    mutationFn: importData,
    onSuccess: (result) => {
      toast.success(t("toast.imported", { count: result.imported_memos }));
      void invalidateWorkspace();
    },
    onError: handleMutationError,
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

  const handleExport = async () => {
    try {
      const bundle = await exportData();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `flaremo-export-${new Date().toISOString()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      handleMutationError(error);
    }
  };

  const renderExplorer = (importInputId: string) => (
    <FlareMoExplorer
      activeTag={activeTag}
      activeView={view}
      headerAction={
        <div className="mr-8 lg:mr-0">
          <UpdateStatus />
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
                    importMutation.mutate(JSON.parse(text) as unknown);
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
      onTagChange={setActiveTag}
      onViewChange={setView}
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
              <Sheet>
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
                    {renderExplorer("flaremo-import-file-mobile")}
                  </div>
                </SheetContent>
              </Sheet>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="hidden text-muted-foreground sm:inline">
                  /
                </span>
                <div className="truncate px-1.5 py-1 text-sm font-semibold">
                  {query.trim() ? t("search.results") : viewTitle(view, t)}
                </div>
                {activeTag && (
                  <button
                    className="truncate rounded-md px-1.5 py-1 text-sm text-muted-foreground motion-safe:transition-colors hover:bg-muted"
                    type="button"
                    onClick={() => setActiveTag(undefined)}
                  >
                    #{activeTag}
                  </button>
                )}
              </div>
              <SearchBox
                className="hidden w-[243px] md:block"
                inputRef={desktopSearchRef}
                query={query}
                showShortcut
                setQuery={setQuery}
                t={t}
              />
            </div>
          </header>
          <main
            className="mx-auto min-h-0 w-full max-w-[640px] flex-1 overflow-y-auto px-5 pt-1 pb-8 lg:px-3"
            onScroll={(event) =>
              setIsTimelineScrolled(event.currentTarget.scrollTop > 4)
            }
          >
            <SearchBox
              className="mb-3 md:hidden motion-safe:animate-rise"
              inputRef={mobileSearchRef}
              query={query}
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
                  {query.trim() && (
                    <span className="rounded-md bg-muted px-2 py-1">
                      {t("search.globalScope")}
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
                </div>
              )}
              {query.trim() && (
                <p className="-mt-1 text-xs text-muted-foreground">
                  {t("search.syntaxHint")}
                </p>
              )}
              <MemoList
                attachmentsByMemo={attachmentsByMemo}
                hasError={memosQuery.isError}
                hasNextPage={Boolean(memosQuery.hasNextPage)}
                isFetchingNextPage={memosQuery.isFetchingNextPage}
                isLoading={memosQuery.isLoading}
                memos={memos}
                searchQuery={debouncedQuery || undefined}
                sharesByMemo={sharesByMemo}
                onArchive={(id) => {
                  const memo = memos.find(
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
                onLoadMore={() => void memosQuery.fetchNextPage()}
                onPin={(id, pinned) =>
                  updateMutation.mutate({ id, input: { pinned } })
                }
                onRestore={(id) => restoreMutation.mutate(id)}
                onRetry={() => void memosQuery.refetch()}
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
    </div>
  );
}

function SearchBox({
  className,
  inputRef,
  query,
  showShortcut = false,
  setQuery,
  t,
}: {
  className: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  query: string;
  showShortcut?: boolean;
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
          placeholder={t("search.placeholder")}
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {showShortcut && (
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-md border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-xs">
            ⌘K
          </kbd>
        )}
      </div>
    </div>
  );
}

async function createMemoWithAttachments(input: MemoCaptureInput) {
  const memo = await createMemo({
    content: input.content,
    visibility: input.visibility,
    payload: { tags: input.tags, client_id: input.clientId },
    source: "web",
  });

  // A mobile queue can hold many large files. Upload them in order so a
  // transient failure stops early, and each retry only replays stable ids.
  for (const [index, file] of input.files.entries()) {
    await uploadAttachment({
      file,
      memo: memo.name,
      clientId: getAttachmentCaptureClientId(input.clientId, index),
    });
  }

  return memo;
}

function getAttachmentCaptureClientId(
  memoClientId: string | undefined,
  index: number,
) {
  if (!memoClientId) return undefined;
  const clientId = `${memoClientId}:attachment:${index}`;
  return clientId.length <= 128 ? clientId : undefined;
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function shouldQueueAfterFailure(error: unknown) {
  // Queue only when the request never received a meaningful answer (network
  // failure, timeout, rate limit). A server error response is surfaced to
  // the user instead, with the draft kept intact for an explicit retry.
  if (!(error instanceof ApiError)) return true;
  return error.status === 408 || error.status === 429;
}

function shouldContinueQueuedSubmissionAfterFailure(error: unknown) {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

function validateMemoCaptureSubmission(
  input: MemoCaptureInput,
  t: (key: TranslationKey) => string,
) {
  if (input.content.length > 100_000) {
    return new Error(t("toast.memoTooLong"));
  }
  if (input.files.length > 100) {
    return new Error(t("toast.tooManyAttachments"));
  }
  if (input.files.some((file) => file.size > 25 * 1024 * 1024)) {
    return new Error(t("toast.attachmentTooLarge"));
  }
  return undefined;
}

type MemoSnapshot = Array<
  [QueryKey, InfiniteData<ListMemosResponse> | undefined]
>;

async function optimisticallyPatchMemo(
  queryClient: QueryClient,
  id: string,
  patch: Partial<Memo> | null,
): Promise<MemoSnapshot> {
  await queryClient.cancelQueries({ queryKey: ["memos"] });
  const snapshots = queryClient.getQueriesData<InfiniteData<ListMemosResponse>>(
    {
      queryKey: ["memos"],
    },
  );

  for (const [queryKey, data] of snapshots) {
    if (!data) continue;
    const view = queryKey[1] as ViewMode | undefined;
    queryClient.setQueryData<InfiniteData<ListMemosResponse>>(queryKey, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        memos: page.memos.flatMap((memo) => {
          if (memo.id !== id && memo.name !== id) return [memo];
          if (!patch) return [];
          const next = {
            ...memo,
            ...patch,
            update_time: new Date().toISOString(),
          };
          return view && next.state !== viewToMemoState(view) ? [] : [next];
        }),
      })),
    });
  }

  return snapshots;
}

function restoreMemoSnapshot(
  queryClient: QueryClient,
  snapshot: MemoSnapshot | undefined,
) {
  for (const [queryKey, data] of snapshot ?? []) {
    queryClient.setQueryData(queryKey, data);
  }
}

function memoPatchFromUpdate(
  input: Parameters<typeof updateMemo>[1],
): Partial<Memo> {
  return {
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    ...(input.status !== undefined ? { state: input.status } : {}),
    ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  };
}

function viewToMemoState(view: ViewMode): MemoState {
  if (view === "archived") return "archived";
  if (view === "trashed") return "trashed";
  return "normal";
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

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  errorComponent: RouteErrorPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FlareMoApp,
  validateSearch: (search: Record<string, unknown>) => ({
    view: isViewMode(search.view) ? search.view : undefined,
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    tag: typeof search.tag === "string" && search.tag ? search.tag : undefined,
  }),
});

function PublicShareRoutePage() {
  const { token } = shareRoute.useParams();
  return (
    <Suspense fallback={<RouteLoading />}>
      <PublicSharePage token={token} />
    </Suspense>
  );
}

const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/share/$token",
  component: PublicShareRoutePage,
});

function MemoDetailRoutePage() {
  const { memoId } = memoRoute.useParams();
  return (
    <Suspense fallback={<RouteLoading />}>
      <MemoDetailPage memoId={memoId} />
    </Suspense>
  );
}

const memoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/memo/$memoId",
  component: MemoDetailRoutePage,
});

function RouteErrorPage({ error }: { error: Error }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col items-center justify-center gap-4 px-5 text-center">
      <div>
        <h1 className="text-lg font-semibold">{t("list.errorTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
      </div>
      <Button onClick={() => void router.invalidate()}>
        {t("common.retry")}
      </Button>
    </main>
  );
}

function RouteLoading() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      {t("common.loading")}
    </main>
  );
}

function isViewMode(value: unknown): value is ViewMode {
  return value === "all" || value === "archived" || value === "trashed";
}

const router = createRouter({
  defaultPreload: "intent",
  routeTree: rootRoute.addChildren([indexRoute, memoRoute, shareRoute]),
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster />
    </TooltipProvider>
  );
}
