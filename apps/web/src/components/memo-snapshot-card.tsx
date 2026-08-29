import type { Memo } from "@/api";
import { AttachmentGallery } from "@/components/attachment-gallery";
import { LazyMemoContent } from "@/components/lazy-memo-content";
import { Card, CardContent } from "@/components/ui/card";
import { formatMemoTime } from "@/lib/memo";

/** Read-only memo card used by review surfaces (daily review, random walk). */
export function MemoSnapshotCard({
  badge,
  locale,
  memo,
}: {
  badge?: string | null;
  locale: string;
  memo: Memo;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <time className="text-xs text-muted-foreground tabular-nums">
            {formatMemoTime(memo.create_time, locale)}
          </time>
          {badge && (
            <span className="rounded-full bg-flame-100 px-2.5 py-1 text-xs font-medium text-flame-700 dark:bg-flame-400/12 dark:text-flame-200">
              {badge}
            </span>
          )}
        </div>
        <LazyMemoContent content={memo.content} />
        <AttachmentGallery attachments={memo.attachments ?? []} />
      </CardContent>
    </Card>
  );
}
