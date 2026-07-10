import {
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
} from "@tanstack/react-router";
import {
  DownloadIcon,
  FileIcon,
  LanguagesIcon,
  MenuIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ApiError,
  bindMemoAttachments,
  createMemo,
  createShare,
  deleteAttachment,
  exportData,
  getMemoStats,
  getPublicShare,
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
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { type TranslationKey, useI18n } from "@/i18n";
import { extractTags, formatMemoTime } from "@/lib/memo";

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
  const [view, setView] = useState<ViewMode>("all");
  const [activeTag, setActiveTag] = useState<string | undefined>();
  const [query, setQuery] = useState("");
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
    onSuccess: () => {
      toast.success(t("toast.movedToTrash"));
      void invalidateWorkspace();
    },
    onError: handleMutationError,
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => updateMemo(id, { status: "normal" }),
    onSuccess: () => {
      toast.success(t("toast.restored"));
      void invalidateWorkspace();
    },
    onError: handleMutationError,
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof updateMemo>[1];
    }) => updateMemo(id, input),
    onSuccess: () => {
      toast.success(t("toast.updated"));
      void invalidateWorkspace();
    },
    onError: handleMutationError,
  });

  const hardDeleteMutation = useMutation({
    mutationFn: hardDeleteMemo,
    onSuccess: () => {
      toast.success(t("toast.deleted"));
      void invalidateWorkspace();
    },
    onError: handleMutationError,
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
    <TooltipProvider>
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
      <Toaster />
    </TooltipProvider>
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
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FlareMoApp,
});

function PublicSharePage() {
  const { locale, t } = useI18n();
  const { token } = shareRoute.useParams();
  const shareQuery = useQuery({
    queryKey: ["public-share", token],
    queryFn: () => getPublicShare(token),
  });
  const share = shareQuery.data;
  const tags = share
    ? (share.memo.payload.tags ?? extractTags(share.memo.content))
    : [];

  return (
    <div className="min-h-svh bg-background px-4 py-6">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <header className="border-b pb-4">
          <div className="font-heading text-lg font-semibold">FlareMo</div>
          <div className="text-sm text-muted-foreground">
            {t("share.title")}
          </div>
        </header>
        {shareQuery.isLoading && (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        )}
        {shareQuery.isError && (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">
            {t("share.unavailable")}
          </div>
        )}
        {share && (
          <article className="rounded-md border bg-card p-5 shadow-sm">
            <div className="mb-4 text-sm text-muted-foreground">
              {formatMemoTime(share.memo.display_time, locale)}
            </div>
            <div className="whitespace-pre-wrap text-base leading-7">
              {share.memo.content}
            </div>
            {tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    className="rounded-md border px-2 py-1 text-xs text-muted-foreground"
                    key={tag}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            {share.attachments.length > 0 && (
              <div className="mt-5 flex flex-col gap-2">
                {share.attachments.map((attachment) => (
                  <a
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                    href={attachment.download_url}
                    key={attachment.name}
                  >
                    <FileIcon />
                    <span className="min-w-0 flex-1 truncate">
                      {attachment.filename}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </article>
        )}
      </main>
    </div>
  );
}

const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/share/$token",
  component: PublicSharePage,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, shareRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return <RouterProvider router={router} />;
}
