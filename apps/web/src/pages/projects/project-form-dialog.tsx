import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createProject, type Project, updateProject } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";
import { stripResourceName } from "@/lib/utils";

export function ProjectFormDialog({
  open,
  project,
  onSaved,
  onOpenChange,
}: {
  open: boolean;
  project?: Project;
  onSaved: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");

  useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setDescription(project?.description ?? "");
    }
  }, [open, project]);

  const saveMutation = useMutation({
    mutationFn: () =>
      project
        ? updateProject(stripResourceName(project.id, "projects"), {
            name: name.trim(),
            description: description || null,
          })
        : createProject({
            name: name.trim(),
            description: description || undefined,
          }),
    onSuccess: () => {
      toast.success(
        t(project ? "toast.projectUpdated" : "toast.projectCreated"),
      );
      if (!project) {
        setName("");
        setDescription("");
      }
      onOpenChange(false);
      onSaved();
    },
    onError: (error) =>
      toast.error(
        errorMessage(
          error,
          t(
            project ? "toast.projectUpdateFailed" : "toast.projectCreateFailed",
          ),
        ),
      ),
  });

  const canSave = Boolean(name.trim()) && !saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {project ? t("projects.editProject") : t("projects.newProject")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) saveMutation.mutate();
          }}
        >
          <Field label={t("projects.field.name")}>
            <Input
              value={name}
              placeholder={t("projects.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={t("projects.field.description")}>
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey) &&
                  canSave
                ) {
                  event.preventDefault();
                  saveMutation.mutate();
                }
              }}
            />
          </Field>
          <DialogFooter>
            <Button disabled={!canSave} type="submit">
              {saveMutation.isPending && <Spinner data-icon="inline-start" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
