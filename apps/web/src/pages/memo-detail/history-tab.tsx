import { DiffIcon, HistoryIcon, RotateCcwIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { MemoContext } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { TabsContent } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";
import { formatMemoTime } from "@/lib/memo";
import { cn } from "@/lib/utils";

export type DiffLine = {
  kind: "same" | "removed" | "added";
  text: string;
};

const MAX_LCS_LINES = 300;

/**
 * Computes a line-by-line diff from `before` (historical revision) to `after`
 * (current note). Falls back to a linear replacement block on huge notes so
 * expanding a revision never stalls the UI thread.
 */
export function computeLineDiff(before: string, after: string): DiffLine[] {
  if (before === after) {
    return [];
  }
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > MAX_LCS_LINES || b.length > MAX_LCS_LINES) {
    return [
      ...a.map((text): DiffLine => ({ kind: "removed", text })),
      ...b.map((text): DiffLine => ({ kind: "added", text })),
    ];
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        a[i] === b[j]
          ? (dp[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({ kind: "removed", text: a[i] ?? "" });
      i += 1;
    } else {
      out.push({ kind: "added", text: b[j] ?? "" });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ kind: "removed", text: a[i] ?? "" });
    i += 1;
  }
  while (j < b.length) {
    out.push({ kind: "added", text: b[j] ?? "" });
    j += 1;
  }
  return out;
}

export function HistoryTab({
  canManage,
  context,
  locale,
  restorePending,
  onRestore,
}: {
  canManage: boolean;
  context: MemoContext;
  locale: string;
  restorePending: boolean;
  onRestore: (revision: string) => void;
}) {
  const { t } = useI18n();
  const [expandedName, setExpandedName] = useState<string | null>(null);

  return (
    <TabsContent className="flex flex-col gap-2.5 pt-4" value="history">
      {context.revisions.length === 0 && (
        <Empty className="min-h-40 border border-dashed border-border/70 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon />
            </EmptyMedia>
            <EmptyDescription>{t("detail.noRevisions")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {context.revisions.map((revision) => {
        const expanded = expandedName === revision.name;
        return (
          <RevisionItem
            canManage={canManage}
            currentContent={context.memo.content}
            expanded={expanded}
            key={revision.name}
            locale={locale}
            restorePending={restorePending}
            revision={revision}
            onRestore={() => onRestore(revision.name)}
            onToggleExpand={() =>
              setExpandedName((prev) =>
                prev === revision.name ? null : revision.name,
              )
            }
          />
        );
      })}
    </TabsContent>
  );
}

function RevisionItem({
  canManage,
  currentContent,
  expanded,
  locale,
  restorePending,
  revision,
  onRestore,
  onToggleExpand,
}: {
  canManage: boolean;
  currentContent: string;
  expanded: boolean;
  locale: string;
  restorePending: boolean;
  revision: MemoContext["revisions"][number];
  onRestore: () => void;
  onToggleExpand: () => void;
}) {
  const { t } = useI18n();
  const diff = useMemo(() => {
    if (!expanded) return [];
    const counts = new Map<string, number>();
    return computeLineDiff(revision.content, currentContent).map((line) => {
      const sig = `${line.kind}:${line.text}`;
      const seq = (counts.get(sig) ?? 0) + 1;
      counts.set(sig, seq);
      return { ...line, id: `${sig}#${seq}` };
    });
  }, [currentContent, expanded, revision.content]);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border/70 bg-card/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground tabular-nums">
            {formatMemoTime(revision.create_time, locale)}
          </div>
          {!expanded && (
            <p className="mt-1 line-clamp-2 text-sm text-foreground/90">
              {revision.content}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            aria-expanded={expanded}
            size="sm"
            type="button"
            variant="ghost"
            onClick={onToggleExpand}
          >
            <DiffIcon data-icon="inline-start" />
            {expanded
              ? t("detail.hideComparison")
              : t("detail.compareRevision")}
          </Button>
          {canManage && (
            <Button
              disabled={restorePending}
              size="sm"
              type="button"
              variant="outline"
              onClick={onRestore}
            >
              <RotateCcwIcon data-icon="inline-start" />
              {t("detail.restoreRevision")}
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="overflow-x-auto rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs leading-relaxed">
          {diff.length === 0 ? (
            <p className="text-muted-foreground">
              {t("detail.revisionIdentical")}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5 font-mono">
              {diff.map((line) => (
                <div
                  className={cn(
                    "flex gap-2 rounded-sm px-1.5 py-0.5 whitespace-pre-wrap break-words",
                    line.kind === "removed" &&
                      "bg-destructive/10 text-destructive",
                    line.kind === "added" &&
                      "bg-success/12 text-success-emphasis",
                    line.kind === "same" && "text-muted-foreground",
                  )}
                  key={line.id}
                >
                  <span
                    aria-hidden="true"
                    className="w-3 shrink-0 select-none opacity-70"
                  >
                    {line.kind === "removed"
                      ? "−"
                      : line.kind === "added"
                        ? "+"
                        : " "}
                  </span>
                  <span className="min-w-0 flex-1">
                    {line.text || "\u00a0"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
