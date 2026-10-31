import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  FoldersIcon,
  PlusIcon,
} from "lucide-react";
import type { Project } from "@/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

function ProjectItem({
  project,
  selected,
  onSelect,
}: {
  project: Project;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <DropdownMenuItem onClick={() => onSelect(project.id)}>
      <FolderIcon data-icon="inline-start" />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          project.status === "archived" && "text-muted-foreground",
        )}
      >
        {project.name}
      </span>
      {selected ? (
        <CheckIcon className="ms-auto" />
      ) : (
        project.task_count_open > 0 && (
          <span className="ms-auto text-xs text-muted-foreground tabular-nums">
            {project.task_count_open}
          </span>
        )
      )}
    </DropdownMenuItem>
  );
}

/**
 * Which project the list shows: a filter on top of the date views, so it
 * lives in one menu instead of a second sidebar. Archived projects sit in
 * their own group at the bottom; creating a project starts here too.
 */
export function ProjectPicker({
  projects,
  selected,
  onSelect,
  onCreate,
}: {
  projects: Project[];
  selected: Project | null;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const active = projects.filter((project) => project.status !== "archived");
  const archived = projects.filter((project) => project.status === "archived");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t("projects.pickerLabel")}
            className="max-w-full min-w-0 justify-start"
            size="sm"
            variant="outline"
          >
            {selected ? (
              <FolderIcon data-icon="inline-start" />
            ) : (
              <FoldersIcon data-icon="inline-start" />
            )}
            <span className="min-w-0 truncate">
              {selected ? selected.name : t("projects.allProjects")}
            </span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem onClick={() => onSelect(null)}>
          <FoldersIcon data-icon="inline-start" />
          <span className="flex-1">{t("projects.allProjects")}</span>
          {!selected && <CheckIcon className="ms-auto" />}
        </DropdownMenuItem>
        {active.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {active.map((project) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  selected={selected?.id === project.id}
                  onSelect={onSelect}
                />
              ))}
            </DropdownMenuGroup>
          </>
        )}
        {archived.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {t("projects.archivedGroup")}
              </DropdownMenuLabel>
              {archived.map((project) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  selected={selected?.id === project.id}
                  onSelect={onSelect}
                />
              ))}
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onCreate}>
          <PlusIcon data-icon="inline-start" />
          {t("projects.newProject")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
