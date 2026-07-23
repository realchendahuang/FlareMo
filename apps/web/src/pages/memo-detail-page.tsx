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
  replaceMemoRelations,
  restoreMemoRevision,
  revokeShare,
} from "@/api";
import { AttachmentGallery } from "@/components/attachment-gallery";
import { FlareMoLogo } from "@/components/flaremo-logo";
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
    mutationFn: async () => {
      const context = contextQuery.data;
      if (!context || !relatedMemo.trim()) return;
      await replaceMemoRelations(context.memo.name, [
        ...context.relations.map(({ relation }) => ({
          related_memo: relation.related_memo,
          type: relation.type,
        })),
        { related_memo: relatedMemo.trim(), type: "reference" },
      ]);
    },
    onSuccess: async () => {
      setRelatedMemo("");
      toast.success(t("toast.relationAdded"));
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
          <FlareMoLogo markClassName="size-5" />
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
            context={contextQuery.data}
            locale={locale}
            relatedMemo={relatedMemo}
            setRelatedMemo={setRelatedMemo}
            onAddRelation={() => relationMutation.mutate()}
            onCreateShare={() => shareMutation.mutate()}
            onRestore={(revision) => restoreMutation.mutate(revision)}
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
  context,
  locale,
  relatedMemo,
  setRelatedMemo,
  onAddRelation,
  onCreateShare,
  onRestore,
  onRevoke,
  pending,
}: {
  context: Awaited<ReturnType<typeof getMemoContext>>;
  locale: string;
  relatedMemo: string;
  setRelatedMemo: (value: string) => void;
  onAddRelation: () => void;
  onCreateShare: () => void;
  onRestore: (revision: string) => void;
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
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label={t("detail.relatedMemoPlaceholder")}
                placeholder={t("detail.relatedMemoPlaceholder")}
                value={relatedMemo}
                onChange={(event) => setRelatedMemo(event.target.value)}
              />
              <Button
                disabled={pending || !relatedMemo.trim()}
                onClick={onAddRelation}
              >
                <PlusIcon data-icon="inline-start" />
                {t("detail.addRelation")}
              </Button>
            </div>
            <RelationGroup
              label={t("detail.outgoing")}
              relations={context.relations}
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
  relations,
}: {
  label: string;
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
        <Link
          className="rounded-lg border p-3 text-sm transition-colors hover:bg-muted"
          key={`${relation.memo}:${relation.related_memo}:${relation.type}`}
          params={{ memoId: memo.id }}
          to="/memo/$memoId"
        >
          <div className="line-clamp-2">{memo.content}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {relation.type}
          </div>
        </Link>
      ))}
    </section>
  );
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
