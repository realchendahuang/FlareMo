/*
 * Ember 2 navigation row, shared by the main sidebar and in-page rails (the
 * to-do page's views and projects). Inactive rows are quiet ink; the active
 * row is a raised paper chip (card surface + hairline ring + xs shadow) with
 * the icon in ember, so "where am I" reads without washing the row in brand
 * color. Icons must be direct children for the `[&>svg]` rules to apply.
 */
export const NAV_ITEM_CLASS =
  "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-foreground/70 outline-none transition-[background-color,color,box-shadow] duration-150 hover:bg-muted/70 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground [&>svg]:transition-colors";

export const NAV_ACTIVE_CLASS =
  "!bg-card !text-foreground font-medium shadow-xs ring-1 ring-border/70 dark:!bg-muted dark:ring-border [&>svg]:!text-primary";

/** Trailing count on a navigation row: plain muted figures, no pill. */
export const NAV_COUNT_CLASS =
  "shrink-0 text-xs text-muted-foreground tabular-nums";

/*
 * Segmented switch in a page header (review's two modes, the to-do page's
 * date views): a muted track with the current segment raised as paper. Same
 * look as the sidebar's year/month/week/day switch.
 */
export const SEGMENT_TRACK_CLASS =
  "flex items-center gap-0.5 rounded-lg bg-muted p-0.5 dark:bg-muted/60";

export const SEGMENT_CLASS =
  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground outline-none transition-[color,background-color,box-shadow] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/25";

export const SEGMENT_ACTIVE_CLASS =
  "!bg-card !text-foreground shadow-xs dark:!bg-input/40";
