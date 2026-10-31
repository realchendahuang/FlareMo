import { Link } from "@tanstack/react-router";
import { MessageCircleIcon } from "lucide-react";
import { useMemo } from "react";
import type { Attachment, Memo } from "@/api";
import { AttachmentGallery } from "@/components/attachment-gallery";
import { LazyMemoContent } from "@/components/lazy-memo-content";
import { MemoSearchExcerpt } from "@/components/memo-search-excerpt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import {
  createImageDimensionResolver,
  filterUnreferencedAttachments,
} from "@/lib/attachment-refs";
import { extractTags } from "@/lib/memo";
import { countTaskItems } from "@/lib/memo-tasks";
import { cn } from "@/lib/utils";
import { stateLabel } from "./memo-card-badges";
import { MemoTaskBadge, useMemoTasks } from "./memo-task-badge";
import type { MemoTaskInteraction } from "./use-memo-card-actions";

/** Bodies beyond this size collapse in the timeline. */
const COLLAPSE_THRESHOLD = 600;

/** Whether a body is long enough to collapse (timeline and review cards). */
export function isCollapsibleMemoContent(content: string) {
  return content.length > COLLAPSE_THRESHOLD || content.split("\n").length > 12;
}

/**
 * The clip around a collapsible body. The fade is a mask on the text, not a
 * card-colored overlay: the card's paper grain is a background image, and a
 * solid `from-card` sheet over it showed as a flat, lighter band.
 */
export function memoBodyClipClass(collapsed: boolean) {
  return cn(
    "overflow-hidden motion-safe:transition-[max-height] motion-safe:duration-250 motion-safe:ease-signal",
    collapsed
      ? "max-h-52 [mask-image:linear-gradient(to_bottom,#000_calc(100%-4rem),transparent)]"
      : "max-h-[1600px]",
  );
}

/**
 * A live memo opens its thread in place once comments are on for the
 * workspace (or it already has some); elsewhere (archive, bin) a count still
 * leads to the memo, where the thread reads in full.
 */
export function canOpenMemoThread(memo: Memo, commentsEnabled: boolean) {
  return (
    memo.state === "normal" &&
    (commentsEnabled || (memo.comment_count ?? 0) > 0)
  );
}

/**
 * The comment toggle in the card's top row. With replies it always shows
 * its count; without, it appears on hover like the ⋯ menu (always on touch
 * screens), so a quiet timeline does not grow a row of empty bubbles.
 */
export function MemoCommentButton({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      aria-expanded={open}
      aria-label={
        count > 0 ? t("comments.count", { count }) : t("comments.action")
      }
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-md px-1 text-xs text-muted-foreground tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/25 motion-safe:transition-[color,background-color,opacity]",
        open && "bg-muted text-foreground",
        count === 0 &&
          !open &&
          "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
      )}
      title={t("comments.title")}
      type="button"
      onClick={onToggle}
    >
      <MessageCircleIcon aria-hidden="true" className="size-3.5" />
      {count > 0 && count}
    </button>
  );
}

type MemoCardBodyProps = {
  attachments: Attachment[];
  canManage: boolean;
  /** Expansion survives an edit round-trip, so the card holds it. */
  expanded: boolean;
  memo: Memo;
  onTagClick?: (tag: string) => void;
  onToggleExpanded: () => void;
  searchQuery?: string;
  taskInteraction?: MemoTaskInteraction;
  /** The card opens its thread in place (see `canOpenMemoThread`). */
  canOpenThread?: boolean;
};

