import {
  ArchiveIcon,
  CheckIcon,
  CornerUpLeftIcon,
  EyeIcon,
  FolderIcon,
  HistoryIcon,
  LinkIcon,
  MoreHorizontalIcon,
  NotebookPenIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { memo, useState } from "react";
import type { Memory } from "@/api";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { formatMemoRelativeTime, formatMemoTime } from "@/lib/memo";
import { cn, stripResourceName } from "@/lib/utils";
import { formatProjectName } from "./memory-filters";
import { MemoryFormDialog } from "./memory-form-dialog";
import { MemoryRevisions } from "./memory-revisions";
import { useMemoryMutations } from "./use-memory-mutations";

export const MemoryCard = memo(function MemoryCard({
  memory,
  showSource,
  review,
  onSelectProject,
  onMutated,
}: {
  memory: Memory;
  showSource: boolean;
  review: boolean;
  onSelectProject?: (projectKey: string) => void;
  onMutated: () => void;
}) {
  const { locale, t } = useI18n();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);

  const mutation = useMemoryMutations(memory, onMutated);
  const id = stripResourceName(memory.id, "memories");

  return (
    <article
      data-memory-id={memory.id}
      className={cn(
        // Same paper as a memo card: a memory is a note the AI keeps for you.
        "paper group relative flex w-full flex-col gap-2 rounded-xl border border-border/60 bg-card px-4 py-3.5 text-card-foreground shadow-xs [content-visibility:auto] [contain-intrinsic-size:auto_120px] motion-safe:animate-rise motion-safe:transition-[border-color,box-shadow] motion-safe:duration-150 hover:border-border hover:shadow-sm sm:px-5 sm:py-4",
      )}
    >
      {/* Header row: Timestamp & scope on left, Status badges + ⋯ menu on right */}
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-grid [grid-template-areas:'stack'] items-center truncate">
            <span className="[grid-area:stack] transition-opacity duration-150 group-hover:opacity-0 pointer-events-none">
              {formatMemoRelativeTime(memory.created_at, locale)}
            </span>
            <span className="[grid-area:stack] opacity-0 transition-opacity duration-150 group-hover:opacity-100 whitespace-nowrap">
              {formatMemoTime(memory.created_at, locale)}
            </span>
          </span>

          {memory.scope_type === "project" && memory.scope_key && (
            <button
              type="button"
              onClick={() => {
                if (memory.scope_key) onSelectProject?.(memory.scope_key);
              }}
              className="inline-flex max-w-[180px] cursor-pointer items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-xs text-muted-foreground motion-safe:transition-colors hover:bg-muted hover:text-foreground"
              title={memory.scope_key}
            >
              <FolderIcon className="size-3 shrink-0" />
              <span>{formatProjectName(memory.scope_key)}</span>
            </button>
          )}

          {showSource && memory.source_agent && (
            <span className="truncate max-w-[120px]">
              · {memory.source_agent}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {memory.tier === "core" || memory.verification === "locked" ? (
            <Badge variant="default" className="gap-1 text-xs font-normal">
              <PinIcon className="size-3 fill-current" />
              <span>{t("memory.pinned")}</span>
            </Badge>
          ) : memory.verification === "observed" ? (
            <Badge variant="secondary" className="gap-1 text-xs font-normal">
              <EyeIcon className="size-3" />
              <span>{t("memory.observedBadge")}</span>
            </Badge>
          ) : memory.needs_review || memory.verification === "inferred" ? (
            <Badge variant="warning" className="gap-1 font-normal">
              <SparklesIcon className="size-3" />
              <span>{t("memory.inferredBadge")}</span>
            </Badge>
          ) : null}

          {memory.status === "archived" && (
            <Badge
              variant="outline"
              className="text-xs font-normal text-muted-foreground"
            >
              {t("memory.status.archivedShort")}
            </Badge>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={t("common.actions")}
                  className="opacity-70 hover:opacity-100 group-hover:opacity-100 transition-opacity"
                  size="icon-sm"
                  variant="ghost"
                >
                  <MoreHorizontalIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <PencilIcon />
                {t("common.edit")}
              </DropdownMenuItem>

              {memory.verification === "locked" ? (
                <DropdownMenuItem onClick={() => mutation.mutate("unpin")}>
                  <PinOffIcon />
                  {t("memory.unpin")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => mutation.mutate("pin")}>
                  <PinIcon />
                  {t("memory.pin")}
                </DropdownMenuItem>
              )}

              {memory.status === "active" ? (
                <DropdownMenuItem onClick={() => mutation.mutate("archive")}>
                  <ArchiveIcon />
                  {t("memory.archive")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => mutation.mutate("restore")}>
                  <CornerUpLeftIcon />
                  {t("memory.restore")}
                </DropdownMenuItem>
              )}

              <DropdownMenuItem
                onClick={() => setShowRevisions((value) => !value)}
              >
                <HistoryIcon />
                {t("memory.revisions")}
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => mutation.mutate("promote")}>
                <NotebookPenIcon />
                {t("memory.toMemo")}
              </DropdownMenuItem>

              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2Icon />
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Body: clean typography */}
      <div className="flex flex-col gap-2 pt-0.5">
        <p className="text-sm leading-relaxed whitespace-pre-wrap select-text">
          {memory.content}
        </p>

        {Array.isArray(memory.tags) && memory.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {memory.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs text-brand-600 dark:text-brand-400"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {memory.evidence && memory.evidence.length > 0 && (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 border-t border-border/30 pt-1.5 mt-0.5">
            <LinkIcon className="size-3 shrink-0 opacity-70" />
            <span>{t("memory.evidenceLabel")}:</span>
            <span className="truncate max-w-[400px]">
              {memory.evidence[0].excerpt ||
                `${t("memory.evidenceFrom")} ${memory.evidence[0].source_type}`}
            </span>
          </div>
        )}
      </div>

      {/* Review action buttons (ONLY when review || memory.needs_review) */}
      {(review || memory.needs_review) && (
        <div className="flex items-center gap-2 pt-2 border-t border-border/40 mt-1">
          <Button
            size="sm"
            variant="default"
            onClick={() => mutation.mutate("confirm")}
            disabled={mutation.isPending && mutation.variables === "confirm"}
            className="h-8 gap-1.5 text-xs"
          >
            <CheckIcon className="size-3.5" />
            {t("memory.acceptProposal")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => mutation.mutate("reject")}
            disabled={mutation.isPending && mutation.variables === "reject"}
            className="h-8 gap-1.5 text-xs"
          >
            <XIcon className="size-3.5" />
            {t("memory.rejectProposal")}
          </Button>
          {memory.review_reason && (
            <span className="ms-auto max-w-[200px] truncate text-xs font-medium text-warning-emphasis">
              {memory.review_reason}
            </span>
          )}
        </div>
      )}

      {showRevisions && <MemoryRevisions memoryId={id} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("memory.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {memory.content.slice(0, 80)}
              {memory.content.length > 80 ? "…" : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => mutation.mutate("delete")}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MemoryFormDialog
        key={[
          memory.id,
          memory.content,
          memory.type,
          memory.kind,
          memory.scope_type,
          memory.scope_key ?? "",
          memory.importance,
        ].join("|")}
        memory={memory}
        open={editing}
        onOpenChange={setEditing}
        onSaved={onMutated}
      />
    </article>
  );
});
