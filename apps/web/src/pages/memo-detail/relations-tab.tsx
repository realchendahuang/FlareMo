import { Link } from "@tanstack/react-router";
import { UnlinkIcon } from "lucide-react";
import type { Memo, MemoContext } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";
import { formatMemoTime } from "@/lib/memo";

/**
 * Relation candidate search plus the two direction groups. The candidate list
 * is computed by the caller (it already holds the raw search response and the
 * context it must be filtered against), so this tab only renders it.
 */
export function RelationsTab({
  canManage,
  candidates,
  context,
  isSearching,
  relatedMemo,
  relationPending,
  setRelatedMemo,
  onAddRelation,
  onRemoveRelation,
}: {
  canManage: boolean;
  candidates: Memo[];
  context: MemoContext;
  isSearching: boolean;
  relatedMemo: string;
  relationPending: boolean;
  setRelatedMemo: (value: string) => void;
  onAddRelation: (name: string) => void;
  onRemoveRelation: (name: string) => void;
}) {
  const { t } = useI18n();
  return (
    <TabsContent className="flex flex-col gap-4 pt-4" value="relations">
      <MemoRelationGraph
        backlinks={context.backlinks}
        relations={context.relations}
      />
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
                  className="rounded-md px-2 py-2 text-start text-sm transition-colors hover:bg-background"
                  disabled={relationPending}
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
  );
}

/**
 * The review graph for one memo: what it references on the right, what
 * references it on the left. Connectors stay CSS-simple — the value is seeing
 * both directions at once, not node physics.
 */
function MemoRelationGraph({
  backlinks,
  relations,
}: {
  backlinks: MemoContext["backlinks"];
  relations: MemoContext["relations"];
}) {
  const { t } = useI18n();
  if (backlinks.length === 0 && relations.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{t("detail.relationGraph")}</h2>
      <div className="hidden grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border bg-muted/20 px-4 py-5 sm:grid">
        <div className="flex flex-col items-end gap-5">
          {backlinks.map(({ relation, memo }) => (
            <Link
              className="flex min-w-0 max-w-full items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              key={`${relation.memo}:${relation.related_memo}`}
              params={{ memoId: memo.id }}
              to="/memo/$memoId"
            >
              <span className="min-w-0 max-w-52 truncate">
                {memo.content.split("\n")[0]}
              </span>
              <span className="size-1.5 shrink-0 rounded-full bg-brand-400" />
              <span className="h-0 w-4 shrink-0 border-t border-dashed border-border" />
            </Link>
          ))}
        </div>
        <span className="rounded-lg bg-brand-500/10 px-2.5 py-1.5 text-xs font-medium text-brand-700 dark:text-brand-200">
          {t("detail.graphCenter")}
        </span>
        <div className="flex flex-col items-start gap-5">
          {relations.map(({ relation, memo }) => (
            <Link
              className="flex min-w-0 max-w-full items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              key={`${relation.memo}:${relation.related_memo}`}
              params={{ memoId: memo.id }}
              to="/memo/$memoId"
            >
              <span className="h-0 w-4 shrink-0 border-t border-border" />
              <span className="size-1.5 shrink-0 rounded-full bg-brand-400" />
              <span className="min-w-0 max-w-52 truncate">
                {memo.content.split("\n")[0]}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
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
  relations: MemoContext["relations"];
}) {
  const { locale, t } = useI18n();
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
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Badge className="text-xs" variant="outline">
                {t(`detail.relationType.${relation.type}`)}
              </Badge>
              {formatMemoTime(memo.display_time, locale)}
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
