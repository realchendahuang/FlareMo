import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ExternalLinkIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { ArticleSummary as Article } from "@/api";
import {
  createArticle,
  deleteArticle,
  listArticles,
  restoreArticle,
} from "@/api";
import { QueryErrorState } from "@/components/query-error-state";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FilterPill } from "@/components/ui/filter-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import { useI18n } from "@/i18n";
import { formatDayTitle, isoDay } from "@/lib/calendar-date";
import { formatDate } from "@/lib/date-format";
import { cn, stripResourceName } from "@/lib/utils";

type ArticleFilter = "all" | "draft" | "published" | "trash";

/** "10月31日" this year, the full date for older pieces. */
function shortDate(value: string, locale: string) {
  const date = new Date(value);
  return date.getFullYear() === new Date().getFullYear()
    ? formatDayTitle(isoDay(date), locale)
    : formatDate(value, locale);
}

/**
 * Article list: drafts and published pieces with one-tap entry back into the
 * editor. Creating an article immediately allocates its draft row, so the
 * editor can bind inline uploads from the first keystroke.
 */
/**
 * Editor URLs carry the bare uuid (`/articles/<uuid>/edit`), matching the
 * `/memo/<uuid>` convention. The namespaced form (`articles/<uuid>`) would
 * percent-encode its slash into the path; browsers normalize `%2F` back to a
 * real slash on a cold load, growing an extra path segment and breaking the
 * route match. The API resolves bare ids either way.
 */
function editorId(articleId: string): string {
  return stripResourceName(articleId, "articles");
}

const FILTER_LABELS = {
  all: "article.filterAll",
  draft: "article.draftBadge",
  published: "article.publishedBadge",
  trash: "view.trash",
} as const;

