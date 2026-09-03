import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BrainIcon,
  ClipboardIcon,
  Link2Icon,
  Loader2Icon,
  RotateCcwIcon,
  UnlinkIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { RelatedMemo } from "@/api";
import {
  createMemoryFromMemo,
  createShare,
  getMemoContext,
  getRelatedMemos,
  listMemos,
  replaceMemoRelations,
  restoreMemoRevision,
  revokeShare,
} from "@/api";
import { AttachmentGallery } from "@/components/attachment-gallery";
import { LazyMemoContent } from "@/components/lazy-memo-content";
import { SubpageHeader } from "@/components/subpage-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";
import { formatMemoTime } from "@/lib/memo";

export function MemoDetailPage({ memoId }: { memoId: string }) {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [relatedMemo, setRelatedMemo] = useState("");
  const queryKey = ["memo-context", memoId] as const;
  const contextQuery = useQuery({
    queryKey,
    queryFn: () => getMemoContext(memoId),
    retry: false,
  });
  const relationCandidatesQuery = useQuery({
    queryKey: ["relation-candidates", relatedMemo.trim()],
    queryFn: () => listMemos({ q: relatedMemo.trim(), page_size: 8 }),
    enabled: relatedMemo.trim().length >= 2,
  });
  const relatedQuery = useQuery({
    queryKey: ["memo-related", memoId],
    queryFn: () => getRelatedMemos(memoId),
    retry: false,
  });
  const invalidateMemo = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ["memo-related", memoId] }),
      queryClient.invalidateQueries({ queryKey: ["memos"] }),
      queryClient.invalidateQueries({ queryKey: ["memo-stats"] }),
    ]);
  };
  const shareMutation = useMutation({
    mutationFn: () => createShare(contextQuery.data?.memo.name ?? memoId),
    onSuccess: async () => {
      toast.success(t("toast.shareCreated"));
      await invalidateMemo();
    },
    onError: (error) => toast.error(toError(error).message),
  });
  const revokeMutation = useMutation({
    mutationFn: revokeShare,
    onSuccess: async () => {
      toast.success(t("toast.shareRevoked"));
      await invalidateMemo();
    },
    onError: (error) => toast.error(toError(error).message),
  });
  const restoreMutation = useMutation({
    mutationFn: (revision: string) =>
      restoreMemoRevision(contextQuery.data?.memo.name ?? memoId, revision),
    onSuccess: async (memo) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof getMemoContext>>>(
        queryKey,
        (context) => (context ? { ...context, memo } : context),
      );
      toast.success(t("toast.revisionRestored"));
      await invalidateMemo();
    },
    onError: (error) => toast.error(toError(error).message),
  });
  const relationMutation = useMutation({
    mutationFn: ({
      relations,
    }: {
      action: "add" | "remove";
      relations: Array<{
        related_memo: string;
        type: "reference" | "comment";
      }>;
    }) =>
      replaceMemoRelations(contextQuery.data?.memo.name ?? memoId, relations),
    onSuccess: async (_data, variables) => {
      setRelatedMemo("");
      toast.success(
        t(
          variables.action === "add"
            ? "toast.relationAdded"
            : "toast.relationRemoved",
        ),
      );
      await invalidateMemo();
    },
    onError: (error) => toast.error(toError(error).message),
  });

  const rememberMutation = useMutation({
    mutationFn: () =>
      createMemoryFromMemo(contextQuery.data?.memo.name ?? memoId, {
        type: "semantic",
        kind: "fact",
        scope_type: "global",
        tier: "normal",
        importance: 50,
      }),
    onSuccess: async (result) => {
      toast.success(
        result.duplicate ? t("toast.memoryConfirmed") : t("toast.saved"),
      );
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(toError(error).message),
  });

  return (
    <div className="min-h-svh bg-background px-4 py-5 sm:py-8">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <SubpageHeader />

        {contextQuery.isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
        {contextQuery.isError && (
          <Empty className="min-h-72 border">
            <EmptyHeader>
              <EmptyTitle>{t("detail.unavailable")}</EmptyTitle>
              <EmptyDescription>{t("list.errorDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
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
            isSearching={relationCandidatesQuery.isFetching}
            locale={locale}
            related={relatedQuery.data?.memos ?? []}
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
            rememberPending={rememberMutation.isPending}
            relationPending={relationMutation.isPending}
            restorePending={restoreMutation.isPending}
            revokePending={revokeMutation.isPending}
            sharePending={shareMutation.isPending}
          />
        )}
      </main>
    </div>
  );
}

function MemoDetail({
  canManage,
  candidates,
  context,
  isSearching,
  locale,
  related,
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
  candidates: Awaited<ReturnType<typeof listMemos>>["memos"];
  context: Awaited<ReturnType<typeof getMemoContext>>;
  isSearching: boolean;
  locale: string;
  related: RelatedMemo[];
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
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-normal text-muted-foreground">
            {formatMemoTime(context.memo.display_time, locale)}
            {context.memo.creator_name ? ` · ${context.memo.creator_name}` : ""}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            {context.memo.pinned && <Badge>{t("memo.pinnedBadge")}</Badge>}
            <Badge variant="outline">
              {t(`visibility.${context.memo.visibility}`)}
            </Badge>
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
              {context.relations.length + context.backlinks.length > 0
                ? ` (${context.relations.length + context.backlinks.length})`
                : ""}
            </TabsTrigger>
            {canManage && (
              <TabsTrigger value="history">{t("detail.history")}</TabsTrigger>
            )}
            {canManage && (
              <TabsTrigger value="sharing">{t("detail.sharing")}</TabsTrigger>
            )}
          </TabsList>
          <TabsContent className="flex flex-col gap-5 pt-4" value="content">
            <LazyMemoContent
              className="text-base"
              content={context.memo.content}
            />
            <AttachmentGallery attachments={context.attachments} />
            {context.memories.length > 0 && (
              <section className="flex flex-col gap-2 border-t border-border/60 pt-4">
                <h2 className="text-sm font-medium">{t("memory.title")}</h2>
                {context.memories.map((memory) => (
                  <div
                    className="rounded-lg border p-3 text-sm"
                    key={memory.id}
                  >
                    <div className="whitespace-pre-wrap">{memory.content}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="outline">
                        {t(`memory.type.${memory.type}`)}
                      </Badge>
                      <Badge variant="outline">
                        {t(`memory.kind.${memory.kind}`)}
                      </Badge>
                      <Badge variant="flame">
                        {t(`memory.verification.${memory.verification}`)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </section>
            )}
            {related.length > 0 && (
              <section className="flex flex-col gap-2 border-t border-border/60 pt-4">
                <h2 className="text-sm font-medium">{t("detail.related")}</h2>
                {related.map((memo) => (
                  <Link
                    className="rounded-lg border p-3 text-sm transition-colors hover:bg-muted"
                    key={memo.name}
                    params={{ memoId: memo.id }}
                    to="/memo/$memoId"
                  >
                    <div className="line-clamp-2">{memo.content}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {[
                        memo.via_relation
                          ? t("detail.relatedViaRelation")
                          : null,
                        memo.shared_tags.length > 0
                          ? t("detail.relatedSharedTags", {
                              tags: memo.shared_tags
                                .map((tag) => `#${tag}`)
                                .join(" "),
                            })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </Link>
                ))}
              </section>
            )}
          </TabsContent>
          <TabsContent className="flex flex-col gap-4 pt-4" value="relations">
            {canManage && (
              <div className="flex flex-col gap-2">
                <Input
                  aria-label={t("detail.relatedMemoPlaceholder")}
                  placeholder={t("detail.relatedMemoPlaceholder")}
                  value={relatedMemo}
                  onChange={(event) => setRelatedMemo(event.target.value)}
                />
                {relatedMemo.trim().length >= 2 && (
                  <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-1">
                    {isSearching && (
                      <p className="px-2 py-1 text-xs text-muted-foreground">
                        {t("detail.searchingRelations")}
                      </p>
                    )}
                    {!isSearching && candidates.length === 0 && (
                      <p className="px-2 py-1 text-xs text-muted-foreground">
                        {t("detail.noRelationCandidates")}
                      </p>
                    )}
                    {candidates.map((candidate) => (
                      <button
                        className="rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-background"
                        disabled={relationPending}
                        key={candidate.name}
                        type="button"
                        onClick={() => onAddRelation(candidate.name)}
                      >
                        <span className="line-clamp-2">
                          {candidate.content}
                        </span>
                        <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                          {candidate.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <RelationGroup
              emptyText={t("detail.noOutgoing")}
              label={t("detail.outgoing")}
              relations={context.relations}
              onRemove={canManage ? onRemoveRelation : undefined}
            />
            <RelationGroup
              label={t("detail.backlinks")}
              relations={context.backlinks}
            />
          </TabsContent>
          {canManage && (
            <TabsContent className="flex flex-col gap-2 pt-4" value="history">
              {context.revisions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("detail.noRevisions")}
                </p>
              )}
              {context.revisions.map((revision) => (
                <div
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                  key={revision.name}
                >
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">
                      {formatMemoTime(revision.create_time, locale)}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm">
                      {revision.content}
                    </p>
                  </div>
                  <Button
                    disabled={restorePending}
                    size="sm"
                    variant="outline"
                    onClick={() => onRestore(revision.name)}
                  >
                    <RotateCcwIcon data-icon="inline-start" />
                    {t("detail.restoreRevision")}
                  </Button>
                </div>
              ))}
            </TabsContent>
          )}
          {canManage && (
            <TabsContent className="flex flex-col gap-3 pt-4" value="sharing">
              <div>
                <Button
                  disabled={sharePending}
                  size="sm"
                  onClick={onCreateShare}
                >
                  {sharePending ? (
                    <Loader2Icon
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <Link2Icon data-icon="inline-start" />
                  )}
                  {t("detail.createShare")}
                </Button>
              </div>
              {context.shares.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("detail.noShares")}
                </p>
              )}
              {context.shares.map((share) => {
                const url = `${globalThis.location.origin}/share/${share.token}`;
                return (
                  <div
                    className="flex items-center gap-2 rounded-lg border p-3"
                    key={share.name}
                  >
                    <a
                      className="min-w-0 flex-1 truncate font-mono text-xs hover:text-primary"
                      href={url}
                    >
                      {url}
                    </a>
                    <Button
                      aria-label={t("common.copy")}
                      size="icon-sm"
                      variant="ghost"
                      onClick={async () => {
                        await navigator.clipboard.writeText(url);
                        toast.success(t("toast.copied"));
                      }}
                    >
                      <ClipboardIcon />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          aria-label={t("detail.revokeShare")}
                          disabled={revokePending}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <UnlinkIcon />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent size="sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t("detail.revokeShareTitle")}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("detail.revokeShareDescription")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel variant="ghost">
                            {t("common.cancel")}
                          </AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => onRevoke(share.id)}
                          >
                            {t("detail.revokeShare")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                );
              })}
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function RelationGroup({
  emptyText,
  label,
  onRemove,
  relations,
}: {
  emptyText?: string;
  label: string;
  onRemove?: (name: string) => void;
  relations: Awaited<ReturnType<typeof getMemoContext>>["relations"];
}) {
  const { t } = useI18n();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{label}</h2>
      {relations.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {emptyText ?? t("detail.noRelations")}
        </p>
      )}
      {relations.map(({ relation, memo }) => (
        <div
          className="flex items-center gap-1 rounded-lg border p-1"
          key={`${relation.memo}:${relation.related_memo}:${relation.type}`}
        >
          <Link
            className="min-w-0 flex-1 rounded-md p-2 text-sm transition-colors hover:bg-muted"
            params={{ memoId: memo.id }}
            to="/memo/$memoId"
          >
            <div className="line-clamp-2">{memo.content}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t(`detail.relationType.${relation.type}`)}
            </div>
          </Link>
          {onRemove && (
            <Button
              aria-label={t("detail.removeRelation", {
                content: memo.content,
              })}
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={() => onRemove(relation.related_memo)}
            >
              <UnlinkIcon />
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
