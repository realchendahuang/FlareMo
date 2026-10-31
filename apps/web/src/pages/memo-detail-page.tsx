import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon, BrainIcon, FileTextIcon, PinIcon } from "lucide-react";
import type { Memo, MemoContext, RelatedMemo } from "@/api";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import { useI18n } from "@/i18n";
import { formatMemoRelativeTime, formatMemoTime, memoTitle } from "@/lib/memo";
import type { MemoDetailTaskInteraction } from "./memo-detail/content-tab";
import { ContentTab } from "./memo-detail/content-tab";
import { HistoryTab } from "./memo-detail/history-tab";
import { RelationsTab } from "./memo-detail/relations-tab";
import { SharingTab } from "./memo-detail/sharing-tab";
import { useMemoDetail } from "./memo-detail/use-memo-detail";

export function MemoDetailPage({ memoId }: { memoId: string }) {
  const { locale, t } = useI18n();
  const {
    contextQuery,
    relationCandidatesQuery,
    relatedQuery,
    relatedMemo,
    setRelatedMemo,
    shareMutation,
    revokeMutation,
    restoreMutation,
    relationMutation,
    rememberMutation,
    taskInteraction,
  } = useMemoDetail(memoId);

  return (
    <WorkspaceLayout
      contentMaxWidth={768}
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
              className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              render={
                <Link
                  search={{
                    compose: undefined,
                    q: undefined,
                    space: undefined,
                    tag: undefined,
                    untagged: undefined,
                    view: undefined,
                  }}
                  to="/"
                />
              }
              size="sm"
              variant="ghost"
            >
              <ArrowLeftIcon className="size-3.5 rtl:-rotate-180" />
              {t("common.back")}
            </Button>
          }
          explorer={explorer}
          icon={
            <FileTextIcon className="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
          }
          mobileSheetOpen={mobileSheetOpen}
          setMobileSheetOpen={setMobileSheetOpen}
          sidebarCollapsed={sidebarCollapsed}
          title={
            // The note's own opening line, not its resource name: a header
            // reading `memos/a60cdd29-…` identifies the row to the database
            // and to nobody else. Falls back to the timestamp for a memo whose
            // body is only tags or media.
            contextQuery.data ? (
              <span className="truncate" title={contextQuery.data.memo.name}>
                {memoTitle(contextQuery.data.memo.content) ||
                  formatMemoRelativeTime(
                    contextQuery.data.memo.create_time,
                    locale,
                  )}
              </span>
            ) : contextQuery.isError ? (
              t("detail.unavailable")
            ) : (
              <>
                <Skeleton aria-hidden className="h-4 w-40" />
                <span className="sr-only">{t("common.loading")}</span>
              </>
            )
          }
          toggleSidebarCollapsed={toggleSidebarCollapsed}
        />
      )}
    >
      <div className="flex flex-col gap-4 py-2">
        {contextQuery.isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
        {contextQuery.isError && (
          <QueryErrorState
            className="min-h-72 border text-muted-foreground"
            isRetrying={contextQuery.isFetching}
            onRetry={() => void contextQuery.refetch()}
          />
        )}
        {contextQuery.data && (
          <MemoDetail
            candidates={(relationCandidatesQuery.data?.memos ?? []).filter(
              (memo) =>
                memo.name !== contextQuery.data.memo.name &&
                !contextQuery.data.relations.some(
                  ({ relation }) => relation.related_memo === memo.name,
                ),
            )}
            context={contextQuery.data}
            canManage={contextQuery.data.can_manage}
            canGovern={contextQuery.data.can_govern}
            isSearching={relationCandidatesQuery.isFetching}
            locale={locale}
            related={relatedQuery.data?.memos ?? []}
            relatedPending={relatedQuery.isPending}
            relatedMemo={relatedMemo}
            setRelatedMemo={setRelatedMemo}
            onAddRelation={(name) => {
              const relations = contextQuery.data.relations.map(
                ({ relation }) => ({
                  related_memo: relation.related_memo,
                  type: relation.type,
                }),
              );
              if (relations.some((item) => item.related_memo === name)) return;
              relationMutation.mutate({
                action: "add",
                relations: [
                  ...relations,
                  { related_memo: name, type: "reference" },
                ],
              });
            }}
            onCreateShare={() => shareMutation.mutate()}
            onRestore={(revision) => restoreMutation.mutate(revision)}
            onRemoveRelation={(name) =>
              relationMutation.mutate({
                action: "remove",
                relations: contextQuery.data.relations
                  .filter(({ relation }) => relation.related_memo !== name)
                  .map(({ relation }) => ({
                    related_memo: relation.related_memo,
                    type: relation.type,
                  })),
              })
            }
            onRevoke={(share) => revokeMutation.mutate(share)}
            onRemember={() => rememberMutation.mutate()}
            taskInteraction={taskInteraction}
            rememberPending={rememberMutation.isPending}
            relationPending={relationMutation.isPending}
            restorePending={restoreMutation.isPending}
            revokePending={revokeMutation.isPending}
            sharePending={shareMutation.isPending}
          />
        )}
      </div>
    </WorkspaceLayout>
  );
}

