import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  CheckIcon,
  CornerUpLeftIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  NotebookPenIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  archiveMemory,
  confirmMemory,
  deleteMemory,
  type Memory,
  pinMemory,
  promoteMemoryToMemo,
  resolveProposal,
  restoreMemory,
  unpinMemory,
} from "@/api";
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
import { errorMessage } from "@/lib/error";
import { formatMemoRelativeTime, formatMemoTime } from "@/lib/memo";
import { cn, stripResourceName } from "@/lib/utils";
import { formatProjectName } from "./memory-filters";
import { MemoryFormDialog } from "./memory-form-dialog";
import { MemoryRevisions } from "./memory-revisions";

export function MemoryCard({
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
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);

  const confirmMutation = useMutation({
    mutationFn: () => {
      if (memory.needs_review || memory.verification === "inferred") {
        return resolveProposal(stripResourceName(memory.id, "memories"), {
          action: "accept",
        });
      }
      return confirmMemory(stripResourceName(memory.id, "memories"));
    },
    onSuccess: () => {
      toast.success(t("toast.memoryConfirmed"));
      onMutated();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.memoryConfirmFailed"))),
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      resolveProposal(stripResourceName(memory.id, "memories"), {
        action: "reject",
        rejection_reason: "user_rejected_in_inbox",
      }),
    onSuccess: () => {
      toast.success(t("toast.memoryRejected"));
      onMutated();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.memoryRejectFailed"))),
  });

  const pinMutation = useMutation({
    mutationFn: () => pinMemory(stripResourceName(memory.id, "memories")),
    onSuccess: () => {
      toast.success(t("toast.memoryLocked"));
      onMutated();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.memoryLockFailed"))),
  });

  const unpinMutation = useMutation({
    mutationFn: () => unpinMemory(stripResourceName(memory.id, "memories")),
    onSuccess: () => {
      toast.success(t("toast.memoryUnlocked"));
      onMutated();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.memoryUnlockFailed"))),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveMemory(stripResourceName(memory.id, "memories")),
    onSuccess: () => {
      toast.success(t("toast.memoryArchived"));
      onMutated();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.memoryArchiveFailed"))),
  });

  const restoreMutation = useMutation({
    mutationFn: () => restoreMemory(stripResourceName(memory.id, "memories")),
    onSuccess: () => {
      toast.success(t("toast.memoryRestored"));
      onMutated();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.memoryRestoreFailed"))),
  });

  const promoteMutation = useMutation({
    mutationFn: () =>
      promoteMemoryToMemo(stripResourceName(memory.id, "memories")),
    onSuccess: () => {
      toast.success(t("toast.saved"));
      onMutated();
      void queryClient.invalidateQueries({ queryKey: ["memos"] });
      void queryClient.invalidateQueries({ queryKey: ["memo-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["tag-hierarchy"] });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.memoryPromoteFailed"))),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMemory(stripResourceName(memory.id, "memories")),
    onSuccess: () => {
      toast.success(t("toast.memoryDeleted"));
      onMutated();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.memoryDeleteFailed"))),
  });

  const id = stripResourceName(memory.id, "memories");

  return (
    <article
      data-memory-id={memory.id}
      className={cn(
        "group relative flex w-full flex-col gap-2 rounded-xl border border-border/50 bg-card/60 px-3.5 py-4 text-card-foreground [content-visibility:auto] motion-safe:animate-rise motion-safe:transition-[background-color,border-color,transform,box-shadow] motion-safe:duration-150 hover:border-border hover:bg-card hover:shadow-xs motion-safe:hover:-translate-y-px",
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
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer truncate max-w-[180px]"
              title={memory.scope_key}
            >
              <span>📁 {formatProjectName(memory.scope_key)}</span>
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
            <Badge variant="secondary" className="text-xs font-normal">
              {t("memory.observedBadge")}
            </Badge>
          ) : memory.needs_review || memory.verification === "inferred" ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-amber-600 dark:text-amber-400 text-xs font-normal"
            >
              {t("memory.inferredBadge")}
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
                <DropdownMenuItem onClick={() => unpinMutation.mutate()}>
                  <PinOffIcon />
                  {t("memory.unpin")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => pinMutation.mutate()}>
                  <PinIcon />
                  {t("memory.pin")}
                </DropdownMenuItem>
              )}

              {memory.status === "active" ? (
                <DropdownMenuItem onClick={() => archiveMutation.mutate()}>
                  <ArchiveIcon />
                  {t("memory.archive")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => restoreMutation.mutate()}>
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

              <DropdownMenuItem onClick={() => promoteMutation.mutate()}>
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
          <div className="text-xs text-muted-foreground flex items-center gap-1 border-t border-border/30 pt-1.5 mt-0.5">
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
            onClick={() => confirmMutation.mutate()}
            disabled={confirmMutation.isPending}
            className="h-8 gap-1.5 text-xs"
          >
            <CheckIcon className="size-3.5" />
            {t("memory.acceptProposal")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => rejectMutation.mutate()}
            disabled={rejectMutation.isPending}
            className="h-8 gap-1.5 text-xs"
          >
            <XIcon className="size-3.5" />
            {t("memory.rejectProposal")}
          </Button>
          {memory.review_reason && (
            <span className="text-xs text-amber-500 font-medium ml-auto truncate max-w-[200px]">
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
              onClick={() => deleteMutation.mutate()}
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
}