/** The card's read face: the body, its collapse control and the tag footer. */
export function MemoCardBody({
  attachments,
  canManage,
  expanded,
  memo,
  onTagClick,
  onToggleExpanded,
  searchQuery,
  taskInteraction,
  canOpenThread = false,
}: MemoCardBodyProps) {
  const { t } = useI18n();
  // Both of these walk the whole body: tag extraction runs a regex over the
  // full text and filterUnreferencedAttachments scans every attachment
  // reference. Without memoization they re-ran on every parent re-render —
  // including each scroll-driven state flip in the timeline.
  const tags = useMemo(
    () => memo.payload.tags ?? extractTags(memo.content),
    [memo.payload.tags, memo.content],
  );
  // Stable identity: LazyMemoContent is memoized on its callbacks.
  const handleTagClick = useMemo(
    () =>
      onTagClick
        ? (tag: string) => onTagClick(tag.toLocaleLowerCase())
        : undefined,
    [onTagClick],
  );
  // Tags written in the text render as chips where they stand; the footer
  // only carries tags the text does not spell out (set by an API client or
  // an import), so nothing shows twice.
  const footerTags = useMemo(() => {
    const inText = new Set(
      extractTags(memo.content).map((tag) => tag.toLocaleLowerCase()),
    );
    return tags.filter((tag) => !inText.has(tag.toLocaleLowerCase()));
  }, [tags, memo.content]);
  // Body-referenced images render inline; the gallery keeps only the rest.
  const galleryAttachments = useMemo(
    () => filterUnreferencedAttachments(attachments, memo.content),
    [attachments, memo.content],
  );
  // Long bodies (transcripts, articles) collapse so one memo cannot dominate
  // the timeline.
  const isCollapsible = useMemo(
    () => isCollapsibleMemoContent(memo.content),
    [memo.content],
  );
  const collapsed = isCollapsible && !expanded;
  // Intrinsic boxes for body images: uploaded dimensions ride the
  // attachments list, so a photo the author placed inline never shoves the
  // cards below it aside while loading.
  const resolveImageDimensions = useMemo(
    () => createImageDimensionResolver(attachments),
    [attachments],
  );
  const taskCount = useMemo(() => countTaskItems(memo.content), [memo.content]);
  // Only the author holds the tasks a memo filed; other readers skip the
  // task cache entirely.
  const memoTasks = useMemoTasks(memo.name, canManage);
  const commentCount = memo.comment_count ?? 0;

  return (
    <>
      <div>
        <div>
          <div className={memoBodyClipClass(collapsed)}>
            <LazyMemoContent
              content={memo.content}
              interactiveTaskLists={canManage && taskCount > 0}
              resolveImageDimensions={resolveImageDimensions}
              onToggleTask={taskInteraction?.onToggleTask}
              onConvertTask={taskInteraction?.onConvertTask}
              onTagClick={handleTagClick}
            />
          </div>
        </div>
        {isCollapsible && (
          // Pulled back by the ghost button's own inset so the label lines
          // up with the text column above it.
          <Button
            className="mt-1.5 -ms-2.5"
            onClick={onToggleExpanded}
            size="sm"
            variant="ghost"
          >
            {collapsed ? t("reading.expand") : t("reading.collapse")}
          </Button>
        )}
        {/* The excerpt points at a hit hidden in the collapsed part; a short
            note already shows every match in its body. */}
        {searchQuery && collapsed && (
          <MemoSearchExcerpt content={memo.content} query={searchQuery} />
        )}
        {galleryAttachments.length > 0 && (
          <div className="mt-3">
            <AttachmentGallery attachments={galleryAttachments} />
          </div>
        )}
      </div>
      {(footerTags.length > 0 ||
        memo.state !== "normal" ||
        memoTasks.length > 0 ||
        (!canOpenThread && commentCount > 0)) && (
        <footer className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap gap-1.5">
            {footerTags.map((tag) =>
              onTagClick ? (
                <button
                  aria-label={`#${tag}`}
                  className="group/tag cursor-pointer rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
                  key={tag}
                  type="button"
                  onClick={() => onTagClick(tag)}
                >
                  <Badge
                    className="group-hover/tag:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_7%)] group-hover/tag:text-foreground"
                    variant="tag"
                  >
                    #{tag}
                  </Badge>
                </button>
              ) : (
                <Badge key={tag} variant="tag">
                  #{tag}
                </Badge>
              ),
            )}
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <MemoTaskBadge tasks={memoTasks} />
            {!canOpenThread && commentCount > 0 && (
              <Link
                aria-label={t("comments.count", { count: commentCount })}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground"
                hash="comments"
                params={{ memoId: memo.id }}
                to="/memo/$memoId"
              >
                <MessageCircleIcon aria-hidden="true" className="size-3.5" />
                {commentCount}
              </Link>
            )}
            {memo.state !== "normal" && (
              <Badge variant="outline">{stateLabel(memo.state, t)}</Badge>
            )}
          </div>
        </footer>
      )}
    </>
  );
}
