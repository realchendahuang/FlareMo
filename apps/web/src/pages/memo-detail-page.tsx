import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ClipboardIcon,
  Link2Icon,
  Loader2Icon,
  PlusIcon,
  RotateCcwIcon,
  UnlinkIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  createShare,
  getMemoContext,
  listMemos,
  replaceMemoRelations,
  restoreMemoRevision,
  revokeShare,
} from "@/api";
import { AttachmentGallery } from "@/components/attachment-gallery";
import { LazyMemoContent } from "@/components/lazy-memo-content";
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
  const invalidateMemo = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
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
      action: _action,
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

  return (
    <div className="min-h-svh bg-background px-4 py-5 sm:py-8">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <Button asChild size="sm" variant="ghost">
            <Link
              search={{ q: undefined, tag: undefined, view: undefined }}
              to="/"
            >
              <ArrowLeftIcon data-icon="inline-start" />
              {t("common.back")}
            </Link>
          </Button>
          <span className="text-sm font-semibold">FlareMo</span>
        </header>

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
            isSearching={relationCandidatesQuery.isFetching}
            locale={locale}
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
            pending={
              relationMutation.isPending ||
              restoreMutation.isPending ||
              shareMutation.isPending ||
              revokeMutation.isPending
            }
          />
        )}
      </main>
    </div>
  );
}

function MemoDetail({
  candidates,
  context,
  isSearching,
  locale,
  relatedMemo,
  setRelatedMemo,
  onAddRelation,
  onCreateShare,
  onRestore,
  onRemoveRelation,
  onRevoke,
  pending,
}: {
  candidates: Awaited<ReturnType<typeof listMemos>>["memos"];
  context: Awaited<ReturnType<typeof getMemoContext>>;
  isSearching: boolean;
  locale: string;
  relatedMemo: string;
  setRelatedMemo: (value: string) => void;
  onAddRelation: (name: string) => void;
  onCreateShare: () => void;
  onRestore: (revision: string) => void;
  onRemoveRelation: (name: string) => void;
  onRevoke: (share: string) => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-normal text-muted-foreground">
            {formatMemoTime(context.memo.display_time, locale)}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            {context.memo.pinned && <Badge>{t("memo.pin")}</Badge>}
            <Badge variant="outline">
              {t(`visibility.${context.memo.visibility}`)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="content">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="content">{t("detail.content")}</TabsTrigger>
            <TabsTrigger value="relations">{t("detail.relations")}</TabsTrigger>
            <TabsTrigger value="history">{t("detail.history")}</TabsTrigger>
            <TabsTrigger value="sharing">{t("detail.sharing")}</TabsTrigger>
          </TabsList>
          <TabsContent className="flex flex-col gap-5 pt-4" value="content">
            <LazyMemoContent
              className="text-base"
              content={context.memo.content}
            />
            <AttachmentGallery attachments={context.attachments} />
          </TabsContent>
          <TabsContent className="flex flex-col gap-4 pt-4" value="relations">
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  aria-label={t("detail.relatedMemoPlaceholder")}
                  placeholder={t("detail.relatedMemoPlaceholder")}
                  value={relatedMemo}
                  onChange={(event) => setRelatedMemo(event.target.value)}
                />
                <Button
                  disabled={pending || !relatedMemo.trim()}
                  onClick={() => onAddRelation(relatedMemo.trim())}
                >
                  <PlusIcon data-icon="inline-start" />
                  {t("detail.addRelation")}
                </Button>
              </div>
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
                      disabled={pending}
                      key={candidate.name}
                      type="button"
                      onClick={() => onAddRelation(candidate.name)}
                    >
                      <span className="line-clamp-2">{candidate.content}</span>
                      <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                        {candidate.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <RelationGroup
              label={t("detail.outgoing")}
              relations={context.relations}
              onRemove={onRemoveRelation}
            />
            <RelationGroup
              label={t("detail.backlinks")}
              relations={context.backlinks}
            />
          </TabsContent>
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
                  disabled={pending}
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
          <TabsContent className="flex flex-col gap-3 pt-4" value="sharing">
            <div>
              <Button disabled={pending} size="sm" onClick={onCreateShare}>
                {pending ? (
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
                  <Button
                    aria-label={t("detail.revokeShare")}
                    disabled={pending}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onRevoke(share.id)}
                  >
                    <UnlinkIcon />
                  </Button>
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function RelationGroup({
  label,
  onRemove,
  relations,
}: {
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
          {t("detail.noRelations")}
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
              {relation.type}
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
