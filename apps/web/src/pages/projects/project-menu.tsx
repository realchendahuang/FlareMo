import { useMutation } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { archiveProject, deleteProject, type Project } from "@/api";
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
import { stripResourceName } from "@/lib/utils";
import { ProjectFormDialog } from "./project-form-dialog";

/**
 * A project's ⋯ menu (edit, archive, delete) and the dialogs it opens. It
 * sits beside the project picker while that project is open.
 */
export function ProjectMenu({
  project,
  onMutated,
  onDeleted,
}: {
  project: Project;
  onMutated: () => void;
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
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t("common.more")}
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
