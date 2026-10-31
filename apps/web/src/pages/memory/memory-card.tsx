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
import type { TranslationKey } from "@/i18n/key";
import { formatMemoRelativeTime, formatMemoTime } from "@/lib/memo";
import { cn, stripResourceName } from "@/lib/utils";
import { formatProjectName, isRule } from "./memory-filters";
import { MemoryFormDialog } from "./memory-form-dialog";
import { MemoryRevisions } from "./memory-revisions";
import { type MemoryAction, useMemoryMutations } from "./use-memory-mutations";

/** `review_reason` is a machine code; only the ones worth a sentence map. */
const REVIEW_REASON_LABEL: Partial<Record<string, TranslationKey>> = {
  supersede_proposal: "memory.reason.supersede",
  contradicts: "memory.reason.contradicts",
  evidence_stale: "memory.reason.evidenceStale",
};

export const MemoryCard = memo(function MemoryCard({
  memory,
  hideProject,
  review,
  onSelectProject,
  onMutated,
}: {
  memory: Memory;
  hideProject: boolean;
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
  const isActive = memory.status === "active";
  const isProposal = memory.verification === "inferred";
  const pendingReview = isActive && (review || memory.needs_review);
  const conflict = memory.conflict_with ?? null;
  const reasonKey = memory.review_reason
    ? REVIEW_REASON_LABEL[memory.review_reason]
    : undefined;
  // A live memory whose source changed is asked "still true?", not
  // "accept this proposal?": keeping it confirms, dropping it archives.
  const staleCheck = pendingReview && !isProposal;
  const evidence = memory.evidence?.find(
    (ev) => !conflict || ev.source_id !== conflict.id,
  );
  const isPending = (action: MemoryAction) =>
    mutation.isPending && mutation.variables === action;

  return (
    <article
      data-memory-id={memory.id}
      className={cn(
        // Same paper as a memo card: a memory is a note the AI keeps for you.
        "paper group relative flex w-full flex-col gap-2 rounded-xl border border-border/60 bg-card px-4 py-3.5 text-card-foreground shadow-xs [content-visibility:auto] [contain-intrinsic-size:auto_120px] motion-safe:animate-rise motion-safe:transition-[border-color,box-shadow] motion-safe:duration-150 hover:border-border hover:shadow-sm sm:px-5 sm:py-4",
      )}
    >
      <div className="flex w-full items-center justify-between gap-2">
        {/* Time, then who wrote it and how often an agent has used it. The
            absolute time is a tooltip: a hover swap would reserve its width
            and push the facts after it a column away. */}
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <time
            className="shrink-0"
            dateTime={memory.created_at}
            title={formatMemoTime(memory.created_at, locale)}
          >
            {formatMemoRelativeTime(memory.created_at, locale)}
          </time>
          {memory.created_by_type === "agent" && memory.source_agent && (
            <span className="truncate">· {memory.source_agent}</span>
          )}
          {memory.access_count > 0 && (
            <span
              className="shrink-0 tabular-nums"
              title={
                memory.last_accessed_at
                  ? t("memory.lastUsed", {
                      time: formatMemoRelativeTime(
                        memory.last_accessed_at,
                        locale,
                      ),
                    })
                  : undefined
              }
            >
              · {t("memory.usedCount", { count: memory.access_count })}
            </span>
          )}
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-1.5">
          {!hideProject &&
            memory.scope_type === "project" &&
            memory.scope_key && (
              <button
                type="button"
                onClick={() => {
                  if (memory.scope_key) onSelectProject?.(memory.scope_key);
                }}
                className="inline-flex max-w-[160px] cursor-pointer items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-xs text-muted-foreground motion-safe:transition-colors hover:bg-muted hover:text-foreground"
                title={memory.scope_key}
              >
                <FolderIcon className="size-3 shrink-0" />
                <span className="truncate">
                  {formatProjectName(memory.scope_key)}
                </span>
              </button>
            )}

          {/* Same name and tint as the 铁律 filter and composer toggle: one
              concept, one label, and only locked rows earn it. */}
          {memory.status === "superseded" ? (
            <Badge
              variant="outline"
              className="text-xs font-normal text-muted-foreground"
            >
              {t("memory.status.supersededShort")}
            </Badge>
          ) : memory.status === "archived" ? (
            <Badge
              variant="outline"
              className="text-xs font-normal text-muted-foreground"
            >
              {t("memory.status.archivedShort")}
            </Badge>
          ) : isRule(memory) ? (
            <Badge
              variant="outline"
              className="gap-1 border-brand-500/30 bg-brand-500/10 text-xs font-normal text-brand-600 dark:text-brand-400"
            >
              <PinIcon className="size-3 fill-current" />
              <span>{t("memory.coreShort")}</span>
            </Badge>
          ) : memory.verification === "observed" ? (
            <Badge variant="secondary" className="gap-1 text-xs font-normal">
              <EyeIcon className="size-3" />
              <span>{t("memory.observedBadge")}</span>
            </Badge>
          ) : isProposal ? (
            <Badge variant="warning" className="gap-1 font-normal">
              <SparklesIcon className="size-3" />
              <span>{t("memory.inferredBadge")}</span>
            </Badge>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={t("common.actions")}
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 [@media(hover:none)]:opacity-100"
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

              {/* A proposal is decided first; pinning it would skip the
                  decision. Retired rows are history and stay as they are. */}
              {isActive &&
                !isProposal &&
                (isRule(memory) ? (
                  <DropdownMenuItem onClick={() => mutation.mutate("unpin")}>
                    <PinOffIcon />
                    {t("memory.unpin")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => mutation.mutate("pin")}>
                    <PinIcon />
                    {t("memory.pin")}
                  </DropdownMenuItem>
                ))}

              {isActive && memory.verification === "observed" && (
                <DropdownMenuItem onClick={() => mutation.mutate("confirm")}>
                  <CheckIcon />
                  {t("memory.confirmObserved")}
                </DropdownMenuItem>
              )}

              {isActive ? (
                <DropdownMenuItem onClick={() => mutation.mutate("archive")}>
                  <ArchiveIcon />
                  {t("memory.archive")}
                </DropdownMenuItem>
              ) : memory.status === "archived" ? (
                <DropdownMenuItem onClick={() => mutation.mutate("restore")}>
                  <CornerUpLeftIcon />
                  {t("memory.restore")}
                </DropdownMenuItem>
              ) : null}

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

      <div className="flex flex-col gap-2 pt-0.5">
        {/* What the agent wants to replace, above what it proposes: the
            decision is between these two lines. */}
        {pendingReview && conflict && (
          <div className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2 text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              {conflict.verification === "locked" && (
                <PinIcon className="size-3 fill-current" />
              )}
              {t("memory.conflictCurrent")}
            </span>
            <p className="whitespace-pre-wrap text-foreground/80 select-text">
              {conflict.content}
            </p>
          </div>
        )}

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

        {evidence && (evidence.excerpt || evidence.source_type !== "other") && (
          <div className="mt-0.5 flex items-center gap-1.5 border-t border-border/30 pt-1.5 text-xs text-muted-foreground">
            <LinkIcon className="size-3 shrink-0 opacity-70" />
            <span className="shrink-0">{t("memory.evidenceLabel")}</span>
            <span className="min-w-0 truncate">
              {evidence.excerpt ||
                `${t("memory.evidenceFrom")} ${evidence.source_type}`}
            </span>
          </div>
        )}
      </div>

      {pendingReview && (
        <div className="mt-1 flex items-center gap-2 border-t border-border/40 pt-2.5">
          <Button
            size="sm"
            onClick={() => mutation.mutate("confirm")}
            disabled={isPending("confirm")}
            className="gap-1.5"
          >
            <CheckIcon data-icon="inline-start" />
            {staleCheck
              ? t("memory.keepStillTrue")
              : conflict
                ? t("memory.acceptReplace")
                : t("memory.acceptProposal")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => mutation.mutate(staleCheck ? "archive" : "reject")}
            disabled={isPending(staleCheck ? "archive" : "reject")}
            className="gap-1.5"
          >
            {staleCheck ? (
              <ArchiveIcon data-icon="inline-start" />
            ) : (
              <XIcon data-icon="inline-start" />
            )}
            {staleCheck
              ? t("memory.archive")
              : conflict
                ? t("memory.keepCurrent")
                : t("memory.rejectProposal")}
          </Button>
          {reasonKey && (
            <span className="ms-auto min-w-0 truncate text-xs text-muted-foreground">
              {t(reasonKey)}
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
