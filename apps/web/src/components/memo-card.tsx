import { Link } from "@tanstack/react-router";
import {
  ArchiveIcon,
  CircleIcon,
  Edit3Icon,
  Globe2Icon,
  Loader2Icon,
  LockIcon,
  MoreHorizontalIcon,
  PinIcon,
  RotateCcwIcon,
  Share2Icon,
  ShieldIcon,
  Trash2Icon,
} from "lucide-react";
import { memo, useState } from "react";
import type { Attachment, Memo, MemoState, MemoVisibility, Share } from "@/api";
import { AttachmentGallery } from "@/components/attachment-gallery";
import { LazyMemoContent } from "@/components/lazy-memo-content";
import { MemoSearchExcerpt } from "@/components/memo-search-excerpt";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import {
  extractTags,
  formatMemoRelativeTime,
  formatMemoTime,
  getMemoResourceId,
} from "@/lib/memo";
import { cn } from "@/lib/utils";

/** Bodies beyond this size collapse in the timeline. */
const COLLAPSE_THRESHOLD = 600;

type MemoCardProps = {
  memo: Memo;
  attachments: Attachment[];
  onArchive: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onShare: (id: string) => void;
  onUpdate: (
    id: string,
    input: { content: string; visibility: MemoVisibility },
  ) => Promise<void>;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onHardDelete: (id: string) => Promise<void>;
  share?: Share;
  searchQuery?: string;
  /** Position in the list, used to stagger the entrance animation. */
  index?: number;
  /** Called when a tag chip is clicked to filter the timeline by that tag. */
  onTagClick?: (tag: string) => void;
  canManage?: boolean;
};

