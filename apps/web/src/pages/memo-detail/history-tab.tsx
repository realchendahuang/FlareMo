import { RotateCcwIcon } from "lucide-react";
import type { MemoContext } from "@/api";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";
import { formatMemoTime } from "@/lib/memo";

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
  return (
    <TabsContent className="flex flex-col gap-2 pt-4" value="history">
      {context.revisions.length === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
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
            <p className="mt-1 line-clamp-2 text-sm">{revision.content}</p>
          </div>
          {canManage && (
            <Button
              disabled={restorePending}
              size="sm"
              variant="outline"
              onClick={() => onRestore(revision.name)}
            >
              <RotateCcwIcon data-icon="inline-start" />
              {t("detail.restoreRevision")}
            </Button>
          )}
        </div>
      ))}
    </TabsContent>
  );
}
