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
import { lazy, Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ApiError,
  bindMemoAttachments,
  createMemo,
  createShare,
  deleteAttachment,
  exportData,
  getMemoStats,
  hardDeleteMemo,
  importData,
  listMemos,
  type Memo,
  type MemoState,
  type MemoStatsResponse,
  type MemoVisibility,
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
import { type TranslationKey, useI18n } from "@/i18n";

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
      search: (current) => ({ ...current, q: q || undefined }),
    });
  const [sharesByMemo, setSharesByMemo] = useState<Map<string, Share>>(
    new Map(),
  );
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const debouncedQuery = useDebouncedValue(query.trim(), 250);

  const memosQuery = useInfiniteQuery({
    queryKey: ["memos", view, debouncedQuery, activeTag],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listMemos({
        include_deleted: view === "trashed",
        page_size: PAGE_SIZE,
        page_token: pageParam,
        q: debouncedQuery || undefined,
        state: viewToMemoState(view),
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

  const createMutation = useMutation({
    mutationFn: (input: {
      content: string;
      visibility: MemoVisibility;
      tags: string[];
      files: File[];
    }) =>
      createMemoWithAttachments({
        ...input,
        content: input.content || t("toast.untitledAttachment"),
      }),
    onSuccess: () => {
      toast.success(t("toast.saved"));
      void invalidateWorkspace();
    },
    onError: handleMutationError,
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
          <header className="z-20 shrink-0 bg-background/95 backdrop-blur">
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
                  {viewTitle(view, t)}
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
                query={query}
                setQuery={setQuery}
                t={t}
              />
            </div>
          </header>
          <main className="mx-auto min-h-0 w-full max-w-[640px] flex-1 overflow-y-auto px-5 pb-8 lg:px-3">
            <SearchBox
              className="mb-3 md:hidden motion-safe:animate-[flaremo-rise_160ms_ease-out_both]"
              query={query}
              setQuery={setQuery}
              t={t}
            />
            <div className="flex flex-col gap-3">
              {view === "all" && (
                <MemoComposer
                  isPending={createMutation.isPending}
                  onSubmit={async ({ content, visibility, tags, files }) => {
                    await createMutation.mutateAsync({
                      content,
                      visibility,
                      tags,
                      files,
                    });
                  }}
                />
              )}
              {(activeTag || query.trim()) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground motion-safe:animate-[flaremo-rise_140ms_ease-out_both]">
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
              <MemoList
                attachmentsByMemo={attachmentsByMemo}
                hasError={memosQuery.isError}
                hasNextPage={Boolean(memosQuery.hasNextPage)}
                isFetchingNextPage={memosQuery.isFetchingNextPage}
                isLoading={memosQuery.isLoading}
                memos={memos}
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
  query,
  setQuery,
  t,
}: {
  className: string;
  query: string;
  setQuery: (value: string) => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <div className={className}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={t("common.search")}
          className="h-9 rounded-xl border-0 bg-muted pl-9 shadow-none focus-visible:ring-1"
          placeholder={t("common.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
    </div>
  );
}

async function createMemoWithAttachments(input: {
  content: string;
  visibility: MemoVisibility;
  tags: string[];
  files: File[];
}) {
  const uploadResults = await Promise.allSettled(
    input.files.map((file) => uploadAttachment({ file })),
  );
  const attachments = uploadResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failedUpload = uploadResults.find(
    (result) => result.status === "rejected",
  );
  if (failedUpload?.status === "rejected") {
    await cleanupAttachments(attachments);
    throw toError(failedUpload.reason);
  }

  let memo: Memo | undefined;
  try {
    memo = await createMemo({
      content: input.content,
      visibility: input.visibility,
      payload: { tags: input.tags },
      source: "web",
    });
    if (attachments.length > 0) {
      await bindMemoAttachments(
        memo.name,
        attachments.map((attachment) => attachment.name),
      );
    }
    return memo;
  } catch (error) {
    await Promise.allSettled([
      ...attachments.map((attachment) => deleteAttachment(attachment.id)),
      ...(memo ? [hardDeleteMemo(memo.id)] : []),
    ]);
    throw toError(error);
  }
}

async function cleanupAttachments(
  attachments: Array<{ id: string }>,
): Promise<void> {
  await Promise.allSettled(
    attachments.map((attachment) => deleteAttachment(attachment.id)),
  );
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
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
