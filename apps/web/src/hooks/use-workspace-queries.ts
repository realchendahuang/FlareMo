import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  getCaptureStatus,
  getCurrentFlareMoUser,
  getMemoStats,
  getTagHierarchy,
  getTodayReview,
  getVectorUsage,
  listMemos,
  type MemoSpace,
  type MemoStatsResponse,
  semanticSearchMemos,
  type Task,
} from "@/api";
import type { ExplorerView as ViewMode } from "@/components/flaremo-explorer";
import { todayKey } from "@/lib/calendar-date";
import { viewToMemoState } from "@/lib/memo-cache";
import { queryKeys } from "@/lib/query-keys";
import { useAllTasks } from "@/lib/task-views";
import { ACTIVITY_WINDOW_DAYS } from "@/lib/time-horizon";

const PAGE_SIZE = 30;
const EMPTY_STATS: MemoStatsResponse = {
  counts: { normal: 0, archived: 0, trashed: 0, total: 0 },
  active_days: 0,
  tags: [],
  activity: [],
};

type WorkspaceQueryFilters = {
  /** Space partition the timeline is scoped to. */
  space: MemoSpace;
  /** Which of the all / archived / trashed timelines is showing. */
  view: ViewMode;
  activeTag?: string;
  /** True when the timeline is filtered down to untagged memos. */
  untagged: boolean;
  /** Trimmed search box contents; empty when nothing is typed. */
  searchQuery: string;
  /** Whether searchQuery is non-empty. */
  isSearching: boolean;
  /** The query when it is exactly one local day; see dayFilterFromQuery. */
  dayFilter: string | null;
  timeZone: string;
};

/**
 * Every server read behind the workspace — memo timeline and stats, tag
 * hierarchy, the signed-in member and their capture seat, semantic/keyword
 * search, and the "on this day" teaser — plus the derived lists and flags the
 * render tree consumes.
 */