export function ArticlesPage() {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const articlesQuery = useQuery({
    queryKey: ["articles"],
    // include_deleted feeds the recycle-bin affordances below (restore action
    // + the "in recycle bin" label); without it those rows never arrive.
    queryFn: () => listArticles({ include_deleted: true }),
  });

  const createMutation = useMutation({
    // Seed the declared content language from the author's UI locale. `lang`
    // drives the SSR page's <html lang>, which in turn picks the Han font face
    // (:lang(ja) → Hiragino Mincho vs :lang(zh) → Songti); leaving it null made
    // every article render through the zh-CN fallback, so Japanese articles
    // came out in Chinese glyphs. Authors can still override it via the API.
    mutationFn: () => createArticle({ lang: locale, title: "" }),
    onSuccess: ({ article }) => {
      void queryClient.invalidateQueries({ queryKey: ["articles"] });
      navigate({
        to: "/articles/$articleId/edit",
        params: { articleId: editorId(article.id) },
      });
    },
    onError: () => toast.error(t("article.createFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteArticle(id),
    onSuccess: () => {
      toast.success(t("article.deleted"));
      void queryClient.invalidateQueries({ queryKey: ["articles"] });
    },
    onError: () => toast.error(t("article.deleteFailed")),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreArticle(id),
    onSuccess: () => {
      toast.success(t("article.restored"));
      void queryClient.invalidateQueries({ queryKey: ["articles"] });
    },
    onError: () => toast.error(t("article.restoreFailed")),
  });

  const [filter, setFilter] = useState<ArticleFilter>("all");
  const articles = articlesQuery.data?.articles ?? [];
  // One list, cut by status the way the memory page cuts by kind. The
  // recycle bin is a filter of its own, so deleted drafts never sit among
  // the work in progress.
  const live = articles.filter((article) => !article.deleted_at);
  const buckets: Record<ArticleFilter, Article[]> = {
    all: live,
    draft: live.filter((article) => article.status !== "published"),
    published: live.filter((article) => article.status === "published"),
    trash: articles.filter((article) => article.deleted_at),
  };
  const visible = buckets[filter];
  const openEditor = (article: Article) =>
    navigate({
      to: "/articles/$articleId/edit",
      params: { articleId: editorId(article.id) },
    });

  return (
    <WorkspaceLayout
      header={({
        sidebarCollapsed,
        toggleSidebarCollapsed,
        mobileSheetOpen,
        setMobileSheetOpen,
        explorer,
      }) => (
        <WorkspacePageHeader
          actions={
            <Button
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
              size="sm"
              type="button"
            >
              {createMutation.isPending ? (
                <Spinner className="size-4" />
              ) : (
                <PlusIcon className="size-4" />
              )}
              {t("article.newAction")}
            </Button>
          }
          explorer={explorer}
          icon={
            <FileTextIcon className="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
          }
          mobileSheetOpen={mobileSheetOpen}
          setMobileSheetOpen={setMobileSheetOpen}
          sidebarCollapsed={sidebarCollapsed}
          title={t("nav.articles")}
          toggleSidebarCollapsed={toggleSidebarCollapsed}
        />
      )}
    >
      <div className="flex flex-col gap-5 py-2">
        {articlesQuery.isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {articlesQuery.isError && (
          <QueryErrorState
            isRetrying={articlesQuery.isFetching}
            onRetry={() => void articlesQuery.refetch()}
          />
        )}
        {articlesQuery.data && articles.length === 0 && (
          <Empty className="min-h-72 border border-border/60 bg-card/50 motion-safe:animate-rise">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileTextIcon className="size-5" />
              </EmptyMedia>
              <EmptyTitle>{t("article.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("article.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                disabled={createMutation.isPending}
                size="sm"
                variant="outline"
                onClick={() => createMutation.mutate()}
              >
                <PlusIcon className="size-4" data-icon="inline-start" />
                {t("article.newAction")}
              </Button>
            </EmptyContent>
          </Empty>
        )}
        {articles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(["all", "draft", "published", "trash"] as const).map((key) =>
              key === "trash" &&
              buckets.trash.length === 0 &&
              filter !== "trash" ? null : (
                <FilterPill
                  active={filter === key}
                  count={buckets[key].length}
                  key={key}
                  label={t(FILTER_LABELS[key])}
                  onClick={() => setFilter(key)}
                />
              ),
            )}
          </div>
        )}
        {articles.length > 0 && visible.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            {t("article.filterEmpty")}
          </p>
        )}
        {visible.length > 0 && (
          <ul className="paper divide-y divide-border/60 overflow-hidden rounded-xl border border-border/80 bg-card">
            {visible.map((article) => {
              const published = article.status === "published";
              const trashed = Boolean(article.deleted_at);
              return (
                <li
                  className={cn(
                    "group relative flex items-center gap-3 px-4 py-3 motion-safe:transition-colors",
                    !trashed && "hover:bg-muted/40",
                  )}
                  key={article.id}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <button
                      className={cn(
                        "min-w-0 truncate text-left text-[15px] font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-3 focus-visible:after:ring-ring/25 focus-visible:after:ring-inset",
                        !article.title && "text-muted-foreground",
                        trashed && "text-muted-foreground",
                      )}
                      disabled={trashed}
                      type="button"
                      onClick={() => openEditor(article)}
                    >
                      {article.title || t("article.untitled")}
                    </button>
                    {article.description && (
                      <p className="truncate text-xs text-muted-foreground">
                        {article.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {!trashed &&
                      (published ? (
                        <span className="inline-flex items-center gap-1.5 text-success-emphasis">
                          <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full bg-success"
                          />
                          {t("article.publishedBadge")}
                        </span>
                      ) : (
                        <span>{t("article.draftBadge")}</span>
                      ))}
                    <span className="hidden tabular-nums sm:inline">
                      {shortDate(
                        published && article.published_at
                          ? article.published_at
                          : article.updated_at,
                        locale,
                      )}
                    </span>
                  </div>
                  {/* Actions sit above the row-wide click target. */}
                  <div className="relative z-10 -me-2 flex shrink-0 items-center">
                    {trashed ? (
                      <Button
                        disabled={
                          restoreMutation.isPending &&
                          restoreMutation.variables === article.id
                        }
                        onClick={() => restoreMutation.mutate(article.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {t("article.restoreAction")}
                      </Button>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              aria-label={t("common.more")}
                              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100"
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <MoreHorizontalIcon />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          {published && (
                            <DropdownMenuItem
                              onClick={() =>
                                window.open(
                                  `/article/${article.slug}`,
                                  "_blank",
                                  "noopener",
                                )
                              }
                            >
                              <ExternalLinkIcon data-icon="inline-start" />
                              {t("article.viewPublic")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setConfirmDeleteId(article.id)}
                          >
                            <Trash2Icon data-icon="inline-start" />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("article.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("article.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeleteId) deleteMutation.mutate(confirmDeleteId);
                setConfirmDeleteId(null);
              }}
              variant="destructive"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspaceLayout>
  );
}
