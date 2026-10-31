/**
 * Centralized TanStack Query cache keys for the web app.
 *
 * Every `queryKey` literal used across `apps/web/src` must come from this
 * module: these keys are the invalidation anchors of the query cache, and a
 * typo in a hand-written literal silently breaks invalidation. Key string
 * values here are frozen — do not rename them.
 */
export const queryKeys = {
  /** Task lists. Bare form = "all"; second element = project id or "trash". */
  tasks: {
    all: ["tasks"] as const,
    byProject: (projectId: string) => ["tasks", projectId] as const,
    trash: () => ["tasks", "trash"] as const,
  },
  /**
   * Timeline pages. The leading "memos" segment is the invalidation anchor:
   * every filter combination and page hangs off it, so
   * `invalidateQueries({ queryKey: queryKeys.memos.all })` after a write
   * refreshes all of them.
   */
  memos: {
    all: ["memos"] as const,
    list: (
      space: string | undefined,
      view: string,
      searchQuery: string,
      activeTag: string | undefined,
      untagged: boolean,
    ) => ["memos", space, view, searchQuery, activeTag, untagged] as const,
  },
  /** Day-slot payload for the time horizon's selected day. */
  memosDaySlots: {
    all: ["memos-day-slots"] as const,
    forDay: (day: string) => ["memos-day-slots", day] as const,
  },
  /** Aggregate counts (counts/tags/activity) for the sidebar and heatmaps. */
  memoStats: {
    all: ["memo-stats"] as const,
    forWindow: (space: string | undefined, timeZone: string, days: number) =>
      ["memo-stats", space, timeZone, days] as const,
  },
  /** Year-scoped stats for the year view (issue #144). */
  memoStatsYear: {
    all: ["memo-stats-year"] as const,
    forYear: (space: string | undefined, timeZone: string, year: number) =>
      ["memo-stats-year", space, timeZone, year] as const,
  },
  tagHierarchy: {
    all: ["tag-hierarchy"] as const,
    forSpace: (space: string | undefined) => ["tag-hierarchy", space] as const,
  },
  /** Today's review stack (page + home banner) and its reader settings. */
  review: {
    all: ["review-today"] as const,
    today: (date: string, tzOffset: number) =>
      ["review-today", date, tzOffset] as const,
    settings: ["review-settings"] as const,
  },
  currentUser: ["current-flaremo-user"] as const,
  adminUsers: ["admin-users"] as const,
  adminBranding: ["admin-branding"] as const,
  /**
   * Capture pipeline status, scoped per user id — `""` while the viewer row
   * is still loading, which the query keeps disabled. `all` is the bare key,
   * so invalidating it hits every per-user entry.
   */
  captureStatus: {
    all: ["capture-status"] as const,
    forUser: (userId: string | undefined) =>
      ["capture-status", userId ?? ""] as const,
  },
} as const;
