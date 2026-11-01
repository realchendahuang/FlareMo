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
import { HEADER_SEARCH_FIELD_CLASS } from "@/components/search-field-styles";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import { formatMemoRelativeTime, memoExcerpt } from "@/lib/memo";
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
  const { locale, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(query);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Local filtering answers every keystroke; the network probe is debounced
  // and paused while an IME composition is in flight, so typing Chinese does
  // not fire one request per candidate character.
  const [debouncedDraft, setDebouncedDraft] = useState("");
  const [composing, setComposing] = useState(false);

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

  useEffect(() => {
    if (!open || composing) return undefined;
    const timer = setTimeout(() => setDebouncedDraft(trimmedDraft), 250);
    return () => clearTimeout(timer);
  }, [composing, open, trimmedDraft]);

  // Instant global search probe across the entire corpus
  const remoteMemosQuery = useQuery({
    queryKey: ["spotlight-remote-memos", debouncedDraft],
    queryFn: ({ signal }) =>
      listMemos({ q: debouncedDraft, page_size: 6 }, signal),
    enabled: open && debouncedDraft.length >= 1,
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
    // Do not show the previous query's remote page while the current draft is
    // still inside its debounce window; the local cache covers that gap.
    if (debouncedDraft === trimmedDraft && remoteMemosQuery.data?.memos) {
      return remoteMemosQuery.data.memos.slice(0, 6);
    }
    const q = trimmedDraft.toLowerCase();
    return memos
      .filter((memo) => memo.content.toLowerCase().includes(q))
      .slice(0, 5);
  }, [debouncedDraft, trimmedDraft, remoteMemosQuery.data, memos]);

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
        // Plain prose, not raw markdown: `- [ ]`, `**` and fences read as
        // noise on one truncated line.
        const preview =
          memoExcerpt(memo.content, 70) ||
          memo.content.replace(/\s+/g, " ").slice(0, 70);
        const time = memo.display_time ?? memo.create_time;
        items.push({
          id: `memo-${memo.id}`,
          type: "memo",
          title: preview,
          // The local day, like the timeline: an ISO slice is the UTC date
          // and named the wrong day for a late-evening note east of UTC.
          subtitle: time ? formatMemoRelativeTime(time, locale) : undefined,
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
    locale,
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
        // gap-0: the dialog's own gap-4 stacked 16px of dead air above and
        // below the result list.
        className="top-[12%] w-full max-w-[min(32rem,calc(100%-1.5rem))] translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 sm:top-[18%] sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{t("common.search")}</DialogTitle>

        {/* Search Input Bar */}
        <div className="border-b border-border/60 p-2.5">
          {/* The palette itself is the field: InputGroup's focus ring is
              keyed on `has-[control:focus-visible]`, so it has to be zeroed
              under that same variant or a pink box draws inside the dialog. */}
          <InputGroup className="h-11 border-none bg-transparent shadow-none ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-transparent">
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
              onCompositionEnd={() => setComposing(false)}
              onCompositionStart={() => setComposing(true)}
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
        <div className="max-h-[min(380px,50vh)] overflow-y-auto p-1.5">
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
                      "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-100",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground",
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-100",
                        isSelected
                          ? "bg-card text-foreground shadow-xs ring-1 ring-border/70 dark:bg-muted"
                          : "bg-muted/70 text-muted-foreground",
                      )}
                    >
                      <Icon className="size-3.5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm leading-snug">
                        {item.title}
                      </p>
                      {item.subtitle && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.subtitle}
                        </p>
                      )}
                    </div>

                    {item.type === "action" && (
                      <ArrowRightIcon
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground/60 transition-opacity duration-100",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
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
        <div className="flex items-center justify-between border-t border-border/50 px-3.5 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑↓</Kbd>
              {t("search.navigateHint")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              {t("search.selectHint")}
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>esc</Kbd>
            {t("common.cancel")}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one way into search, everywhere: a field-shaped button on wide
 * screens, an icon button on narrow ones. Both open the same palette; an
 * applied query shows in the field (with its own clear control) and as a
 * dot on the icon, so the timeline never looks unfiltered while it is.
 */
export function SpotlightSearchTrigger({
  onClick,
  activeQuery,
  onClear,
  className,
  compact = false,
}: {
  onClick: () => void;
  activeQuery?: string;
  onClear?: () => void;
  className?: string;
  /** Icon-only trigger for the mobile top bar. */
  compact?: boolean;
}) {
  const { t } = useI18n();

  if (compact) {
    return (
      <Button
        aria-label={t("search.triggerPlaceholder")}
        className={cn("relative text-muted-foreground", className)}
        size="icon"
        title={t("search.triggerPlaceholder")}
        type="button"
        variant="ghost"
        onClick={onClick}
      >
        <SearchIcon className="size-[18px]" />
        {activeQuery ? (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary ring-2 ring-background"
          />
        ) : null}
      </Button>
    );
  }

  return (
    <div
      className={cn(
        HEADER_SEARCH_FIELD_CLASS,
        "w-[220px] sm:w-[260px]",
        className,
      )}
    >
      <button
        aria-label={t("search.triggerPlaceholder")}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 ps-2.5 pe-2 text-start outline-none"
        type="button"
        onClick={onClick}
      >
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
        {activeQuery ? (
          <span className="min-w-0 truncate font-medium text-foreground">
            {activeQuery}
          </span>
        ) : (
          <span className="min-w-0 truncate text-muted-foreground">
            {t("search.triggerPlaceholder")}
          </span>
        )}
      </button>
      {activeQuery && onClear ? (
        <button
          aria-label={t("search.clear")}
          className="me-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/25"
          title={t("search.clear")}
          type="button"
          onClick={onClear}
        >
          <XIcon className="size-3.5" />
        </button>
      ) : (
        <Kbd className="pointer-events-none me-1.5 hidden sm:inline-flex">
          ⌘K
        </Kbd>
      )}
    </div>
  );
}
