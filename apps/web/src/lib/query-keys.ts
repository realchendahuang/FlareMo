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
    reminders: (date: string) => ["tasks", "reminders", date] as const,
    badges: (memoIds: readonly string[]) =>
      ["tasks", "badges", ...memoIds] as const,
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
    forDay: (day: string, space = "all") =>
      ["memos-day-slots", day, space] as const,
  },
  /** Aggregate counts (counts/tags/activity) for the sidebar and heatmaps. */
  memoStats: {
    all: ["memo-stats"] as const,
    forWindow: (space: string | undefined, timeZone: string, days: number) =>
      ["memo-stats", space, timeZone, days] as const,
    forAllSpaces: (timeZone: string) =>
      ["memo-stats", timeZone, "all"] as const,
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
    summary: (date: string, tzOffset: number) =>
      ["review-today", "summary", date, tzOffset] as const,
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

  /** Projects: today/upcoming boards plus the trash view. */
  projects: {
    all: ["projects"] as const,
    trash: ["projects", "trash"] as const,
  },
  /** Article list plus one editor payload. */
  articles: {
    all: ["articles"] as const,
    detail: (articleId: string) => ["article", articleId] as const,
  },
  personalAccessTokens: ["personal-access-tokens"] as const,
  connectedApps: ["connected-apps"] as const,
  /** AI insight tasks; the detail key is per task id (polled on the memo page). */
  insights: {
    all: ["insights"] as const,
    detail: (insightId: string) => ["insights", insightId] as const,
  },
  authBootstrapStatus: ["auth-bootstrap-status"] as const,
  authRegistrationStatus: ["auth-registration-status"] as const,
  authProviders: ["auth-providers"] as const,
  notifications: ["notifications"] as const,
  mentionableUsers: ["mentionable-users"] as const,
  adminPlugins: ["admin-plugins"] as const,
  adminPluginStore: ["admin-plugin-store"] as const,
  pluginSettings: ["plugin-settings"] as const,
  voiceSettings: ["voice-settings"] as const,
  emailSettings: ["email-settings"] as const,
  oauthSettings: ["oauth-settings"] as const,
  appInfo: ["app-info"] as const,
  latestRelease: (repository: string | null) =>
    ["latest-release", repository] as const,
  pushConfig: ["push-config"] as const,
  cloudflareUsage: ["cloudflare-usage"] as const,
  dataTasks: ["data-tasks"] as const,
  vectorUsage: ["vector-usage"] as const,
  /** Per-memo context / relation payloads shared by the card and detail page. */
  memoContext: {
    all: ["memo-context"] as const,
    forMemo: (memoId: string) => ["memo-context", memoId] as const,
  },
  memoRelated: {
    all: ["memo-related"] as const,
    forMemo: (memoId: string) => ["memo-related", memoId] as const,
  },
  relationCandidates: (query: string) =>
    ["relation-candidates", query] as const,
  semanticSearch: {
    all: ["semantic-search"] as const,
    forQuery: (space: string | undefined, query: string) =>
      ["semantic-search", space, query] as const,
  },
  spotlightRemoteMemos: (query: string) =>
    ["spotlight-remote-memos", query] as const,
  /** Share-card payload keyed by plugin, version and selected card. */
  pluginCardPayload: (
    pluginId: string,
    pluginVersion: string,
    cardId: string,
  ) => ["plugin-card-payload", pluginId, pluginVersion, cardId] as const,
  composerWikiSuggestions: (query: string | undefined) =>
    ["composer-wiki-suggestions", query] as const,
  publicShare: (token: string) => ["public-share", token] as const,
  /** Hourly activity series for the time horizon's day/month/week tabs. */
  statsHourly: {
    allDay: ["stats-hourly-day"] as const,
    allMonth: ["stats-hourly-month"] as const,
    allWeek: ["stats-hourly-week"] as const,
    day: (day: string, tz: number, space = "all") =>
      ["stats-hourly-day", day, tz, space] as const,
    month: (from: string, to: string, tz: number, space = "all") =>
      ["stats-hourly-month", from, to, tz, space] as const,
    week: (from: string, to: string, tz: number, space = "all") =>
      ["stats-hourly-week", from, to, tz, space] as const,
  },
} as const;
