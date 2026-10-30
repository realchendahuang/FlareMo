import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircleIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createMemoComment,
  listMemoComments,
  type Memo,
  trashMemo,
} from "@/api";
import { LazyMemoContent } from "@/components/lazy-memo-content";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { formatMemoRelativeTime, formatMemoTime } from "@/lib/memo";
import { queryKeys } from "@/lib/query-keys";
import { stripResourceName } from "@/lib/utils";

const SUBMIT_HINT =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? "⌘↵"
    : "Ctrl ↵";

export const memoCommentsQueryKey = (memoId: string) =>
  ["memo-comments", memoId] as const;

function CommentRow({
  comment,
  locale,
  onDelete,
}: {
  comment: Memo;
  locale: string;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  return (
    <li className="group flex flex-col gap-1 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {comment.creator_name && (
          <span className="font-medium text-foreground/80">
            {comment.creator_name}
          </span>
        )}
        <time
          dateTime={comment.create_time}
          title={formatMemoTime(comment.create_time, locale)}
        >
          {formatMemoRelativeTime(comment.create_time, locale)}
        </time>
        {onDelete && (
          <Button
            aria-label={t("comments.delete")}
            className="ms-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={onDelete}
          >
            <Trash2Icon />
          </Button>
        )}
      </div>
      <LazyMemoContent className="text-sm" content={comment.content} />
    </li>
  );
}

/**
 * The thread under a memo, the way a post carries its replies: oldest
 * first, plain text in and out. On a personal memo the only commenter is
 * the author, which makes it an annotation: a later thought attached to the
 * earlier one instead of a new, disconnected note.
 */
export function MemoComments({
  memoId,
  canComment,
}: {
  /** Bare memo id (the `/memo/$memoId` route param). */
  memoId: string;
  canComment: boolean;
}) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const commentsQuery = useQuery({
    queryKey: memoCommentsQueryKey(memoId),
    queryFn: () => listMemoComments(memoId),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: memoCommentsQueryKey(memoId),
    });
    // The card's comment count rides the timeline list.
    void queryClient.invalidateQueries({ queryKey: queryKeys.memos.all });
  };
  const createMutation = useMutation({
    mutationFn: (content: string) => createMemoComment(memoId, { content }),
    onSuccess: () => {
      setDraft("");
      refresh();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("comments.createFailed"))),
  });
  const deleteMutation = useMutation({
    mutationFn: (comment: Memo) =>
      trashMemo(stripResourceName(comment.name, "memos")),
    onSuccess: () => {
      toast.success(t("comments.deleted"));
      refresh();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("comments.deleteFailed"))),
  });

  const comments = commentsQuery.data?.comments ?? [];
  // Arriving through "#comments" (a card's comment count, a notification)
  // lands on the thread once it has loaded, not on the top of the memo.
  const sectionRef = useRef<HTMLElement | null>(null);
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || !commentsQuery.data) return;
    if (window.location.hash !== "#comments") return;
    scrolledRef.current = true;
    sectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [commentsQuery.data]);
  const submit = () => {
    const content = draft.trim();
    if (!content || createMutation.isPending) return;
    createMutation.mutate(content);
  };

  return (
    <section
      className="flex flex-col gap-1 border-t border-border/60 pt-4"
      id="comments"
      ref={sectionRef}
    >
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <MessageCircleIcon className="size-4 text-muted-foreground" />
        {t("comments.title")}
        {comments.length > 0 && (
          <span className="tabular-nums text-muted-foreground">
            {comments.length}
          </span>
        )}
      </h2>
      {commentsQuery.isLoading && <Skeleton className="my-2 h-12 w-full" />}
      {comments.length > 0 && (
        <ul className="divide-y divide-border/60">
          {comments.map((comment) => (
            <CommentRow
              comment={comment}
              key={comment.name}
              locale={locale}
              onDelete={
                comment.can_manage
                  ? () => deleteMutation.mutate(comment)
                  : undefined
              }
            />
          ))}
        </ul>
      )}
      {commentsQuery.data && comments.length === 0 && !canComment && (
        <p className="py-2 text-sm text-muted-foreground">
          {t("comments.empty")}
        </p>
      )}
      {canComment && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Textarea
            aria-label={t("comments.placeholder")}
            className="min-h-20 resize-none"
            disabled={createMutation.isPending}
            placeholder={t("comments.placeholder")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">{SUBMIT_HINT}</span>
            <Button
              disabled={!draft.trim() || createMutation.isPending}
              size="sm"
              type="submit"
            >
              {createMutation.isPending && <Spinner data-icon="inline-start" />}
              {t("comments.submit")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