export function useWorkspaceQueries({
  space,
  view,
  activeTag,
  untagged,
  searchQuery,
  isSearching,
  dayFilter,
  timeZone,
}: WorkspaceQueryFilters) {
  const [semanticMode, setSemanticMode] = useState(false);

  const vectorUsageQuery = useQuery({
    queryKey: ["vector-usage"],
    queryFn: () => getVectorUsage(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  // Semantic search is hidden when the plan has no budget for it (quota 0)
  // or the capability itself is disabled server-side.
  const semanticEnabled = useMemo(() => {
    const plan = vectorUsageQuery.data?.plan;
    if (!plan) return false;
    const limit =
      plan.user?.limits.semanticSearchQueriesPerMonth ??
      plan.limits.semanticSearchQueriesPerMonth;
    return typeof limit === "number" && limit > 0;
  }, [vectorUsageQuery.data]);

  const isSemanticSearch =
    semanticMode && semanticEnabled && isSearching && !dayFilter;
  const toggleSemantic = useCallback(
    () => setSemanticMode((value) => !value),
    [],
  );
  const semanticResultsQuery = useQuery({
    queryKey: ["semantic-search", space, searchQuery],
    enabled: isSemanticSearch,
    queryFn: ({ signal }) =>
      semanticSearchMemos(
        searchQuery,
        20,
        signal,
        space === "all" ? undefined : space,
      ),
    retry: false,
  });
  const semanticMemos = useMemo(
    () => semanticResultsQuery.data?.memos ?? [],
    [semanticResultsQuery.data],
  );

  // Plain keyword search rides the memos endpoint; tasks join the results
  // client-side from the shared ["tasks"] cache (title/notes substring match).
  const keywordSearch = isSearching && !dayFilter && !isSemanticSearch;
  const taskSearchQuery = useAllTasks({ enabled: keywordSearch });
  const matchingTasks = useMemo(() => {
    if (!keywordSearch) return [] as Task[];
    const needle = searchQuery.toLocaleLowerCase();
    return (taskSearchQuery.data?.tasks ?? [])
      .filter(
        (task) =>
          task.title.toLocaleLowerCase().includes(needle) ||
          (task.notes?.toLocaleLowerCase().includes(needle) ?? false),
      )
      .slice(0, 5);
  }, [keywordSearch, taskSearchQuery.data, searchQuery]);

  const memosQuery = useInfiniteQuery({
    queryKey: queryKeys.memos.list(
      space,
      view,
      searchQuery,
      activeTag,
      untagged,
    ),
    initialPageParam: undefined as string | undefined,
    enabled: !isSemanticSearch,
    queryFn: ({ pageParam, signal }) =>
      listMemos(
        {
          include_deleted: !isSearching && view === "trashed",
          page_size: PAGE_SIZE,
          page_token: pageParam,
          q: searchQuery || undefined,
          state: isSearching ? undefined : viewToMemoState(view),
          tag: activeTag,
          untagged,
          space: space === "all" ? undefined : space,
        },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.next_page_token,
    retry: false,
  });
  const statsQuery = useQuery({
    // `days` belongs in the key: the year view needs a 366-day activity array
    // and the default 84-day one renders a whole year of zeroes. Both this
    // query and the layout's sidebar query share the key on purpose so the page
    // makes one request; the layout asks for the same window.
    queryKey: queryKeys.memoStats.forWindow(
      space,
      timeZone,
      ACTIVITY_WINDOW_DAYS,
    ),
    queryFn: () => getMemoStats(timeZone, space, ACTIVITY_WINDOW_DAYS),
    retry: false,
  });
  const tagHierarchyQuery = useQuery({
    queryKey: queryKeys.tagHierarchy.forSpace(space),
    queryFn: () => getTagHierarchy(space),
    retry: false,
  });
  const currentUserQuery = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentFlareMoUser,
    staleTime: 60_000,
    retry: false,
  });
  const captureStatusQuery = useQuery({
    // Gated on a known user: with `?? ""` the query fired once for the empty
    // key and again for the real id, so every cold start paid two requests for
    // the same status. The explorer reads through this same key, so both
    // components share one cache entry.
    queryKey: queryKeys.captureStatus.forUser(currentUserQuery.data?.id),
    queryFn: getCaptureStatus,
    enabled: Boolean(currentUserQuery.data?.id),
    staleTime: 30_000,
    retry: false,
  });
  // Readers (time-boxed read-only seats) browse the team space but never
  // publish into it; their composer target stays personal everywhere.
  const isReader = currentUserQuery.data?.role === "reader";
  // A team the viewer is alone in is not a second space: the personal/team
  // split (scope menu, composer visibility) only appears once someone else
  // holds a seat. Older servers omit member_count; keep showing it then.
  const rawTeam = currentUserQuery.data?.team ?? null;
  const sharedTeam =
    rawTeam && (rawTeam.member_count ?? 2) > 1 ? rawTeam : null;
  const canPublishTeam = Boolean(sharedTeam) && !isReader;
  const teamExpired = Boolean(currentUserQuery.data?.team_expired);
  // "On this day" teaser for the timeline top: notes from past years dated
  // today. The query shares the daily-review page's cache entry, so landing
  // on the banner costs nothing extra.
  const [today, tzOffset] = useMemo(
    () => [todayKey(), -new Date().getTimezoneOffset()],
    [],
  );
  // Gate the fetch on the same filters that gate the banner: a filtered
  // timeline never renders it, so the request would be pure waste.
  const onThisDayEnabled =
    view === "all" &&
    !dayFilter &&
    !searchQuery &&
    !activeTag &&
    !untagged &&
    !isSemanticSearch;
  // The banner counts what is left of today's review stack, so it goes away
  // once the stack is read (on any device).
  const onThisDayQuery = useQuery({
    queryKey: queryKeys.review.today(today, tzOffset),
    enabled: onThisDayEnabled,
    queryFn: () => getTodayReview(today, tzOffset),
    staleTime: 60_000,
    retry: false,
  });
  const reviewRemaining =
    onThisDayQuery.data?.items.filter((item) => !item.reviewed).length ?? 0;
  const showOnThisDayBanner = onThisDayEnabled && reviewRemaining > 0;

  const memos = useMemo(
    () => memosQuery.data?.pages.flatMap((page) => page.memos) ?? [],
    [memosQuery.data],
  );
  const displayedMemos = isSemanticSearch ? semanticMemos : memos;
  const attachmentsByMemo = useMemo(
    () =>
      new Map(
        displayedMemos.map(
          (memo) => [memo.name, memo.attachments ?? []] as const,
        ),
      ),
    [displayedMemos],
  );
  const stats = statsQuery.data ?? EMPTY_STATS;

  return {
    attachmentsByMemo,
    canPublishTeam,
    sharedTeam,
    captureStatusQuery,
    currentUserQuery,
    displayedMemos,
    isReader,
    isSemanticSearch,
    keywordSearch,
    matchingTasks,
    memosQuery,
    onThisDayQuery,
    reviewRemaining,
    semanticEnabled,
    semanticMode,
    semanticResultsQuery,
    showOnThisDayBanner,
    stats,
    tagHierarchyQuery,
    taskSearchQuery,
    teamExpired,
    toggleSemantic,
    vectorUsageQuery,
  };
}
