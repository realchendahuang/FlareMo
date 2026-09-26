import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderKanbanIcon,
  PinIcon,
} from "lucide-react";
import { useMemo } from "react";
import type { Memory } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { useI18n } from "@/i18n";
import { formatMemoRelativeTime } from "@/lib/memo";
import { formatProjectName } from "./memory-filters";
import { MemoryList } from "./memory-list";

export function ProjectGroups({
  memories,
  selectedProject,
  onSelectProject,
  onMutated,
}: {
  memories: Memory[];
  selectedProject?: string | null;
  onSelectProject: (projectKey: string | null) => void;
  onMutated: () => void;
}) {
  const { locale, t } = useI18n();

  const projects = useMemo(() => {
    const map = new Map<string, Memory[]>();
    for (const memory of memories) {
      const key = memory.scope_key ?? memory.scope_type;
      const list = map.get(key) ?? [];
      list.push(memory);
      map.set(key, list);
    }

    return [...map.entries()]
      .map(([key, items]) => {
        const displayName = formatProjectName(key);
        const coreCount = items.filter(
          (m) => m.tier === "core" || m.verification === "locked",
        ).length;
        const observedCount = items.filter(
          (m) => m.verification === "observed",
        ).length;
        const latestRule =
          items.find((m) => m.tier === "core" || m.verification === "locked") ||
          items[0];
        const lastUpdated = items.reduce(
          (max, m) => (m.created_at > max ? m.created_at : max),
          items[0]?.created_at || "",
        );

        return {
          key,
          displayName,
          items,
          coreCount,
          observedCount,
          latestRule,
          lastUpdated,
        };
      })
      .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
  }, [memories]);

  if (projects.length === 0) {
    return (
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyTitle>{t("memory.emptyTitle")}</EmptyTitle>
          <EmptyDescription>{t("memory.emptyDescription")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // Single project detail mode
  if (selectedProject) {
    const activeProject = projects.find((p) => p.key === selectedProject) || {
      key: selectedProject,
      displayName: formatProjectName(selectedProject),
      items: memories.filter(
        (m) => (m.scope_key ?? m.scope_type) === selectedProject,
      ),
      coreCount: 0,
      observedCount: 0,
      latestRule: undefined,
      lastUpdated: "",
    };

    return (
      <div className="flex flex-col gap-3.5">
        {/* Project Header Banner */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-2xs motion-safe:animate-rise">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-400">
              <FolderKanbanIcon className="size-4.5" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-sm text-foreground truncate">
                  {activeProject.displayName}
                </h2>
                <Badge
                  variant="outline"
                  className="text-[11px] font-normal tabular-nums"
                >
                  {t("memory.projectMemoryCount", {
                    count: activeProject.items.length,
                  })}
                </Badge>
                {activeProject.coreCount > 0 && (
                  <Badge
                    variant="default"
                    className="text-[11px] font-normal gap-1"
                  >
                    <PinIcon className="size-2.5 fill-current" />
                    <span>
                      {t("memory.projectCoreCount", {
                        count: activeProject.coreCount,
                      })}
                    </span>
                  </Badge>
                )}
              </div>
              {activeProject.key !== activeProject.displayName && (
                <p
                  className="text-xs text-muted-foreground truncate"
                  title={activeProject.key}
                >
                  {activeProject.key}
                </p>
              )}
            </div>
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSelectProject(null)}
            className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
          >
            <ArrowLeftIcon className="size-3.5" />
            <span>{t("memory.allProjects")}</span>
          </Button>
        </div>

        {/* Project Memory Timeline */}
        <MemoryList
          memories={activeProject.items}
          loading={false}
          onMutated={onMutated}
          showSource
        />
      </div>
    );
  }

  // All projects overview dashboard
  return (
    <div className="flex flex-col gap-3">
      {projects.map((project) => (
        <button
          key={project.key}
          type="button"
          onClick={() => onSelectProject(project.key)}
          className="group flex flex-col gap-2.5 rounded-xl border border-border/50 bg-card/60 p-3.5 text-card-foreground text-left w-full shadow-2xs transition-all hover:border-border hover:bg-card hover:shadow-xs motion-safe:hover:-translate-y-px cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FolderIcon className="size-4 shrink-0 text-brand-500" />
              <span className="font-semibold text-sm text-foreground truncate group-hover:text-brand-500 transition-colors">
                {project.displayName}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                ·{" "}
                {t("memory.projectMemoryCount", {
                  count: project.items.length,
                })}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {project.coreCount > 0 && (
                <Badge variant="default" className="text-xs font-normal gap-1">
                  <PinIcon className="size-2.5 fill-current" />
                  <span>
                    {t("memory.projectCoreCount", {
                      count: project.coreCount,
                    })}
                  </span>
                </Badge>
              )}
              <ChevronRightIcon className="size-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>

          {project.key !== project.displayName && (
            <p className="text-xs text-muted-foreground/70 truncate font-mono">
              {project.key}
            </p>
          )}

          {project.latestRule && (
            <div className="rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground leading-relaxed border border-border/40">
              <span className="inline-flex items-center gap-1 font-medium text-foreground/80 mr-1.5">
                <PinIcon className="size-3 fill-current text-brand-500 shrink-0" />
                <span>{t("memory.projectRuleLabel")}:</span>
              </span>
              <span className="line-clamp-2">{project.latestRule.content}</span>
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground/60 pt-0.5 border-t border-border/30">
            <span>
              {t("memory.projectUpdated", {
                time: formatMemoRelativeTime(project.lastUpdated, locale),
              })}
            </span>
            <span className="group-hover:text-brand-500 font-medium transition-colors">
              {t("memory.projectViewAll")} ›
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
