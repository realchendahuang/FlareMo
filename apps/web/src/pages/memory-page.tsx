import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BrainIcon,
  ChevronRightIcon,
  EyeIcon,
  FolderIcon,
  PinIcon,
  SparklesIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { listMemories, listMemoryReview } from "@/api";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FilterPill } from "@/components/ui/filter-pill";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { useI18n } from "@/i18n";
import { countProjects, groupMemories } from "./memory/memory-filters";
import { MemoryLensDialog } from "./memory/memory-lens-dialog";
import { MemoryList } from "./memory/memory-list";
import { MemoryQuickComposer } from "./memory/memory-quick-composer";
import { MemoryWorkspaceHeader } from "./memory/memory-workspace-header";

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
  const projectCounts = useMemo(
    () => countProjects(groups.projects),
    [groups.projects],
  );
  // The composer offers every known project, not only the ones a search left.
  const allProjectCounts = useMemo(
    () => countProjects(groupMemories(memories).projects),
    [memories],
  );

  const reviewMemories = useMemo(() => {
    const items = reviewQuery.data?.memories ?? [];
    const q = query.trim().toLowerCase();
    return q
      ? items.filter((memory) => memory.content.toLowerCase().includes(q))
      : items;
  }, [reviewQuery.data, query]);
  const reviewCount = reviewQuery.data?.memories.length ?? 0;

  const openTab = useCallback((next: FilterTab, project?: string | null) => {
    setTab(next);
    setSelectedProject(project ?? null);
  }, []);

  const handleSelectProject = useCallback(
    (projectKey: string) => openTab("projects", projectKey),
    [openTab],
  );

  // Stable identity so the memoized MemoryCard rows survive a parent render.
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["memories"] });
  }, [queryClient]);

  const listState = {
    hasError: listQuery.isError && !listQuery.data,
    isRetrying: listQuery.isRefetching,
    loading: listQuery.isLoading,
    onMutated: invalidate,
    onRetry: () => void listQuery.refetch(),
    onSelectProject: handleSelectProject,
  };

  const isEmptyLedger =
    memories.length === 0 && !listQuery.isLoading && !listQuery.isError;

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
        // Guard the same-value case: a bare setState here re-rendered the
        // whole memory page on every scroll event, not just at the threshold.
        const next = event.currentTarget.scrollTop > 4;
        setIsScrolled((prev) => (prev === next ? prev : next));
      }}
    >
      <div className="flex flex-col gap-3.5 pt-2">
        {/* Same quiet notice as the home page's daily-review row: the inbox
            is a nudge, not an alarm. */}
        {reviewCount > 0 && tab !== "review" && (
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-xl border border-brand-300/40 bg-brand-50/50 px-3.5 py-2.5 text-start text-sm text-foreground motion-safe:animate-rise motion-safe:transition-[background-color,border-color] motion-safe:duration-150 hover:bg-brand-50 dark:border-brand-400/25 dark:bg-brand-400/5 dark:hover:bg-brand-400/10"
            data-testid="memory-review-notice"
            onClick={() => openTab("review")}
          >
            <SparklesIcon className="size-4 shrink-0 text-brand-500 dark:text-brand-400" />
            <span className="min-w-0 flex-1 truncate">
              {t("memory.bannerReviewAlert", { count: reviewCount })}
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
          </button>
        )}

        <MemoryQuickComposer
          defaultScopeKey={tab === "projects" ? selectedProject : null}
          projects={allProjectCounts}
          onCreated={invalidate}
        />

        {!isEmptyLedger && (
          <div className="flex flex-col gap-2 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterPill
                active={tab === "all"}
                label={t("memory.filterAll")}
                count={groups.active.length}
                onClick={() => openTab("all")}
              />
              <FilterPill
                active={tab === "core"}
                label={t("memory.filterCore")}
                count={groups.core.length}
                icon={<PinIcon className="size-3" />}
                onClick={() => openTab("core")}
              />
              {(groups.observed.length > 0 || tab === "observed") && (
                <FilterPill
                  active={tab === "observed"}
                  label={t("memory.filterObserved")}
                  count={groups.observed.length}
                  icon={<EyeIcon className="size-3" />}
                  onClick={() => openTab("observed")}
                />
              )}
              {(groups.projects.length > 0 || tab === "projects") && (
                <FilterPill
                  active={tab === "projects"}
                  label={t("memory.tab.projects")}
                  count={groups.projects.length}
                  icon={<FolderIcon className="size-3" />}
                  onClick={() => openTab("projects")}
                />
              )}
              {(reviewCount > 0 || tab === "review") && (
                <FilterPill
                  active={tab === "review"}
                  label={t("memory.filterReview")}
                  count={reviewCount}
                  highlight={reviewCount > 0}
                  onClick={() => openTab("review")}
                />
              )}
              {(groups.archive.length > 0 || tab === "archive") && (
                <FilterPill
                  active={tab === "archive"}
                  label={t("memory.tab.archive")}
                  count={groups.archive.length}
                  onClick={() => openTab("archive")}
                />
              )}
            </div>

            {tab === "projects" && projectCounts.length > 1 && (
              <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pt-0.5 pb-1">
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
        )}

        <div className="pt-1">
          {isEmptyLedger && !query ? (
            <Empty className="min-h-56 border motion-safe:animate-rise">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BrainIcon />
                </EmptyMedia>
                <EmptyTitle>{t("memory.emptyTitle")}</EmptyTitle>
                <EmptyDescription>
                  {t("memory.emptyDescription")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {tab === "all" && (
                <MemoryList {...listState} memories={groups.active} />
              )}

              {tab === "core" && (
                <MemoryList
                  {...listState}
                  emptyTitle={t("memory.coreEmpty")}
                  memories={groups.core}
                />
              )}

              {tab === "observed" && (
                <MemoryList {...listState} memories={groups.observed} />
              )}

              {tab === "projects" &&
                (selectedProject || projectCounts.length <= 1 ? (
                  <MemoryList
                    {...listState}
                    hideProject
                    memories={groups.projects.filter(
                      (m) =>
                        !selectedProject ||
                        (m.scope_key ?? m.scope_type) === selectedProject,
                    )}
                  />
                ) : (
                  // Every project at once, each under its own small label;
                  // the label is the shortcut into that project alone.
                  <div className="flex flex-col gap-6">
                    {projectCounts.map((project) => (
                      <section
                        className="flex flex-col gap-2"
                        key={project.key}
                      >
                        <button
                          type="button"
                          className="flex w-fit items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground motion-safe:transition-colors hover:text-foreground"
                          onClick={() => setSelectedProject(project.key)}
                          title={project.key}
                        >
                          <FolderIcon className="size-3" />
                          <span>{project.displayName}</span>
                          <span className="tabular-nums opacity-60">
                            {project.count}
                          </span>
                        </button>
                        <MemoryList
                          {...listState}
                          hideProject
                          memories={groups.projects.filter(
                            (m) =>
                              (m.scope_key ?? m.scope_type) === project.key,
                          )}
                        />
                      </section>
                    ))}
                  </div>
                ))}

              {tab === "review" && (
                <MemoryList
                  hasError={reviewQuery.isError}
                  isRetrying={reviewQuery.isRefetching}
                  loading={reviewQuery.isLoading}
                  memories={reviewMemories}
                  onMutated={invalidate}
                  onRetry={() => void reviewQuery.refetch()}
                  onSelectProject={handleSelectProject}
                  review
                />
              )}

              {tab === "archive" && (
                <MemoryList
                  {...listState}
                  emptyTitle={t("memory.archiveEmpty")}
                  memories={groups.archive}
                />
              )}
            </>
          )}
        </div>
      </div>

      <MemoryLensDialog
        open={lensOpen}
        onOpenChange={setLensOpen}
        projects={allProjectCounts}
        defaultProject={tab === "projects" ? selectedProject : null}
      />
    </WorkspaceLayout>
  );
}