export const MemoCard = memo(function MemoCard({
  memo,
  attachments,
  onArchive,
  onPin,
  onShare,
  onUpdate,
  onTrash,
  onRestore,
  onHardDelete,
  share,
  searchQuery,
  index = 0,
  onTagClick,
  canManage = false,
}: MemoCardProps) {
  const { locale, t } = useI18n();
  const id = getMemoResourceId(memo);
  const shareUrl = share
    ? `${globalThis.location.origin}/share/${share.token}`
    : undefined;
  const tags = memo.payload.tags ?? extractTags(memo.content);
  const isTrashed = memo.state === "trashed";
  // Long bodies (transcripts, articles) collapse so one memo cannot dominate
  // the timeline. Expanded state is per-card and resets on remount.
  const isCollapsible =
    memo.content.length > COLLAPSE_THRESHOLD ||
    memo.content.split("\n").length > 12;
  const [expanded, setExpanded] = useState(false);
  const collapsed = isCollapsible && !expanded;
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [draftContent, setDraftContent] = useState(memo.content);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareVisibility, setShareVisibility] = useState<MemoVisibility>(
    memo.visibility,
  );
  const [isSharing, setIsSharing] = useState(false);

  const startEditing = () => {
    setDraftContent(memo.content);
    setIsEditing(true);
  };

  const openShareDialog = () => {
    setShareVisibility(memo.visibility);
    setIsShareOpen(true);
  };

  // Feishu-style share panel: visibility changed after publishing; picking
  // the public option also provisions the public link token.
  const saveSharing = async () => {
    setIsSharing(true);
    try {
      await onUpdate(id, {
        content: memo.content,
        visibility: shareVisibility,
      });
      if (shareVisibility === "public" && !share) {
        onShare(id);
      }
      setIsShareOpen(false);
    } catch {
      // The mutation displays the error and the dialog stays open.
    } finally {
      setIsSharing(false);
    }
  };

  const saveEditing = async () => {
    setIsSaving(true);
    try {
      await onUpdate(id, {
        content: draftContent,
        visibility: memo.visibility,
      });
      setIsEditing(false);
    } catch {
      // The mutation displays the error and the editor stays open.
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <article
      className={cn(
        "group relative flex w-full flex-col gap-2 rounded-xl border border-border/50 bg-card/60 px-3.5 py-4 text-card-foreground [content-visibility:auto] [contain-intrinsic-size:auto_120px] motion-safe:animate-rise motion-safe:transition-[background-color,border-color,transform,box-shadow] motion-safe:duration-150 hover:border-border hover:bg-card hover:shadow-xs motion-safe:hover:-translate-y-px",
        memo.pinned &&
          "border-flame-300/40 bg-flame-50/35 dark:border-flame-400/25 dark:bg-flame-400/5",
        isEditing && "bg-card shadow-xs ring-1 ring-flame-400/40",
      )}
      style={{ animationDelay: `${Math.min(index, 7) * 35}ms` }}
    >
      {memo.pinned && (
        <span
          aria-hidden="true"
          className="bg-brand-gradient absolute top-4 bottom-4 left-0 w-[3px] rounded-full"
        />
      )}
      <div className="flex w-full items-center justify-between gap-2">
        <Link
          className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          params={{ memoId: memo.id }}
          title={formatMemoTime(memo.display_time, locale)}
          to="/memo/$memoId"
        >
          {memo.pinned ? (
            <PinIcon className="text-flame-500 dark:text-flame-400" />
          ) : (
            <CircleIcon className="opacity-35" />
          )}
          <span className="truncate tabular-nums">
            {formatMemoRelativeTime(memo.display_time, locale)}
          </span>
          {memo.creator_name && <span>· {memo.creator_name}</span>}
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          {memo.visibility !== "private" && (
            <VisibilityBadge visibility={memo.visibility} />
          )}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={t("common.actions")}
                  className="opacity-100 motion-safe:transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  size="icon-sm"
                  variant="ghost"
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  {isTrashed ? (
                    <>
                      <DropdownMenuItem onClick={() => onRestore(id)}>
                        <RotateCcwIcon />
                        {t("memo.restore")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setIsDeleteDialogOpen(true)}
                      >
                        <Trash2Icon />
                        {t("memo.deleteForever")}
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={startEditing}>
                        <Edit3Icon />
                        {t("common.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onPin(id, !memo.pinned)}>
                        <PinIcon />
                        {memo.pinned ? t("memo.unpin") : t("memo.pin")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onArchive(id)}>
                        <ArchiveIcon />
                        {memo.state === "archived"
                          ? t("memo.moveToTimeline")
                          : t("view.archive")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={openShareDialog}>
                        <Share2Icon />
                        {t("memo.share")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onTrash(id)}>
                        <Trash2Icon />
                        {t("memo.moveToTrash")}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {isEditing ? (
        <div className="flex flex-col gap-3 motion-safe:animate-fade">
          <Textarea
            autoFocus
            className="min-h-32 resize-none text-[15px] leading-7 focus-visible:ring-flame-400/40"
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void saveEditing();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setIsEditing(false);
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                disabled={isSaving}
                size="sm"
                variant="ghost"
                onClick={() => setIsEditing(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                disabled={isSaving || !draftContent.trim()}
                size="sm"
                onClick={() => void saveEditing()}
              >
                {isSaving && (
                  <Loader2Icon
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                )}
                {t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="relative">
            <div
              className={cn(
                collapsed && "max-h-52 overflow-hidden",
                !collapsed && "transition-[max-height]",
              )}
            >
              <LazyMemoContent content={memo.content} />
            </div>
            {collapsed && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
            )}
          </div>
          {isCollapsible && (
            <Button
              className="mt-1.5"
              onClick={() => setExpanded((value) => !value)}
              size="sm"
              variant="ghost"
            >
              {collapsed ? t("reading.expand") : t("reading.collapse")}
            </Button>
          )}
          {searchQuery && (
            <MemoSearchExcerpt content={memo.content} query={searchQuery} />
          )}
          {attachments.length > 0 && (
            <div className="mt-3">
              <AttachmentGallery attachments={attachments} />
            </div>
          )}
          {share && shareUrl && (
            <div className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              <a className="font-mono hover:text-foreground" href={shareUrl}>
                {shareUrl}
              </a>
            </div>
          )}
        </div>
      )}
      {(tags.length > 0 || memo.state !== "normal") && !isEditing && (
        <footer className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) =>
              onTagClick ? (
                <button
                  aria-label={`#${tag}`}
                  className="cursor-pointer rounded-full motion-safe:transition-transform motion-safe:duration-150 motion-safe:hover:-translate-y-px"
                  key={tag}
                  type="button"
                  onClick={() => onTagClick(tag)}
                >
                  <Badge
                    className="transition-colors hover:bg-flame-200 dark:hover:bg-flame-400/20"
                    variant="flame"
                  >
                    #{tag}
                  </Badge>
                </button>
              ) : (
                <Badge key={tag} variant="flame">
                  #{tag}
                </Badge>
              ),
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {memo.state !== "normal" && (
              <Badge variant="outline">{stateLabel(memo.state, t)}</Badge>
            )}
          </div>
        </footer>
      )}
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("memo.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("memo.deleteConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void onHardDelete(id)}
            >
              {t("memo.deleteForever")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={isShareOpen} onOpenChange={setIsShareOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("share.title")}</DialogTitle>
            <DialogDescription>{t("share.subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            {(
              [
                ["private", LockIcon],
                ["protected", ShieldIcon],
                ["public", Globe2Icon],
              ] as const
            ).map(([value, Icon]) => {
              const selected = shareVisibility === value;
              return (
                <button
                  aria-pressed={selected}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm motion-safe:transition-colors",
                    selected
                      ? "border-flame-400/60 bg-flame-400/8"
                      : "border-transparent bg-muted/40 hover:bg-muted",
                  )}
                  key={value}
                  type="button"
                  onClick={() => setShareVisibility(value)}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      selected ? "text-flame-500" : "text-muted-foreground",
                    )}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">
                      {t(`visibility.${value}`)}
                    </span>
                    <span
                      className={cn(
                        "text-xs",
                        selected
                          ? "text-muted-foreground"
                          : "text-muted-foreground/80",
                      )}
                    >
                      {t(`share.desc.${value}`)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {shareVisibility === "public" && shareUrl && (
            <p className="truncate rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
              {shareUrl}
            </p>
          )}
          <DialogFooter>
            <Button
              disabled={isSharing}
              type="button"
              variant="ghost"
              onClick={() => setIsShareOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={isSharing}
              onClick={() => void saveSharing()}
              type="button"
            >
              {isSharing && (
                <Loader2Icon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              )}
              {t("share.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
});

function VisibilityBadge({ visibility }: { visibility: MemoVisibility }) {
  const { t } = useI18n();
  const icon =
    visibility === "public" ? (
      <Globe2Icon />
    ) : visibility === "protected" ? (
      <ShieldIcon />
    ) : (
      <LockIcon />
    );
  const label =
    visibility === "public"
      ? t("visibility.public")
      : visibility === "protected"
        ? t("visibility.protected")
        : t("visibility.private");
  return (
    <Badge className="rounded-md" variant="outline">
      {icon}
      {label}
    </Badge>
  );
}

function stateLabel(state: MemoState, t: ReturnType<typeof useI18n>["t"]) {
  switch (state) {
    case "archived":
      return t("memo.stateArchived");
    case "trashed":
      return t("memo.stateTrashed");
    case "deleted":
      return t("memo.stateDeleted");
    default:
      return state;
  }
}
