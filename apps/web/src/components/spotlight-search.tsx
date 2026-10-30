import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  CheckSquareIcon,
  FileTextIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  SunMoonIcon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listMemos, type Memo, type Task } from "@/api";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export type SpotlightSearchProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onSelectMemo?: (memoId: string) => void;
  onSelectTask?: (task: Task) => void;
  onNewMemo?: () => void;
  tasks?: Task[];
  memos?: Memo[];
  semanticMode: boolean;
  onToggleSemantic?: () => void;
  semanticPending?: boolean;
  isSearching?: boolean;
};

export function SpotlightSearch({
  open,
  onOpenChange,
  query,
  onQueryChange,
  onSelectMemo,
  onSelectTask,
  onNewMemo,
  tasks = [],
  memos = [],
  semanticMode,
  onToggleSemantic,
  semanticPending = false,
  isSearching = false,
}: SpotlightSearchProps) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(query);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Synchronize draft with query when opened
  useEffect(() => {
    if (!open) return;
    setDraft(query);
    setSelectedIndex(0);
    // Focus lands after the dialog's open animation; the timer is cleared on
    // close/unmount so it can never steal focus back to a hidden input.
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open, query]);

  const trimmedDraft = draft.trim();

  // Instant global search probe across the entire corpus
  const remoteMemosQuery = useQuery({
    queryKey: ["spotlight-remote-memos", trimmedDraft],
    queryFn: ({ signal }) =>
      listMemos({ q: trimmedDraft, page_size: 6 }, signal),
    enabled: open && trimmedDraft.length >= 1,
    staleTime: 10_000,
  });

  // Filter tasks based on draft
  const matchingTasks = useMemo(() => {
    const q = trimmedDraft.toLowerCase();
    if (!q) return [];
    return tasks
      .filter(
        (task) =>
          task.title.toLowerCase().includes(q) ||
          (task.notes?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 4);
  }, [tasks, trimmedDraft]);

  // Global matching memos: prefer server results once returned; fall back
  // immediately to memory cache so keystroke feedback is instant.
  const matchingMemos = useMemo(() => {
    if (!trimmedDraft) return [];
    if (remoteMemosQuery.data?.memos) {
      return remoteMemosQuery.data.memos.slice(0, 6);
    }
    const q = trimmedDraft.toLowerCase();
    return memos
      .filter((memo) => memo.content.toLowerCase().includes(q))
      .slice(0, 5);
  }, [trimmedDraft, remoteMemosQuery.data, memos]);

  // Collect all selectable action items
  type SearchActionItem = {
    id: string;
    type: "task" | "memo" | "action";
    title: string;
    subtitle?: string;
    icon: typeof SearchIcon;
    onExecute: () => void;
  };

  const actionItems = useMemo<SearchActionItem[]>(() => {
    const items: SearchActionItem[] = [];
    const q = draft.trim();

    if (q) {
      // Primary action: filter timeline
      items.push({
        id: "apply-filter",
        type: "action",
        title: t("search.viewInTimeline", { query: q }),
        subtitle: t("search.pressEnterHint"),
        icon: SearchIcon,
        onExecute: () => {
          onQueryChange(draft);
          onOpenChange(false);
        },
      });

      // Tasks
      for (const task of matchingTasks) {
        items.push({
          id: `task-${task.id}`,
          type: "task",
          title: task.title,
          subtitle: task.due_at
            ? `${t("projects.field.dueDate")}: ${task.due_at}`
            : undefined,
          icon: CheckSquareIcon,
          onExecute: () => {
            onOpenChange(false);
            if (onSelectTask) {
              onSelectTask(task);
            } else {
              onQueryChange(task.title);
            }
          },
        });
      }

      // Memos
      for (const memo of matchingMemos) {
        const preview = memo.content.replace(/\s+/g, " ").slice(0, 70);
        items.push({
          id: `memo-${memo.id}`,
          type: "memo",
          title: preview,
          subtitle: (memo.display_time ?? memo.create_time)?.slice(0, 10),
          icon: FileTextIcon,
          onExecute: () => {
            onOpenChange(false);
            if (onSelectMemo) {
              onSelectMemo(memo.id);
            } else {
              onQueryChange(draft);
            }
          },
        });
      }
    } else {
      // Default quick actions when draft is empty
      items.push({
        id: "action-new-memo",
        type: "action",
        title: t("search.actionNewMemo"),
        subtitle: t("search.shortcutHintC"),
        icon: PlusIcon,
        onExecute: () => {
          onOpenChange(false);
          onNewMemo?.();
        },
      });

      items.push({
        id: "action-toggle-theme",
        type: "action",
        title: t("search.actionToggleTheme"),
        subtitle:
          theme === "dark"
            ? t("theme.dark")
            : theme === "light"
              ? t("theme.light")
              : t("theme.system"),
        icon: SunMoonIcon,
        onExecute: () => {
          setTheme(theme === "dark" ? "light" : "dark");
          onOpenChange(false);
        },
      });
    }

    return items;
  }, [
    draft,
    matchingTasks,
    matchingMemos,
    onQueryChange,
    onOpenChange,
    onSelectTask,
    onSelectMemo,
    onNewMemo,
    t,
    theme,
    setTheme,
  ]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, actionItems.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) =>
        prev <= 0 ? Math.max(0, actionItems.length - 1) : prev - 1,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const current = actionItems[selectedIndex];
      if (current) {
        current.onExecute();
      } else if (draft.trim()) {
        onQueryChange(draft);
        onOpenChange(false);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] translate-y-0 w-full max-w-lg overflow-hidden rounded-xl border border-border/60 bg-popover/95 p-0 shadow-lg backdrop-blur-xl sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{t("common.search")}</DialogTitle>

        {/* Search Input Bar */}
        <div className="border-b border-border/60 p-2.5">
          <InputGroup className="h-11 border-none bg-transparent shadow-none ring-0 focus-within:ring-0">
            <InputGroupAddon className="pl-1 text-muted-foreground">
              {isSearching || remoteMemosQuery.isFetching ? (
                <Spinner className="size-4.5 text-primary" />
              ) : (
                <SearchIcon className="size-4.5" />
              )}
            </InputGroupAddon>
            <InputGroupInput
              ref={inputRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                semanticMode
                  ? t("search.semanticPlaceholder")
                  : t("search.spotlightPlaceholder")
              }
              className="h-full border-none bg-transparent px-2 text-sm shadow-none focus-visible:ring-0"
            />
            <InputGroupAddon align="inline-end" className="gap-1 pr-1">
              {draft && (
                <InputGroupButton
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => {
                    setDraft("");
                    setSelectedIndex(0);
                    inputRef.current?.focus();
                  }}
                  title={t("search.clear")}
                >
                  <XIcon className="size-3.5" />
                </InputGroupButton>
              )}
              {onToggleSemantic && (
                <Button
                  size="xs"
                  variant={semanticMode ? "secondary" : "ghost"}
                  onClick={onToggleSemantic}
                  disabled={semanticPending}
                  className={cn(
                    "h-7 gap-1 rounded-md px-2 text-xs",
                    semanticMode && "bg-primary/10 text-primary font-medium",
                  )}
                  title={t("search.semanticToggle")}
                >
                  {semanticPending ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <SparklesIcon className="size-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    {t("search.semanticToggleShort")}
                  </span>
                </Button>
              )}
            </InputGroupAddon>
          </InputGroup>
        </div>

        {/* Results / Suggestions List */}
        <div className="max-h-[380px] overflow-y-auto p-2 divide-y divide-border/20">
          {actionItems.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {actionItems.map((item, idx) => {
                const Icon = item.icon;
                const isSelected = selectedIndex === idx;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={item.onExecute}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors cursor-pointer",
                      isSelected
                        ? "bg-accent text-accent-foreground shadow-2xs"
                        : "text-foreground hover:bg-accent/50",
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/40",
                        isSelected
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-3.5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium leading-tight">
                        {item.title}
                      </p>
                      {item.subtitle && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.subtitle}
                        </p>
                      )}
                    </div>

                    {item.type === "action" && (
                      <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-muted-foreground">
              <SearchIcon className="size-6 text-muted-foreground/40 mb-2" />
              <span>{t("search.emptyHint")}</span>
            </div>
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div className="flex items-center justify-between border-t border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>
              <kbd className="rounded border bg-background px-1 py-0.5 text-[10px] font-mono">
                ↑↓
              </kbd>{" "}
              {t("search.navigateHint")}
            </span>
            <span>
              <kbd className="rounded border bg-background px-1 py-0.5 text-[10px] font-mono">
                ↵
              </kbd>{" "}
              {t("search.selectHint")}
            </span>
          </div>
          <span>
            <kbd className="rounded border bg-background px-1 py-0.5 text-[10px] font-mono">
              esc
            </kbd>{" "}
            {t("common.cancel")}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Clean trigger button for the header:
 * Renders `[ 🔍 搜索记录… ⌘K ]` (or active query)
 */
export function SpotlightSearchTrigger({
  onClick,
  activeQuery,
  onClear,
  className,
}: {
  onClick: () => void;
  activeQuery?: string;
  onClear?: () => void;
  className?: string;
}) {
  const { t } = useI18n();

  if (activeQuery) {
    return (
      <div
        className={cn(
          "flex h-8.5 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 text-xs text-primary shadow-2xs",
          className,
        )}
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 max-w-[120px] truncate font-medium">
          {activeQuery}
        </span>
        {onClear && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="rounded p-0.5 hover:bg-primary/15 text-primary transition-colors cursor-pointer"
            title={t("search.clear")}
          >
            <XIcon className="size-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex h-8.5 w-[220px] sm:w-[260px] items-center justify-between rounded-lg border border-border/60 bg-muted/40 px-2.5 text-xs text-muted-foreground transition-all cursor-pointer hover:border-border hover:bg-accent/60 hover:text-foreground shadow-2xs",
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0 truncate">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        <span className="truncate">{t("search.triggerPlaceholder")}</span>
      </div>
      <kbd className="hidden sm:inline-flex h-4.5 select-none items-center gap-0.5 rounded border border-border/70 bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
        <span className="text-[11px]">⌘</span>K
      </kbd>
    </button>
  );
}
