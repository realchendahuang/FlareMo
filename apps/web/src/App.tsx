import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  exportData,
  getPublicShare,
  hardDeleteMemo,
  importData,
  listMemoAttachments,
  listMemos,
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
import { type TranslationKey, useI18n } from "@/i18n";
import { extractTags, formatMemoTime, getAllTags } from "@/lib/memo";

function FlareMoApp() {
  const { t, toggleLocale } = useI18n();
  const queryClient = useQueryClient();
  const [view, setView] = useState<ViewMode>("all");
  const [activeTag, setActiveTag] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [sharesByMemo, setSharesByMemo] = useState<Map<string, Share>>(
    new Map(),
  );

  const normalMemosQuery = useQuery({
    queryKey: ["memos", "normal"],
    queryFn: () => listMemos({ state: "normal" }),
    retry: false,
  });
  const archivedMemosQuery = useQuery({
    queryKey: ["memos", "archived"],
    queryFn: () => listMemos({ state: "archived" }),
    retry: false,
  });
  const trashedMemosQuery = useQuery({
    queryKey: ["memos", "trashed"],
    queryFn: () => listMemos({ state: "trashed", include_deleted: true }),
    retry: false,
  });

  const normalMemos = normalMemosQuery.data?.memos ?? [];
  const archivedMemos = archivedMemosQuery.data?.memos ?? [];
  const trashedMemos = trashedMemosQuery.data?.memos ?? [];
  const visibleMemos = useMemo(
    () => [...normalMemos, ...archivedMemos],
    [normalMemos, archivedMemos],
  );
  const attachmentKey = visibleMemos.map((memo) => memo.name).join(",");
  const attachmentsQuery = useQuery({
    enabled: visibleMemos.length > 0,
    queryKey: ["attachments", attachmentKey],
    retry: false,
    queryFn: async () => {
      const entries = await Promise.all(
        visibleMemos.map(
          async (memo) =>
            [
              memo.name,
              (await listMemoAttachments(memo.name)).attachments,
            ] as const,
        ),
      );
      return new Map(entries);
    },
  });

  const invalidateMemos = () =>
    queryClient.invalidateQueries({ queryKey: ["memos"] });
  const invalidateAttachments = () =>
    queryClient.invalidateQueries({ queryKey: ["attachments"] });
  const handleMutationError = (error: Error) => {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      toast.error(t("toast.accessRequired"));
      return;
    }
    toast.error(error.message);
  };

  const createMutation = useMutation({
    mutationFn: async (input: {
      content: string;
      visibility: Parameters<typeof createMemo>[0]["visibility"];
      tags: string[];
      files: File[];
    }) => {
      const memo = await createMemo({
        content: input.content || t("toast.untitledAttachment"),
        visibility: input.visibility,
        payload: { tags: input.tags },
        source: "web",
      });
      if (input.files.length > 0) {
        const attachments = await Promise.all(
          input.files.map((file) =>
            uploadAttachment({ file, memo: memo.name }),
          ),
        );
        await bindMemoAttachments(
          memo.name,
          attachments.map((attachment) => attachment.name),
        );
      }
      return memo;
    },
    onSuccess: () => {
      toast.success(t("toast.saved"));
      void invalidateMemos();
      void invalidateAttachments();
    },
    onError: handleMutationError,
  });

  const trashMutation = useMutation({
    mutationFn: trashMemo,
    onSuccess: () => {
      toast.success(t("toast.movedToTrash"));
      void invalidateMemos();
    },
    onError: handleMutationError,
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => updateMemo(id, { status: "normal" }),
    onSuccess: () => {
      toast.success(t("toast.restored"));
      void invalidateMemos();
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
      void invalidateMemos();
    },
    onError: handleMutationError,
  });

  const hardDeleteMutation = useMutation({
    mutationFn: hardDeleteMemo,
    onSuccess: () => {
      toast.success(t("toast.deleted"));
      void invalidateMemos();
      void invalidateAttachments();
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
      void invalidateMemos();
      void invalidateAttachments();
    },
    onError: handleMutationError,
  });

  const allTags = useMemo(() => getAllTags(normalMemos), [normalMemos]);
  const sourceMemos =
    view === "trashed"
      ? trashedMemos
      : view === "archived"
        ? archivedMemos
        : normalMemos;
  const filteredMemos = useMemo(
    () =>
      sourceMemos.filter((memo) => {
        const textMatch = query.trim()
          ? memo.content.toLowerCase().includes(query.trim().toLowerCase())
          : true;
        const tagMatch = activeTag
          ? (memo.payload.tags ?? []).includes(activeTag)
          : true;
        return textMatch && tagMatch;
      }),
    [activeTag, query, sourceMemos],
  );
  const appShell = (
    <FlareMoExplorer
      activeTag={activeTag}
      activeView={view}
      archivedCount={archivedMemos.length}
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
            variant="ghost"
            onClick={async () => {
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
            }}
          >
            <DownloadIcon />
          </Button>
          <Button asChild size="icon-sm" variant="ghost">
            <label
              aria-label={t("common.import")}
              htmlFor="flaremo-import-file"
            >
              <UploadIcon />
              <Input
                accept="application/json"
                className="hidden"
                id="flaremo-import-file"
                type="file"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  const text = await file.text();
                  importMutation.mutate(JSON.parse(text) as unknown);
                }}
              />
            </label>
          </Button>
        </div>
      }
      memoCount={normalMemos.length}
      memos={visibleMemos}
      tags={allTags}
      trashedCount={trashedMemos.length}
      onTagChange={setActiveTag}
      onViewChange={setView}
    />
  );

  return (
    <TooltipProvider>
      <div className="h-svh overflow-hidden bg-background">
        <div className="mx-auto flex h-full w-full max-w-[950px]">
          <div className="no-scrollbar hidden h-full w-[312px] shrink-0 overflow-y-auto border-r bg-background lg:block">
            {appShell}
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
                  <SheetContent className="w-[312px] p-0" side="left">
                    <SheetTitle className="sr-only">
                      {t("sidebar.title")}
                    </SheetTitle>
                    {appShell}
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
                <div className="relative hidden w-[243px] md:block">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-9 rounded-xl border-0 bg-muted pl-9 shadow-none focus-visible:ring-1"
                    placeholder={t("common.search")}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
              </div>
            </header>
            <main className="mx-auto min-h-0 w-full max-w-[640px] flex-1 overflow-y-auto px-5 pb-8 lg:px-3">
              <div className="mb-3 md:hidden motion-safe:animate-[flaremo-rise_160ms_ease-out_both]">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-9 rounded-xl border-0 bg-muted pl-9 shadow-none focus-visible:ring-1"
                    placeholder={t("common.search")}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {view === "all" && (
                  <MemoComposer
                    isPending={createMutation.isPending}
                    onSubmit={({ content, visibility, tags, files }) =>
                      createMutation.mutate({
                        content,
                        visibility,
                        tags,
                        files,
                      })
                    }
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
                  attachmentsByMemo={attachmentsQuery.data ?? new Map()}
                  hasError={
                    normalMemosQuery.isError ||
                    archivedMemosQuery.isError ||
                    trashedMemosQuery.isError
                  }
                  isLoading={
                    normalMemosQuery.isLoading ||
                    archivedMemosQuery.isLoading ||
                    trashedMemosQuery.isLoading
                  }
                  memos={filteredMemos}
                  sharesByMemo={sharesByMemo}
                  onArchive={(id) => {
                    const memo = visibleMemos.find(
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
                  onHardDelete={(id) => hardDeleteMutation.mutate(id)}
                  onPin={(id, pinned) =>
                    updateMutation.mutate({ id, input: { pinned } })
                  }
                  onRestore={(id) => restoreMutation.mutate(id)}
                  onShare={(id) => shareMutation.mutate(id)}
                  onTrash={(id) => trashMutation.mutate(id)}
                  onUpdate={(id, input) => updateMutation.mutate({ id, input })}
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
