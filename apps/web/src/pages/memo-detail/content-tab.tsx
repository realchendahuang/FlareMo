import { Link } from "@tanstack/react-router";
import { CornerUpLeftIcon } from "lucide-react";
import type { MemoContext, RelatedMemo } from "@/api";
import { MemoTaskBadge } from "@/components/memo-card/memo-task-badge";
import { useMemoTasks } from "@/components/memo-card/memo-task-context";
import { MemoComments } from "@/components/memo-comments";
import { MemoReadingView } from "@/components/reading/memo-reading-view";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsContent } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";
import { memoExcerpt } from "@/lib/memo";
import { stripResourceName } from "@/lib/utils";
import { InsightSection } from "./insight-section";

/**
 * The read view's optional to-do wiring. Absent (undefined) while the viewer
 * cannot manage the memo, which leaves the checkboxes in their read-only state.
 */
export type MemoDetailTaskInteraction = {
  onToggleTask: (lineIndex: number) => void;
  onConvertTask: (lineIndex: number, text: string) => void;
};

export function ContentTab({
  context,
  related,
  relatedPending,
  taskInteraction,
}: {
  context: MemoContext;
  related: RelatedMemo[];
  relatedPending: boolean;
  taskInteraction: MemoDetailTaskInteraction | undefined;
}) {
  const { t } = useI18n();
  // Tasks are the author's; the interaction exists only for them.
  const memoTasks = useMemoTasks(context.memo.name, Boolean(taskInteraction));
  // A comment opened on its own points back to the memo it answers; threads
  // stay one level deep, so it carries no comment box of its own.
  const parentName = context.relations.find(
    ({ relation }) => relation.type === "comment",
  )?.relation.related_memo;
  return (
    <TabsContent className="flex flex-col gap-5 pt-4" value="content">
      {parentName && (
        <Link
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          params={{ memoId: stripResourceName(parentName, "memos") }}
          to="/memo/$memoId"
        >
          <CornerUpLeftIcon className="size-3.5" />
          {t("comments.replyTo")}
        </Link>
      )}
      {memoTasks.length > 0 && (
        <div className="flex">
          <MemoTaskBadge tasks={memoTasks} />
        </div>
      )}
      <MemoReadingView
        attachments={context.attachments}
        content={context.memo.content}
        contentClassName="text-base"
        onToggleTask={taskInteraction?.onToggleTask}
        onConvertTask={taskInteraction?.onConvertTask}
      />
      {/* Comments on their own page point back to their memo; insight is only
          meaningful for a note itself, and only while it is a live note. */}
      {!parentName && context.memo.state === "normal" && (
        <InsightSection memoId={context.memo.id} />
      )}
      {!parentName && (
        <MemoComments
          canComment={context.memo.state === "normal"}
          key={context.memo.id}
          memoId={context.memo.id}
          mentions={context.memo.visibility !== "private"}
        />
      )}
      {relatedPending && (
        <section className="flex flex-col gap-2 border-t border-border/60 pt-4">
          <h2 className="text-sm font-medium">{t("detail.related")}</h2>
          <Skeleton className="h-16 w-full" />
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
              <div className="line-clamp-2">
                {memoExcerpt(memo.content) || memo.content}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {[
                  memo.via_relation ? t("detail.relatedViaRelation") : null,
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
  );
}
