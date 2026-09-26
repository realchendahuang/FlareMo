import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircleIcon,
  BrainIcon,
  EyeIcon,
  FolderIcon,
  PinIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { listMemories, listMemoryReview } from "@/api";
import { Button } from "@/components/ui/button";
import { FilterPill } from "@/components/ui/filter-pill";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { useI18n } from "@/i18n";
import { formatProjectName, groupMemories } from "./memory/memory-filters";
import { MemoryLensDialog } from "./memory/memory-lens-dialog";
import { MemoryList } from "./memory/memory-list";
import { MemoryQuickComposer } from "./memory/memory-quick-composer";
import { MemoryWorkspaceHeader } from "./memory/memory-workspace-header";
import { ProjectGroups } from "./memory/project-groups";

type FilterTab =
  | "all"
  | "core"
  | "observed"
  | "projects"
  | "review"
  | "archive";

export function MemoryPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<FilterTab>("all");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lensOpen, setLensOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const listQuery = useQuery({
    queryKey: ["memories", "list"],
    queryFn: () => listMemories(),
  });

  const reviewQuery = useQuery({
    queryKey: ["memories", "review"],
    queryFn: () => listMemoryReview(),
  });

  const memories = useMemo(
    () => listQuery.data?.memories ?? [],
    [listQuery.data],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter((memory) =>
      memory.content.toLowerCase().includes(q),
    );
  }, [memories, query]);

  const groups = useMemo(() => groupMemories(filtered), [filtered]);

  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of groups.projects) {
      const key = m.scope_key ?? m.scope_type;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({
        key,
        displayName: formatProjectName(key),
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [groups.projects]);

  const handleSelectProject = (projectKey: string | null) => {
    setSelectedProject(projectKey);
    setTab("projects");
  };

  const reviewMemories = useMemo(
    () => reviewQuery.data?.memories ?? [],
    [reviewQuery.data],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["memories"] });
  };

  const reviewCount = reviewMemories.length;

  return (
    <WorkspaceLayout
      header={({
        sidebarCollapsed,
        toggleSidebarCollapsed,
        mobileSheetOpen,
        setMobileSheetOpen,
        explorer,
      }) => (
        <MemoryWorkspaceHeader
          explorer={explorer}
          mobileSheetOpen={mobileSheetOpen}
          setMobileSheetOpen={setMobileSheetOpen}
          sidebarCollapsed={sidebarCollapsed}
          toggleSidebarCollapsed={toggleSidebarCollapsed}
          query={query}
          onQueryChange={setQuery}
          onOpenLens={() => setLensOpen(true)}
          isScrolled={isScrolled}
        />
      )}
      onScroll={(event) => {
        setIsScrolled(event.currentTarget.scrollTop > 4);
      }}
    >
      <div className="flex flex-col gap-3.5 pt-2">
        {/* Pending Review Alert Banner */}
        {reviewCount > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-600 dark:text-amber-400 motion-safe:animate-rise">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <AlertCircleIcon className="size-4 shrink-0 text-amber-500" />
              <span className="truncate font-medium">
                {t("memory.bannerReviewAlert", { count: reviewCount })}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTab("review")}
              className="h-7 border-amber-500/30 bg-card px-2.5 text-xs text-amber-600 hover:bg-amber-500/15 dark:text-amber-400"
            >
              {t("memory.filterReview")}
            </Button>
          </div>
        )}

        {/* Quick Add Memory Box */}
        <MemoryQuickComposer
          defaultScopeKey={tab === "projects" ? selectedProject : null}
          projects={projectCounts}
          onCreated={invalidate}
        />

        {/* Filter Pills */}
        <div className="flex flex-col gap-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterPill
              active={tab === "all"}
              label={t("memory.filterAll")}
              count={groups.active.length}
              onClick={() => {
                setTab("all");
                setSelectedProject(null);
              }}
            />
            <FilterPill
              active={tab === "core"}
              label={t("memory.filterCore")}
              count={groups.core.length}
              icon={
                <PinIcon className="size-3 text-brand-500 fill-brand-500/20" />
              }
              onClick={() => {
                setTab("core");
                setSelectedProject(null);
              }}
            />
            {(groups.observed.length > 0 || tab === "observed") && (
              <FilterPill
                active={tab === "observed"}
                label={t("memory.filterObserved")}
                count={groups.observed.length}
                icon={<EyeIcon className="size-3" />}
                onClick={() => {
                  setTab("observed");
                  setSelectedProject(null);
                }}
              />
            )}
            {(groups.projects.length > 0 || tab === "projects") && (
              <FilterPill
                active={tab === "projects"}
                label={t("memory.tab.projects")}
                count={groups.projects.length}
                icon={<FolderIcon className="size-3" />}
                onClick={() => setTab("projects")}
              />
            )}
            {(reviewCount > 0 || tab === "review") && (
              <FilterPill
                active={tab === "review"}
                label={t("memory.filterReview")}
                count={reviewCount}
                highlight={reviewCount > 0}
                onClick={() => {
                  setTab("review");
                  setSelectedProject(null);
                }}
              />
            )}
            {(groups.archive.length > 0 || tab === "archive") && (
              <FilterPill
                active={tab === "archive"}
                label={t("memory.tab.archive")}
                count={groups.archive.length}
                onClick={() => {
                  setTab("archive");
                  setSelectedProject(null);
                }}
              />
            )}
          </div>

          {/* Project Sub-pills (when projects tab is active) */}
          {tab === "projects" && projectCounts.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar text-xs">
              <FilterPill
                active={!selectedProject}
                variant="sub"
                label={t("memory.allProjects")}
                count={groups.projects.length}
                onClick={() => setSelectedProject(null)}
              />

              {projectCounts.map((p) => (
                <FilterPill
                  key={p.key}
                  active={selectedProject === p.key}
                  variant="sub"
                  label={p.displayName}
                  count={p.count}
                  onClick={() => setSelectedProject(p.key)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div className="pt-1">
          {tab === "all" &&
            (memories.length === 0 && !listQuery.isLoading && !query ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 py-12 px-4 text-center motion-safe:animate-rise">
                <BrainIcon className="size-8 text-muted-foreground/30" />
                <p className="mt-3 font-medium text-sm text-foreground">
                  {t("memory.emptyTitle")}
                </p>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                  {t("memory.emptyDescription")}
                </p>
              </div>
            ) : (
              <MemoryList
                hasError={listQuery.isError && !listQuery.data}
                isRetrying={listQuery.isRefetching}
                loading={listQuery.isLoading}
                memories={groups.active}
                onMutated={invalidate}
                onRetry={() => void listQuery.refetch()}
                onSelectProject={handleSelectProject}
                showSource
              />
            ))}

          {tab === "core" && (
            <MemoryList
              hasError={listQuery.isError && !listQuery.data}
              isRetrying={listQuery.isRefetching}
              loading={listQuery.isLoading}
              memories={groups.core}
              onMutated={invalidate}
              onRetry={() => void listQuery.refetch()}
              onSelectProject={handleSelectProject}
            />
          )}

          {tab === "observed" && (
            <MemoryList
              hasError={listQuery.isError && !listQuery.data}
              isRetrying={listQuery.isRefetching}
              loading={listQuery.isLoading}
              memories={groups.observed}
              onMutated={invalidate}
              onRetry={() => void listQuery.refetch()}
              onSelectProject={handleSelectProject}
              showSource
            />
          )}

          {tab === "projects" && (
            <ProjectGroups
              memories={groups.projects}
              selectedProject={selectedProject}
              onSelectProject={setSelectedProject}
              onMutated={invalidate}
            />
          )}

          {tab === "review" && (
            <MemoryList
              memories={reviewMemories}
              loading={reviewQuery.isLoading}
              hasError={reviewQuery.isError}
              onMutated={invalidate}
              onRetry={() => void reviewQuery.refetch()}
              onSelectProject={handleSelectProject}
              review
            />
          )}

          {tab === "archive" && (
            <MemoryList
              emptyTitle={t("memory.archiveEmpty")}
              hasError={listQuery.isError && !listQuery.data}
              isRetrying={listQuery.isRefetching}
              loading={listQuery.isLoading}
              memories={groups.archive}
              onMutated={invalidate}
              onRetry={() => void listQuery.refetch()}
              onSelectProject={handleSelectProject}
            />
          )}
        </div>
      </div>

      <MemoryLensDialog open={lensOpen} onOpenChange={setLensOpen} />
    </WorkspaceLayout>
  );
}
