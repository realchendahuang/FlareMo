import { Link } from "@tanstack/react-router";
import {
  ArchiveIcon,
  BrainIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ChevronRightIcon,
  FolderKanbanIcon,
  FootprintsIcon,
  HashIcon,
  InboxIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import {
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MemoStatsResponse, TagHierarchyNode } from "@/api";
import { FlareMoLogo } from "@/components/flaremo-logo";
import {
  MiniCalendarPanel,
  MiniCalendarReminders,
} from "@/components/flaremo-mini-calendar-panel";
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
import { useI18n } from "@/i18n";
import { buildMonthLabels } from "@/lib/activity";
import { cn } from "@/lib/utils";

export type ExplorerView = "all" | "archived" | "trashed";

// One slot, two looks at time: the 12-week writing trend, or the current
// month's schedule. Persisted so the sidebar keeps the user's choice.
export type TimeView = "trend" | "calendar";

const TIME_VIEW_STORAGE_KEY = "flaremo.explorer.timeView";

function readTimeView(): TimeView {
  try {
    const stored = localStorage.getItem(TIME_VIEW_STORAGE_KEY);
    if (stored === "trend" || stored === "calendar") return stored;
  } catch {
    // Storage can be unavailable (private mode); fall back to the default.
  }
  return "trend";
}

type FlareMoExplorerProps = {
  activeTag?: string;
  activeView: ExplorerView;
  footer?: ReactNode;
  headerAction?: ReactNode;
  hierarchy: TagHierarchyNode[];
  stats: MemoStatsResponse;
  untagged?: boolean;
  onDeleteTag: (tag: string) => void;
  onRenameTag: (from: string, to: string) => void;
  onTagChange: (tag?: string) => void;
  onUntaggedChange: (untagged: boolean) => void;
  onViewChange: (view: ExplorerView) => void;
  onNavigate?: () => void;
};

export const FlareMoExplorer = memo(function FlareMoExplorer({
  activeTag,
  activeView,
  footer,
  headerAction,
  hierarchy,
  stats,
  untagged = false,
  onDeleteTag,
  onRenameTag,
  onTagChange,
  onUntaggedChange,
  onViewChange,
  onNavigate,
}: FlareMoExplorerProps) {
  const { locale, t } = useI18n();
  const navItems = [
    {
      count: stats.counts.normal,
      icon: InboxIcon,
      label: t("view.timeline"),
      view: "all" as const,
    },
    {
      count: stats.counts.archived,
      icon: ArchiveIcon,
      label: t("view.archive"),
      view: "archived" as const,
    },
    {
      count: stats.counts.trashed,
      icon: Trash2Icon,
      label: t("view.trash"),
      view: "trashed" as const,
    },
  ];
  const activityTotal = useMemo(
    () => stats.activity.reduce((total, day) => total + day.count, 0),
    [stats.activity],
  );
  const monthLabels = useMemo(
    () => buildMonthLabels(stats.activity, locale),
    [stats.activity, locale],
  );
  const [timeView, setTimeView] = useState<TimeView>(readTimeView);
  const selectTimeView = (view: TimeView) => {
    setTimeView(view);
    try {
      localStorage.setItem(TIME_VIEW_STORAGE_KEY, view);
    } catch {
      // Persistence is best-effort; the in-memory choice still applies.
    }
  };

  return (
    <aside className="flex min-h-full flex-col px-3 py-4 text-sm">
      <header className="mb-5 flex items-center justify-between gap-2 px-1">
        <FlareMoLogo />
        {headerAction}
      </header>

      <section className="mb-4 grid grid-cols-3 gap-2 px-1 motion-safe:animate-rise">
        <StatCell label={t("explorer.records")} value={stats.counts.total} />
        <StatCell label={t("explorer.tags")} value={stats.tags.length} />
        <StatCell label={t("explorer.days")} value={stats.active_days} />
      </section>

      <section className="mb-4 px-1 motion-safe:animate-fade">
        <MiniCalendarReminders />
        <div
          aria-label={t("explorer.timeViewLabel")}
          className="mb-2 flex rounded-lg border border-border/60 p-0.5 text-xs"
          role="tablist"
        >
          {(
            [
              ["trend", t("explorer.viewTrend")],
              ["calendar", t("explorer.viewCalendar")],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-selected={timeView === value}
              className={cn(
                "flex-1 rounded-md px-2 py-1 motion-safe:transition-colors motion-safe:duration-150",
                timeView === value
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={value}
              role="tab"
              type="button"
              onClick={() => selectTimeView(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-[14.5rem]">
          {timeView === "trend" ? (
            <>
              <div
                aria-label={t("explorer.heatmapSummary", {
                  count: activityTotal,
                  days: stats.activity.length,
                })}
                className="grid grid-flow-col grid-rows-7 gap-1"
                data-testid="activity-heatmap"
                role="img"
              >
                {stats.activity.map((day) => (
                  <div
                    aria-hidden="true"
                    className={cn(
                      "aspect-square rounded-[3px] motion-safe:transition-[opacity,transform] motion-safe:duration-150 hover:opacity-85 motion-safe:hover:scale-110",
                      heatmapColor(day.count),
                    )}
                    key={day.date}
                    title={t("explorer.heatmapDay", {
                      count: day.count,
                      date: day.date,
                    })}
                  />
                ))}
              </div>
              <div
                aria-hidden="true"
                className="mt-2 grid grid-cols-12 gap-1 px-1 text-xs text-muted-foreground"
              >
                {monthLabels.map((month) => (
                  <span className="whitespace-nowrap" key={month.date}>
                    {month.label}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <MiniCalendarPanel activity={stats.activity} />
          )}
        </div>
      </section>

      <nav aria-label={t("sidebar.navigation")} className="flex flex-col gap-1">
        {navItems.map((item) => (
          <button
            aria-current={activeView === item.view ? "page" : undefined}
            className={cn(
              "relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-left motion-safe:transition-[background-color,color,transform] motion-safe:duration-150",
              activeView === item.view
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground motion-safe:hover:translate-x-0.5",
            )}
            key={item.view}
            type="button"
            onClick={() => {
              onViewChange(item.view);
              onNavigate?.();
            }}
          >
            {activeView === item.view && (
              <span
                aria-hidden="true"
                className="bg-brand-gradient absolute top-2 bottom-2 left-0 w-[3px] rounded-full"
              />
            )}
            <item.icon />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="text-xs tabular-nums opacity-60">
              {item.count}
            </span>
          </button>
        ))}
      </nav>

      <section className="mt-5 flex flex-col gap-1 border-t border-border/60 pt-4">
        <Link
          className="flex h-9 items-center gap-3 rounded-lg px-2.5 text-muted-foreground motion-safe:transition-[background-color,color,transform] motion-safe:duration-150 hover:bg-muted hover:text-foreground motion-safe:hover:translate-x-0.5"
          onClick={onNavigate}
          to="/review/daily"
        >
          <CalendarDaysIcon />
          <span className="min-w-0 flex-1 truncate">
            {t("nav.dailyReview")}
          </span>
        </Link>
        <Link
          className="flex h-9 items-center gap-3 rounded-lg px-2.5 text-muted-foreground motion-safe:transition-[background-color,color,transform] motion-safe:duration-150 hover:bg-muted hover:text-foreground motion-safe:hover:translate-x-0.5"
          onClick={onNavigate}
          to="/review/walk"
        >
          <FootprintsIcon />
          <span className="min-w-0 flex-1 truncate">{t("nav.randomWalk")}</span>
        </Link>
        <Link
          className="flex h-9 items-center gap-3 rounded-lg px-2.5 text-muted-foreground motion-safe:transition-[background-color,color,transform] motion-safe:duration-150 hover:bg-muted hover:text-foreground motion-safe:hover:translate-x-0.5"
          onClick={onNavigate}
          to="/memory"
        >
          <BrainIcon />
          <span className="min-w-0 flex-1 truncate">{t("nav.memory")}</span>
        </Link>
        <Link
          className="flex h-9 items-center gap-3 rounded-lg px-2.5 text-muted-foreground motion-safe:transition-[background-color,color,transform] motion-safe:duration-150 hover:bg-muted hover:text-foreground motion-safe:hover:translate-x-0.5"
          onClick={onNavigate}
          to="/calendar"
        >
          <CalendarIcon />
          <span className="min-w-0 flex-1 truncate">{t("nav.calendar")}</span>
        </Link>
        <Link
          className="flex h-9 items-center gap-3 rounded-lg px-2.5 text-muted-foreground motion-safe:transition-[background-color,color,transform] motion-safe:duration-150 hover:bg-muted hover:text-foreground motion-safe:hover:translate-x-0.5"
          onClick={onNavigate}
          to="/projects"
        >
          <FolderKanbanIcon />
          <span className="min-w-0 flex-1 truncate">{t("nav.projects")}</span>
        </Link>
      </section>

      <section className="mt-5 flex flex-col gap-2 px-1">
        <button
          aria-pressed={untagged}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-left motion-safe:transition-colors motion-safe:duration-150",
            untagged
              ? "bg-flame-100 font-medium text-flame-700 dark:bg-flame-400/12 dark:text-flame-200"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          type="button"
          onClick={() => {
            onUntaggedChange(!untagged);
            onNavigate?.();
          }}
        >
          <HashIcon className="opacity-50" />
          <span className="truncate">{t("explorer.untagged")}</span>
        </button>
        {hierarchy.length > 0 ? (
          <TagTree
            activeTag={activeTag}
            nodes={hierarchy}
            onDeleteTag={onDeleteTag}
            onRenameTag={onRenameTag}
            onTagChange={onTagChange}
            onNavigate={onNavigate}
          />
        ) : (
          <div className="text-xs text-muted-foreground">
            {t("explorer.noTags")}
          </div>
        )}
      </section>
      {footer && <div className="mt-auto px-1 pt-5 pb-1">{footer}</div>}
    </aside>
  );
});

type TagTreeProps = {
  activeTag?: string;
  nodes: TagHierarchyNode[];
  onDeleteTag: (tag: string) => void;
  onRenameTag: (from: string, to: string) => void;
  onTagChange: (tag?: string) => void;
  onNavigate?: () => void;
};

function TagTree({
  activeTag,
  nodes,
  onDeleteTag,
  onRenameTag,
  onTagChange,
  onNavigate,
}: TagTreeProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const toggle = (name: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const renderNode = (node: TagHierarchyNode, depth: number) => {
    const name = node.name;
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(name);
    const isActive = activeTag === name;
    const label = name.split("/").at(-1) ?? name;

    return (
      <div className="flex flex-col" key={name}>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-md py-0.5 pr-1 text-xs motion-safe:transition-colors motion-safe:duration-150",
            isActive
              ? "bg-flame-100 font-medium text-flame-700 dark:bg-flame-400/12 dark:text-flame-200"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          style={{ paddingLeft: `${depth * 0.75}rem` }}
        >
          <button
            aria-label={
              hasChildren
                ? isCollapsed
                  ? t("explorer.expand")
                  : t("explorer.collapse")
                : undefined
            }
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground",
              !hasChildren && "invisible",
            )}
            type="button"
            onClick={() => toggle(name)}
          >
            <ChevronRightIcon
              className={cn(
                "h-3.5 w-3.5 motion-safe:transition-transform motion-safe:duration-150",
                !isCollapsed && "rotate-90",
              )}
            />
          </button>
          <button
            aria-pressed={isActive}
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
            type="button"
            onClick={() => {
              onTagChange(isActive ? undefined : name);
              onNavigate?.();
            }}
          >
            <HashIcon className="shrink-0 opacity-50" />
            <span className="truncate">{label}</span>
            {node.count > 1 && (
              <span className="tabular-nums opacity-60">{node.count}</span>
            )}
          </button>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 motion-safe:transition-opacity motion-safe:duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              aria-label={t("explorer.renameTag")}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              title={t("explorer.renameTag")}
              type="button"
              onClick={() => setEditing(name)}
            >
              <PencilIcon className="h-3 w-3" />
            </button>
            <button
              aria-label={t("explorer.deleteTag")}
              className="rounded p-0.5 text-muted-foreground hover:text-destructive"
              title={t("explorer.deleteTag")}
              type="button"
              onClick={() => setDeleteTarget(name)}
            >
              <Trash2Icon className="h-3 w-3" />
            </button>
          </div>
        </div>
        {editing === name && (
          <TagRenameInput
            from={name}
            onCancel={() => setEditing(null)}
            onSave={(to) => {
              onRenameTag(name, to);
              setEditing(null);
            }}
          />
        )}
        {hasChildren && !isCollapsed && (
          <div className="flex flex-col">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="flex flex-col gap-0.5">
        {nodes.map((n) => renderNode(n, 0))}
      </div>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("explorer.deleteTag")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("explorer.tagDeleteConfirm", { tag: deleteTarget ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) onDeleteTag(deleteTarget);
              }}
            >
              {t("explorer.deleteTag")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TagRenameInput({
  from,
  onCancel,
  onSave,
}: {
  from: string;
  onCancel: () => void;
  onSave: (to: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(from);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      className="flex flex-col gap-1 px-1"
      style={{ paddingLeft: "1.5rem" }}
      onSubmit={(event) => {
        event.preventDefault();
        const to = value.trim();
        if (to && to !== from) onSave(to);
        else onCancel();
      }}
    >
      <input
        aria-label={t("explorer.renameTagLabel")}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onChange={(event) => setValue(event.target.value)}
        placeholder={t("explorer.renameTagPlaceholder")}
        ref={inputRef}
        value={value}
      />
      <div className="flex gap-1">
        <button
          className="rounded-md bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:opacity-90"
          type="submit"
        >
          {t("common.save")}
        </button>
        <button
          className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
          type="button"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-heading text-2xl leading-none font-semibold tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function heatmapColor(count: number) {
  if (count <= 0) return "bg-muted";
  if (count === 1) return "bg-primary/20";
  if (count === 2) return "bg-primary/40";
  if (count === 3) return "bg-primary/70";
  return "bg-primary";
}
