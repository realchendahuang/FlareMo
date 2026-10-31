import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArchiveIcon,
  BrainIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  FileTextIcon,
  HashIcon,
  LayoutGridIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
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
import type { MemoSpace, MemoStatsResponse, TagHierarchyNode } from "@/api";
import { MiniCalendarReminders } from "@/components/flaremo-mini-calendar-panel";
import { FlareMoTimeHorizon } from "@/components/flaremo-time-horizon";
import { NAV_ACTIVE_CLASS, NAV_ITEM_CLASS } from "@/components/nav-item-styles";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { currentStreak } from "@/lib/activity";
import { TIMELINE_SEARCH } from "@/lib/timeline-search";
import { cn } from "@/lib/utils";

export type ExplorerView = "all" | "archived" | "trashed";

export type TimeView = "trend" | "calendar";

type FlareMoExplorerProps = {
  activeTag?: string;
  footer?: ReactNode;
  /** Top-left slot (the member menu trigger). Branding lives in the favicon
   * and share pages, not here. */
  header?: ReactNode;
  /** Top-right slot (e.g. the desktop collapse-sidebar button). */
  headerAction?: ReactNode;
  /** The panel has scrolled: draw the header hairline, like the page header. */
  headerScrolled?: boolean;
  hierarchy: TagHierarchyNode[];
  hierarchyPending?: boolean;
  stats: MemoStatsResponse;
  /** Viewer's IANA zone + space scope: the year view anchors its own stats
   * query with them (issue #144). */
  timeZone: string;
  space?: MemoSpace;
  untagged?: boolean;
  onDeleteTag: (tag: string) => void;
  onRenameTag: (from: string, to: string) => void;
  onTagChange: (tag?: string) => void;
  onUntaggedChange: (untagged: boolean) => void;
  /** Jump the timeline to a heatmap day (mini strip + stats). */
  onDaySelect?: (date: string) => void;
  onNavigate?: () => void;
};

const NAV_ITEM = NAV_ITEM_CLASS;
const NAV_ACTIVE = { className: NAV_ACTIVE_CLASS };

