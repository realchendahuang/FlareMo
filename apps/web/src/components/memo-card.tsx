import {
  ArchiveIcon,
  CircleIcon,
  DownloadIcon,
  Edit3Icon,
  Globe2Icon,
  LockIcon,
  MoreHorizontalIcon,
  PinIcon,
  RotateCcwIcon,
  Share2Icon,
  ShieldIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import type { Attachment, Memo, MemoState, MemoVisibility, Share } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n";
import { extractTags, formatMemoTime, getMemoResourceId } from "@/lib/memo";
import { cn } from "@/lib/utils";

type MemoCardProps = {
  memo: Memo;
  attachments: Attachment[];
  onArchive: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onShare: (id: string) => void;
  onUpdate: (
    id: string,
    input: { content: string; visibility: MemoVisibility },
  ) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onHardDelete: (id: string) => void;
  share?: Share;
  shareUrl?: string;
};

export function MemoCard({
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
  shareUrl,
}: MemoCardProps) {
  const { locale, t } = useI18n();
  const id = getMemoResourceId(memo);
  const tags = memo.payload.tags ?? extractTags(memo.content);
  const isTrashed = memo.state === "trashed";
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(memo.content);
  const [draftVisibility, setDraftVisibility] = useState<MemoVisibility>(
    memo.visibility,
  );

  return (
    <article
      className={cn(
        "group relative flex w-full flex-col gap-2 rounded-lg bg-background px-1 py-4 text-card-foreground motion-safe:animate-[flaremo-rise_180ms_ease-out_both] motion-safe:transition-[background-color,transform] motion-safe:duration-150 hover:bg-card motion-safe:hover:-translate-y-px",
        memo.pinned && "border-l-2 border-l-primary pl-3",
      )}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <button
          className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          type="button"
          onClick={() => onArchive(id)}
        >
          {memo.pinned ? (
            <PinIcon className="text-primary" />
          ) : (
            <CircleIcon className="opacity-35" />
          )}
          <span className="truncate">
            {formatMemoTime(memo.display_time, locale)}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {memo.visibility !== "private" && (
            <VisibilityBadge visibility={memo.visibility} />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("common.actions")}
                className="opacity-100 motion-safe:transition-opacity md:opacity-0 md:group-hover:opacity-100"
                size="icon-sm"
                variant="ghost"
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {isTrashed ? (
                  <DropdownMenuItem onClick={() => onRestore(id)}>
                    <RotateCcwIcon />
                    {t("memo.restore")}
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem onClick={() => setIsEditing(true)}>
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
                    <DropdownMenuItem onClick={() => onShare(id)}>
                      <Share2Icon />
                      {t("memo.share")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onTrash(id)}>
                      <Trash2Icon />
                      {t("memo.moveToTrash")}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onHardDelete(id)}
                >
                  <Trash2Icon />
                  {t("memo.deleteForever")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div>
        <div className="whitespace-pre-wrap text-[15px] leading-7 text-foreground">
          {memo.content}
        </div>
        {attachments.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {attachments.map((attachment) => (
              <a
                className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground motion-safe:transition-[color,background-color] hover:text-foreground"
                href={attachment.download_url}
                key={attachment.name}
              >
                <DownloadIcon />
                <span className="min-w-0 flex-1 truncate">
                  {attachment.filename}
                </span>
                <span className="shrink-0 text-xs">
                  {formatBytes(attachment.size)}
                </span>
              </a>
            ))}
          </div>
        )}
        {share && (
          <div className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            <a
              className="font-mono hover:text-foreground"
              href={shareUrl ?? `/share/${share.token}`}
            >
              {shareUrl ?? `/share/${share.token}`}
            </a>
          </div>
        )}
      </div>
      {(tags.length > 0 ||
        memo.visibility !== "private" ||
        memo.state !== "normal") && (
        <footer className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge
                className="rounded-md border-0 bg-muted text-muted-foreground"
                key={tag}
                variant="secondary"
              >
                #{tag}
              </Badge>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {memo.state !== "normal" && (
              <Badge variant="outline">{stateLabel(memo.state, t)}</Badge>
            )}
            {memo.visibility === "private" && (
              <VisibilityBadge visibility={memo.visibility} />
            )}
          </div>
        </footer>
      )}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("common.edit")}</DialogTitle>
          </DialogHeader>
          <Textarea
            className="min-h-40 resize-none text-base"
            value={draftContent}
            onChange={(event) => setDraftContent(event.target.value)}
          />
          <ToggleGroup
            type="single"
            value={draftVisibility}
            onValueChange={(value) => {
              if (value) setDraftVisibility(value as MemoVisibility);
            }}
            size="sm"
            variant="outline"
          >
            <ToggleGroupItem value="private">
              {t("visibility.private")}
            </ToggleGroupItem>
            <ToggleGroupItem value="protected">
              {t("visibility.protected")}
            </ToggleGroupItem>
            <ToggleGroupItem value="public">
              {t("visibility.public")}
            </ToggleGroupItem>
          </ToggleGroup>
          <DialogFooter>
            <Button
              disabled={!draftContent.trim()}
              onClick={() => {
                onUpdate(id, {
                  content: draftContent,
                  visibility: draftVisibility,
                });
                setIsEditing(false);
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

export function nextArchiveState(memo: Memo): MemoState {
  return memo.state === "archived" ? "normal" : "archived";
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

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
