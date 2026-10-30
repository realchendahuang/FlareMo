import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ExternalLinkIcon,
  FileTextIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import { useI18n } from "@/i18n";
import { formatDate } from "@/lib/date-format";
import { stripResourceName } from "@/lib/utils";

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

  const articles = articlesQuery.data?.articles ?? [];

  return (
    <WorkspaceLayout
      contentMaxWidth={896}
      header={({
        sidebarCollapsed,
        toggleSidebarCollapsed,
        mobileSheetOpen,
        setMobileSheetOpen,
        explorer,
      }) => (
        <WorkspacePageHeader
          contentMaxWidth={896}
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
              <EmptyMedia
                className="bg-accent text-accent-foreground"
                variant="icon"
              >
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
        {articlesQuery.data && articles.length > 0 && (
          <div className="flex flex-col gap-3">
            {articles.map((article) => {
              const published = article.status === "published";
              const trashed = Boolean(article.deleted_at);
              return (
                <Card
                  className={
                    "group relative gap-1.5 py-4 transition-colors " +
                    (trashed ? "opacity-70" : "hover:bg-muted/30")
                  }
                  key={article.id}
                >
                  <CardHeader className="gap-1 pb-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <button
                        className="min-w-0 flex-1 truncate text-left font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                        disabled={trashed}
                        onClick={() =>
                          navigate({
                            to: "/articles/$articleId/edit",
                            params: { articleId: editorId(article.id) },
                          })
                        }
                        type="button"
                      >
                        {article.title || t("article.untitled")}
                      </button>
                      <Badge variant={published ? "success" : "secondary"}>
                        {published
                          ? t("article.publishedBadge")
                          : t("article.draftBadge")}
                      </Badge>
                    </CardTitle>
                    {article.description && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {article.description}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-2 pt-0">
                    <span className="text-xs text-muted-foreground">
                      {trashed
                        ? t("article.inRecycleBin")
                        : published && article.published_at
                          ? t("article.publishedOn", {
                              date: formatDate(article.published_at, locale),
                            })
                          : t("article.editedOn", {
                              date: formatDate(article.updated_at, locale),
                            })}
                    </span>
                    {/* Actions sit above the card-wide click target. */}
                    <div className="relative z-10 flex items-center gap-1">
                      {published && !trashed && (
                        <Button
                          onClick={() =>
                            window.open(`/article/${article.slug}`, "_blank")
                          }
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <ExternalLinkIcon data-icon="inline-start" />
                          {t("article.viewPublic")}
                        </Button>
                      )}
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
                        <Button
                          aria-label={t("common.delete")}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                          disabled={
                            deleteMutation.isPending &&
                            deleteMutation.variables === article.id
                          }
                          onClick={() => setConfirmDeleteId(article.id)}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
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
