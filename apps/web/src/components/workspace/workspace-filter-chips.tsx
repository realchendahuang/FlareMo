import { CalendarIcon, XIcon } from "lucide-react";
import { InfoTip } from "@/components/info-tip";
import { useI18n } from "@/i18n";
import { formatDayTitle } from "@/lib/calendar-date";

/**
 * The active-filter chip row above the timeline: the global-search note, the
 * removable day filter, tag and untagged chips, and clear-all.
 */
export function WorkspaceFilterChips({
  activeTag,
  clearFilters,
  dayFilter,
  hasFilters,
  isSemanticSearch,
  query,
  setActiveTag,
  setQuery,
  setUntagged,
  untagged,
}: {
  activeTag?: string;
  clearFilters: () => void;
  dayFilter: string | null;
  hasFilters: boolean;
  isSemanticSearch: boolean;
  query: string;
  setActiveTag: (tag: string | undefined) => void;
  setQuery: (q: string) => void;
  setUntagged: (untagged: boolean) => void;
  untagged: boolean;
}) {
  const { locale, t } = useI18n();
  // Each chip clears itself; "clear all" only earns its place once two or
  // more filters are stacked.
  const stacked =
    [dayFilter, activeTag, untagged, query.trim() && !dayFilter].filter(Boolean)
      .length > 1;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground motion-safe:animate-rise">
      {query.trim() && !dayFilter && !isSemanticSearch && (
        <span className="flex h-7 items-center gap-1.5 rounded-md bg-muted px-2">
          {t("search.globalScope")}
          <InfoTip text={t("search.syntaxHint")} />
        </span>
      )}
      {dayFilter && (
        <button
          aria-label={t("filter.clearDate")}
          className={CHIP_CLASS}
          type="button"
          onClick={() => setQuery("")}
        >
          <CalendarIcon aria-hidden="true" className="size-3 shrink-0" />
          {formatDayTitle(dayFilter, locale)}
          <XIcon aria-hidden="true" className="size-3.5" />
        </button>
      )}
      {activeTag && (
        <button
          aria-label={t("filter.clearTag", { tag: activeTag })}
          className={CHIP_CLASS}
          type="button"
          onClick={() => setActiveTag(undefined)}
        >
          #{activeTag}
          <XIcon aria-hidden="true" className="size-3.5" />
        </button>
      )}
      {untagged && (
        <button
          aria-label={t("filter.clearUntagged")}
          className={CHIP_CLASS}
          type="button"
          onClick={() => setUntagged(false)}
        >
          {t("explorer.untagged")}
          <XIcon aria-hidden="true" className="size-3.5" />
        </button>
      )}
      {hasFilters && stacked && (
        <button
          className="h-7 rounded-md px-2 motion-safe:transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          type="button"
          onClick={clearFilters}
        >
          {t("common.clearFilters")}
        </button>
      )}
    </div>
  );
}

const CHIP_CLASS =
  "flex h-7 items-center gap-1 rounded-md bg-muted ps-2 pe-1.5 text-foreground/80 motion-safe:transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&>svg:last-child]:text-muted-foreground";
