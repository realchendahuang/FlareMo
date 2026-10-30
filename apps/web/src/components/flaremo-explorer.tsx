import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BrainIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  FileTextIcon,
  FootprintsIcon,
  HashIcon,
  LayoutGridIcon,
  ListChecksIcon,
  MicIcon,
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
import {
  getCaptureStatus,
  type MemoSpace,
  type MemoStatsResponse,
  type TagHierarchyNode,
} from "@/api";
import { authClient } from "@/auth-client";
import { MiniCalendarReminders } from "@/components/flaremo-mini-calendar-panel";
import { FlareMoTimeHorizon } from "@/components/flaremo-time-horizon";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { currentStreak } from "@/lib/activity";
import { queryKeys } from "@/lib/query-keys";
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
  /** Leave room at the header's start for the fixed sidebar toggle. */
  reserveToggle?: boolean;
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

/*
 * Ember 2 sidebar item. Inactive rows are quiet ink; the active row is a
 * raised paper chip (card surface + hairline ring + xs shadow) with the icon
 * in ember, so "where am I" reads without washing the row in brand color.
 */
const NAV_ITEM =
  "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-foreground/70 outline-none transition-[background-color,color,box-shadow] duration-150 hover:bg-muted/70 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground [&>svg]:transition-colors";
const NAV_ACTIVE = {
  className:
    "!bg-card !text-foreground font-medium shadow-xs ring-1 ring-border/70 dark:!bg-muted dark:ring-border [&>svg]:!text-primary",
};

export const FlareMoExplorer = memo(function FlareMoExplorer({
  activeTag,
  footer,
  header,
  headerAction,
  headerScrolled = false,
  reserveToggle = false,
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
  const session = authClient.useSession();
  const captureStatus = useQuery({
    queryKey: queryKeys.captureStatus.forUser(session.data?.user.id),
    queryFn: getCaptureStatus,
    enabled: Boolean(session.data?.user),
    staleTime: 30_000,
    retry: false,
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
          // The fixed toggle sits at 12px; the account menu starts after it.
          reserveToggle && "ps-12",
        )}
      >
        {header}
        {headerAction}
      </header>

      <section className="mb-3 px-1">
        <div className="paper grid grid-cols-3 divide-x divide-border/60 rounded-xl border border-border/60 bg-card py-3 shadow-xs">
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
        className="mt-3 flex flex-col gap-0.5 border-t border-border/60 pt-3"
      >
        <Link
          activeOptions={{ exact: true }}
          activeProps={NAV_ACTIVE}
          className={NAV_ITEM}
          onClick={onNavigate}
          search={{ ...TIMELINE_SEARCH }}
          to="/"
        >
          <LayoutGridIcon />
          <span className="min-w-0 flex-1 truncate">{t("nav.allMemos")}</span>
        </Link>
        <Link
          activeProps={NAV_ACTIVE}
          className={NAV_ITEM}
          onClick={onNavigate}
          to="/review/daily"
        >
          <CalendarDaysIcon />
          <span className="min-w-0 flex-1 truncate">
            {t("nav.dailyReview")}
          </span>
        </Link>
        <Link
          activeProps={NAV_ACTIVE}
          className={NAV_ITEM}
          onClick={onNavigate}
          to="/review/walk"
        >
          <FootprintsIcon />
          <span className="min-w-0 flex-1 truncate">{t("nav.randomWalk")}</span>
        </Link>
        {captureStatus.data?.available && (
          <Link
            activeProps={NAV_ACTIVE}
            className={NAV_ITEM}
            onClick={onNavigate}
            to="/capture"
          >
            <MicIcon />
            <span className="min-w-0 flex-1 truncate">{t("nav.capture")}</span>
          </Link>
        )}
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

      <section className="mt-5 flex flex-col gap-1.5 px-1">
        <h3 className="px-2 pb-0.5 text-xs font-medium text-muted-foreground">
          {t("explorer.tags")}
        </h3>
        <button
          aria-pressed={untagged}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-left motion-safe:transition-colors motion-safe:duration-150",
            untagged
              ? "bg-card font-medium text-foreground shadow-xs ring-1 ring-border/70 dark:bg-muted"
              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
          )}
          type="button"
          onClick={() => {
            onUntaggedChange(!untagged);
            onNavigate?.();
          }}
        >
          <HashIcon className="size-3.5 shrink-0 opacity-60" />
          <span className="truncate">{t("explorer.untagged")}</span>
        </button>
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

    return (
      <div className="flex flex-col" key={name}>
        <div
          className={cn(
            "group flex h-7 items-center gap-1 rounded-md pe-1 text-[13px] motion-safe:transition-colors motion-safe:duration-150",
            isActive
              ? "bg-card font-medium text-foreground shadow-xs ring-1 ring-border/70 dark:bg-muted"
              : "text-foreground/70 hover:bg-muted/70 hover:text-foreground",
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
              "flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 hover:text-foreground",
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
            <HashIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
            <span className="truncate">{label}</span>
            {node.count > 1 && (
              <span className="ms-auto ps-1 text-xs tabular-nums text-muted-foreground/70">
                {node.count}
              </span>
            )}
          </button>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 motion-safe:transition-opacity motion-safe:duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            <Button
              aria-label={t("explorer.renameTag")}
              className="size-5 text-muted-foreground hover:text-foreground"
              onClick={() => setEditing(name)}
              size="icon-xs"
              title={t("explorer.renameTag")}
              type="button"
              variant="ghost"
            >
              <PencilIcon className="size-3" />
            </Button>
            <Button
              aria-label={t("explorer.deleteTag")}
              className="size-5 text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteTarget(name)}
              size="icon-xs"
              title={t("explorer.deleteTag")}
              type="button"
              variant="ghost"
            >
              <Trash2Icon className="size-3" />
            </Button>
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
      <Input
        aria-label={t("explorer.renameTagLabel")}
        className="h-7 text-xs md:text-xs"
        onChange={(event) => setValue(event.target.value)}
        placeholder={t("explorer.renameTagPlaceholder")}
        ref={inputRef}
        value={value}
      />
      <div className="flex gap-1">
        <Button size="xs" type="submit">
          {t("common.save")}
        </Button>
        <Button onClick={onCancel} size="xs" type="button" variant="ghost">
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center justify-center px-1 text-center">
      <div className="text-lg leading-none font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