export const FlareMoExplorer = memo(function FlareMoExplorer({
  activeTag,
  footer,
  header,
  headerAction,
  headerScrolled = false,
  hierarchy,
  hierarchyPending = false,
  stats,
  timeZone,
  space,
  untagged = false,
  onDeleteTag,
  onRenameTag,
  onTagChange,
  onUntaggedChange,
  onDaySelect,
  onNavigate,
}: FlareMoExplorerProps) {
  const { t } = useI18n();
  const inReview = useRouterState({
    select: (state) => state.location.pathname.startsWith("/review/"),
  });
  // Memos, archive and trash are one route told apart by `?view=`, so the
  // three rows match on that instead of the router's exact-search rule.
  const timelineView = useRouterState({
    select: (state) => {
      if (state.location.pathname !== "/") return null;
      const view = (state.location.search as { view?: ExplorerView }).view;
      return view ?? "all";
    },
  });
  const streak = useMemo(() => currentStreak(stats.activity), [stats.activity]);

  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  return (
    <aside className="flex min-h-full flex-col px-3 pb-4 text-sm">
      {/* Sticky so the account menu stays reachable when the tag list runs
          past the viewport. Same geometry as the page header beside it — 56px
          row plus a 1px edge, content centered — so the account row and the
          page title share one baseline, and the edge appears on scroll just
          like the page header's does. `-mx-3 px-4` covers the column's
          gutters so scrolled content passes behind the row. */}
      <header
        className={cn(
          "sticky top-0 z-10 -mx-3 mb-1 box-content flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/90 px-4 backdrop-blur-md motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200",
          headerScrolled ? "border-border shadow-xs" : "border-transparent",
        )}
      >
        {header}
        {headerAction}
      </header>

      <section className="mb-3 px-1">
        <div className="paper grid grid-cols-3 divide-x divide-border/60 rounded-xl border border-border/60 bg-card py-2.5 shadow-xs">
          <StatCell label={t("explorer.records")} value={stats.counts.total} />
          <StatCell label={t("explorer.tags")} value={stats.tags.length} />
          <StatCell label={t("explorer.streak")} value={streak} />
        </div>
      </section>

      <section className="mb-2 px-1">
        <MiniCalendarReminders />
        <FlareMoTimeHorizon
          hoveredDate={hoveredDate}
          space={space}
          stats={stats}
          timeZone={timeZone}
          streak={streak}
          onDaySelect={onDaySelect}
          onHoverDate={setHoveredDate}
          onNavigate={onNavigate}
        />
      </section>

      <nav
        aria-label={t("sidebar.navigation")}
        className="mt-3 flex flex-col gap-0.5"
      >
        <Link
          aria-current={timelineView === "all" ? "page" : undefined}
          className={cn(NAV_ITEM, timelineView === "all" && NAV_ACTIVE_CLASS)}
          onClick={onNavigate}
          search={{ ...TIMELINE_SEARCH }}
          to="/"
        >
          <LayoutGridIcon />
          <span className="min-w-0 flex-1 truncate">{t("nav.allMemos")}</span>
        </Link>
        {/* One entry for both ways of looking back; the page header
            switches between "on this day" and the random walk. */}
        <Link
          aria-current={inReview ? "page" : undefined}
          className={cn(NAV_ITEM, inReview && NAV_ACTIVE_CLASS)}
          onClick={onNavigate}
          to="/review/daily"
        >
          <CalendarDaysIcon />
          <span className="min-w-0 flex-1 truncate">{t("nav.review")}</span>
        </Link>
        <Link
          activeProps={NAV_ACTIVE}
          className={NAV_ITEM}
          onClick={onNavigate}
          to="/memory"
        >
          <BrainIcon />
          <span className="min-w-0 flex-1 truncate">{t("nav.memory")}</span>
        </Link>
        <Link
          activeProps={NAV_ACTIVE}
          className={NAV_ITEM}
          onClick={onNavigate}
          to="/projects"
        >
          <ListChecksIcon />
          <span className="min-w-0 flex-1 truncate">{t("nav.projects")}</span>
        </Link>
        <Link
          activeProps={NAV_ACTIVE}
          className={NAV_ITEM}
          onClick={onNavigate}
          to="/articles"
        >
          <FileTextIcon />
          <span className="min-w-0 flex-1 truncate">{t("nav.articles")}</span>
        </Link>
      </nav>

      <section className="mt-4 flex flex-col gap-0.5">
        <h3 className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
          {t("explorer.tags")}
        </h3>
        {/* With no tags at all, "untagged" would just repeat "all memos". */}
        {(hierarchyPending || hierarchy.length > 0 || untagged) && (
          <button
            aria-pressed={untagged}
            className={cn(
              "flex h-7 items-center gap-2.5 rounded-md ps-2.5 pe-1 text-[13px] text-left motion-safe:transition-colors motion-safe:duration-150",
              untagged
                ? "bg-card font-medium text-foreground shadow-xs ring-1 ring-border/70 dark:bg-muted"
                : "text-foreground/70 hover:bg-muted/70 hover:text-foreground",
            )}
            type="button"
            onClick={() => {
              onUntaggedChange(!untagged);
              onNavigate?.();
            }}
          >
            <HashIcon className="size-4 shrink-0 text-muted-foreground/70" />
            <span className="truncate">{t("explorer.untagged")}</span>
          </button>
        )}
        {hierarchyPending ? (
          // Loading state, not the empty state: flashing「无标签」before the
          // real tree expands reads as data loss. Hold a few ghost rows.
          <div aria-hidden="true" className="flex flex-col gap-1.5">
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="ml-4 h-5 w-2/5" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : hierarchy.length > 0 ? (
          <TagTree
            activeTag={activeTag}
            nodes={hierarchy}
            onDeleteTag={onDeleteTag}
            onRenameTag={onRenameTag}
            onTagChange={onTagChange}
            onNavigate={onNavigate}
          />
        ) : (
          <div className="px-2.5 text-xs/relaxed text-muted-foreground">
            {t("explorer.noTags")}
          </div>
        )}
      </section>
      {/* Places notes go when they leave the timeline. Low-frequency, so
          they sink to the bottom of the panel instead of sitting among the
          modules; they are pages to visit, not filters on the timeline. */}
      <nav
        aria-label={t("sidebar.storage")}
        className="mt-auto flex flex-col gap-0.5 pt-6"
      >
        {(
          [
            ["archived", ArchiveIcon, t("view.archive")],
            ["trashed", Trash2Icon, t("view.trash")],
          ] as const
        ).map(([view, Icon, label]) => (
          <Link
            aria-current={timelineView === view ? "page" : undefined}
            className={cn(NAV_ITEM, timelineView === view && NAV_ACTIVE_CLASS)}
            key={view}
            onClick={onNavigate}
            search={{ ...TIMELINE_SEARCH, view }}
            to="/"
          >
            <Icon />
            <span className="min-w-0 flex-1 truncate">{label}</span>
          </Link>
        ))}
      </nav>
      {footer && <div className="px-1 pt-5 pb-1">{footer}</div>}
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

const TAG_COLLAPSED_STORAGE_KEY = "flaremo.explorer.collapsedTags";

function readCollapsedTags(): Set<string> {
  try {
    const stored = localStorage.getItem(TAG_COLLAPSED_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch {
    // Best-effort storage fallback
  }
  return new Set();
}

function TagTree({
  activeTag,
  nodes,
  onDeleteTag,
  onRenameTag,
  onTagChange,
  onNavigate,
}: TagTreeProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedTags);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const toggle = (name: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      try {
        localStorage.setItem(
          TAG_COLLAPSED_STORAGE_KEY,
          JSON.stringify(Array.from(next)),
        );
      } catch {
        // Ignore quota/private mode errors
      }
      return next;
    });

  const renderNode = (node: TagHierarchyNode, depth: number) => {
    const name = node.name;
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(name);
    const isActive = activeTag === name;
    const label = name.split("/").at(-1) ?? name;

    if (editing === name) {
      return (
        <div className="flex flex-col" key={name}>
          <TagRenameInput
            depth={depth}
            from={name}
            onCancel={() => setEditing(null)}
            onSave={(to) => {
              onRenameTag(name, to);
              setEditing(null);
            }}
          />
          {hasChildren && !isCollapsed && (
            <div className="flex flex-col">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col" key={name}>
        <div
          className={cn(
            "group relative flex h-7 items-center gap-1 rounded-md pe-1 text-[13px] motion-safe:transition-colors motion-safe:duration-150",
            isActive
              ? "bg-card font-medium text-foreground shadow-xs ring-1 ring-border/70 dark:bg-muted"
              : "text-foreground/70 hover:bg-muted/70 hover:text-foreground",
          )}
          style={{ paddingInlineStart: `${0.625 + depth * 0.875}rem` }}
        >
          <button
            aria-pressed={isActive}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-3 focus-visible:after:ring-ring/25"
            type="button"
            onClick={() => {
              onTagChange(isActive ? undefined : name);
              onNavigate?.();
            }}
          >
            <HashIcon className="size-4 shrink-0 text-muted-foreground/70" />
            <span className="truncate">{label}</span>
          </button>
          {hasChildren && (
            <button
              aria-label={
                isCollapsed ? t("explorer.expand") : t("explorer.collapse")
              }
              className="relative z-10 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 hover:text-foreground"
              type="button"
              onClick={() => toggle(name)}
            >
              <ChevronRightIcon
                className={cn(
                  "size-3.5 motion-safe:transition-transform motion-safe:duration-150 rtl:-scale-x-100",
                  !isCollapsed && "rotate-90",
                )}
              />
            </button>
          )}
          {/* Count and menu share the trailing slot, like project rows on the
              to-do page: the menu takes over on hover and stays on touch. */}
          {node.count > 0 && (
            <span className="min-w-5 shrink-0 text-end text-xs tabular-nums text-muted-foreground/70 group-focus-within:invisible group-hover:invisible [@media(pointer:coarse)]:invisible">
              {node.count}
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={t("common.more")}
                  className="absolute end-1 top-1/2 z-10 size-5 -translate-y-1/2 text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100 [@media(pointer:coarse)]:opacity-100"
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(name)}>
                <PencilIcon data-icon="inline-start" />
                {t("explorer.renameTag")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteTarget(name)}
              >
                <Trash2Icon data-icon="inline-start" />
                {t("explorer.deleteTag")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {hasChildren && !isCollapsed && (
          <div className="flex flex-col motion-safe:animate-fade">
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
  depth,
  from,
  onCancel,
  onSave,
}: {
  depth: number;
  from: string;
  onCancel: () => void;
  onSave: (to: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(from);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  // Renaming rewrites every memo carrying the tag, so only Enter commits;
  // Escape or clicking away leaves the tag as it was.
  return (
    <form
      className="flex h-7 items-center"
      style={{ paddingInlineStart: `${0.25 + depth * 0.875}rem` }}
      onSubmit={(event) => {
        event.preventDefault();
        const to = value.trim();
        if (to && to !== from) onSave(to);
        else onCancel();
      }}
    >
      <Input
        aria-label={t("explorer.renameTagLabel")}
        className="h-7 px-2 text-[13px] md:text-[13px]"
        onBlur={onCancel}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        placeholder={t("explorer.renameTagPlaceholder")}
        ref={inputRef}
        title={t("explorer.renameTagLabel")}
        value={value}
      />
    </form>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center px-1 text-center">
      <div className="text-lg leading-none font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </div>
      <div className="mt-1.5 max-w-full truncate text-xs text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
