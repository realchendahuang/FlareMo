import { useMutation } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { archiveProject, deleteProject, type Project } from "@/api";
import {
  NAV_ACTIVE_CLASS,
  NAV_COUNT_CLASS,
  NAV_ITEM_CLASS,
} from "@/components/nav-item-styles";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { cn, stripResourceName } from "@/lib/utils";
import { MORE_BUTTON_CLASS } from "./constants";
import { ProjectFormDialog } from "./project-form-dialog";

export function ProjectRow({
  project,
  selected,
  onMutated,
  onSelect,
  onDeleted,
}: {
  project: Project;
  selected: boolean;
  onMutated: () => void;
  onSelect: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const archiveMutation = useMutation({
    mutationFn: () =>
      archiveProject(
        stripResourceName(project.id, "projects"),
        project.status !== "archived",
      ),
    onSuccess: () => {
      toast.success(
        t(
          project.status === "archived"
            ? "toast.projectUnarchived"
            : "toast.projectArchived",
        ),
      );
      onMutated();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.projectArchiveFailed"))),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(stripResourceName(project.id, "projects")),
    onSuccess: () => {
      toast.success(t("toast.projectDeleted"));
      onDeleted(project.id);
      onMutated();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("toast.projectDeleteFailed"))),
  });

  return (
    <>
      <div
        className={cn(
          NAV_ITEM_CLASS,
          "group relative shrink-0 whitespace-nowrap",
          selected && NAV_ACTIVE_CLASS,
        )}
      >
        <FolderIcon aria-hidden="true" />
        <button
          className="min-w-0 flex-1 truncate text-left outline-none after:absolute after:inset-0 after:rounded-lg"
          type="button"
          onClick={() => onSelect(project.id)}
        >
          <span
            className={
              project.status === "archived" ? "text-muted-foreground/70" : ""
            }
          >
            {project.name}
          </span>
        </button>
        {/* The count and the menu share the trailing slot, so project counts
            line up with the view counts above; the menu takes over on hover
            and is always shown on touch screens. */}
        {project.task_count_open > 0 && (
          <span
            className={cn(
              NAV_COUNT_CLASS,
              "group-focus-within:invisible group-hover:invisible [@media(pointer:coarse)]:hidden",
            )}
          >
            {project.task_count_open}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={t("common.more")}
                className={cn(
                  MORE_BUTTON_CLASS,
                  "absolute end-1 top-1/2 z-10 size-6 -translate-y-1/2 data-[popup-open]:opacity-100",
                )}
                size="icon-sm"
                variant="ghost"
              >
                <MoreHorizontalIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <PencilIcon data-icon="inline-start" />
              {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => archiveMutation.mutate()}>
              {project.status === "archived" ? (
                <ArchiveRestoreIcon data-icon="inline-start" />
              ) : (
                <ArchiveIcon data-icon="inline-start" />
              )}
              {t(
                project.status === "archived"
                  ? "projects.unarchive"
                  : "projects.archive",
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2Icon data-icon="inline-start" />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ProjectFormDialog
        key={[project.id, project.name, project.description ?? ""].join("|")}
        open={editing}
        project={project}
        onOpenChange={setEditing}
        onSaved={onMutated}
      />
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("projects.deleteProjectTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("projects.deleteProjectDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              variant="destructive"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