function MemoDetail({
  canManage,
  canGovern,
  taskInteraction,
  candidates,
  context,
  isSearching,
  locale,
  related,
  relatedPending,
  relatedMemo,
  setRelatedMemo,
  onAddRelation,
  onCreateShare,
  onRemember,
  onRestore,
  onRemoveRelation,
  onRevoke,
  rememberPending,
  relationPending,
  restorePending,
  revokePending,
  sharePending,
}: {
  canManage: boolean;
  canGovern: boolean;
  taskInteraction: MemoDetailTaskInteraction | undefined;
  candidates: Memo[];
  context: MemoContext;
  isSearching: boolean;
  locale: string;
  related: RelatedMemo[];
  relatedPending: boolean;
  relatedMemo: string;
  setRelatedMemo: (value: string) => void;
  onAddRelation: (name: string) => void;
  onCreateShare: () => void;
  onRemember: () => void;
  onRestore: (revision: string) => void;
  onRemoveRelation: (name: string) => void;
  onRevoke: (share: string) => void;
  rememberPending: boolean;
  relationPending: boolean;
  restorePending: boolean;
  revokePending: boolean;
  sharePending: boolean;
}) {
  const { t } = useI18n();
  // The links tab is about wiki links; a comment thread shows under the
  // content instead. The page's relation edits still read the full context,
  // so replacing links never drops a comment's parent relation.
  const isLink = ({ relation }: { relation: { type: string } }) =>
    relation.type !== "comment";
  const linkContext = {
    ...context,
    relations: context.relations.filter(isLink),
    backlinks: context.backlinks.filter(isLink),
  };
  const linkCount = linkContext.relations.length + linkContext.backlinks.length;
  return (
    // overflow-clip keeps the rounded clipping but, unlike the Card base's
    // overflow-hidden, does not turn the card into a scroll container — the
    // sticky reading transport needs the viewport as its scrollport.
    <Card className="overflow-clip">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-normal text-muted-foreground">
            {formatMemoTime(context.memo.display_time, locale)}
            {context.memo.creator_name ? ` · ${context.memo.creator_name}` : ""}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {context.memo.pinned && (
              <Badge variant="brand">
                <PinIcon data-icon="inline-start" />
                {t("memo.pinnedBadge")}
              </Badge>
            )}
            {/* Private is the default, so only shared notes say so — the
                same rule as the timeline card. */}
            {context.memo.visibility !== "private" && (
              <Badge className="text-muted-foreground" variant="outline">
                {t(`visibility.${context.memo.visibility}`)}
              </Badge>
            )}
            <Button
              disabled={rememberPending}
              size="sm"
              variant="ghost"
              onClick={onRemember}
            >
              <BrainIcon data-icon="inline-start" />
              {t("memory.newMemory")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="content">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="content">{t("detail.content")}</TabsTrigger>
            <TabsTrigger value="relations">
              {t("detail.relations")}
              {linkCount > 0 ? ` (${linkCount})` : ""}
            </TabsTrigger>
            {(canManage || canGovern) && (
              <TabsTrigger value="history">{t("detail.history")}</TabsTrigger>
            )}
            {canManage && (
              <TabsTrigger value="sharing">{t("detail.sharing")}</TabsTrigger>
            )}
          </TabsList>
          <ContentTab
            context={context}
            related={related}
            relatedPending={relatedPending}
            taskInteraction={taskInteraction}
          />
          <RelationsTab
            canManage={canManage}
            candidates={candidates}
            context={linkContext}
            isSearching={isSearching}
            relatedMemo={relatedMemo}
            relationPending={relationPending}
            setRelatedMemo={setRelatedMemo}
            onAddRelation={onAddRelation}
            onRemoveRelation={onRemoveRelation}
          />
          {(canManage || canGovern) && (
            <HistoryTab
              canManage={canManage}
              context={context}
              locale={locale}
              restorePending={restorePending}
              onRestore={onRestore}
            />
          )}
          {canManage && (
            <SharingTab
              context={context}
              revokePending={revokePending}
              sharePending={sharePending}
              onCreateShare={onCreateShare}
              onRevoke={onRevoke}
            />
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}
