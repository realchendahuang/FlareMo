import type {
  DailyReviewResponse,
  DeleteTagResponse,
  HourlyActivityResponse,
  ListMemosResponse,
  MemoDto,
  MemoStatsResponse,
  RandomMemoResponse,
  RelatedMemosResponse,
  RenameTagResponse,
  ReviewMarkInput,
  ReviewSettingsResponse,
  ReviewSettingsUpdate,
  TagHierarchyResponse,
  TodayReviewResponse,
  WalkNextResponse,
} from "@flaremo/contracts";
import { apiRequest } from "./client";
import type {
  CloudflareUsageReport,
  CreateMemoRequest,
  ListMemoParams,
  Memo,
  MemoContext,
  MemoSpace,
  UpdateMemoRequest,
  VectorUsageReport,
} from "./types";

export async function listMemos(
  params: ListMemoParams = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  query.set("page_size", String(params.page_size ?? 30));
  query.set("order_by", "created_at desc");
  if (params.state) query.set("state", params.state);
  if (params.q) query.set("q", params.q);
  if (params.tag) query.set("tag", params.tag);
  if (params.untagged) query.set("untagged", "true");
  if (params.include_deleted) query.set("include_deleted", "true");
  if (params.page_token) query.set("page_token", params.page_token);
  if (params.space && params.space !== "all") query.set("space", params.space);

  return apiRequest<ListMemosResponse>(`/api/app/memos?${query.toString()}`, {
    signal,
  });
}

export async function semanticSearchMemos(
  query: string,
  limit = 10,
  signal?: AbortSignal,
  space?: Exclude<MemoSpace, "all">,
) {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(limit));
  if (space) params.set("space", space);
  return apiRequest<{ memos: MemoDto[]; degraded: boolean }>(
    `/api/app/search/semantic?${params.toString()}`,
    { signal },
  );
}

export async function getVectorUsage() {
  return apiRequest<VectorUsageReport>("/api/app/usage/vector");
}

export async function getCloudflareUsage() {
  return apiRequest<CloudflareUsageReport>("/api/app/usage/cloudflare");
}

export async function getTagHierarchy(space?: MemoSpace) {
  const query = new URLSearchParams();
  if (space && space !== "all") query.set("space", space);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return apiRequest<TagHierarchyResponse>(`/api/app/tags${suffix}`);
}

export async function renameTag(input: { from: string; to: string }) {
  return apiRequest<RenameTagResponse>("/api/app/tags", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteTag(tag: string) {
  return apiRequest<DeleteTagResponse>(
    `/api/app/tags?tag=${encodeURIComponent(tag)}`,
    { method: "DELETE" },
  );
}

// Stats always carry the space: the response's counts.spaces powers the
// sidebar badges for all three entries from this single request.
export async function getMemoStats(
  timeZone: string,
  space?: MemoSpace,
  days?: number,
  until?: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ time_zone: timeZone });
  if (space && space !== "all") query.set("space", space);
  // The heatmap's year view needs a full year of buckets. The endpoint used to
  // hardcode an 84-day window, which left every cell outside it permanently
  // zero; asking for the span the largest view actually renders is what makes
  // the year grid meaningful. `counts` and `active_days` do not depend on the
  // window, so a wider activity array costs the sidebar nothing.
  if (days !== undefined) query.set("days", String(days));
  // `until` anchors the window's end: the year view passes the navigated
  // year's Dec 31 so a historical year reaches its own cells (issue #144).
  if (until !== undefined) query.set("until", until);
  return apiRequest<MemoStatsResponse>(`/api/app/stats?${query.toString()}`, {
    signal,
  });
}

/**
 * Returns hourly memo counts for the given local date or date range.
 * `tz` should be `new Date().getTimezoneOffset()` (UTC − local in minutes).
 */
export async function getHourlyActivity(
  params: { date?: string; from?: string; to?: string },
  tz: number,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ tz: String(tz) });
  if (params.date) query.set("date", params.date);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  return apiRequest<HourlyActivityResponse>(
    `/api/app/stats/hourly?${query.toString()}`,
    { signal },
  );
}

export async function getDailyReview(date: string, tzOffsetMinutes: number) {
  const query = new URLSearchParams({
    date,
    tzOffset: String(tzOffsetMinutes),
  });
  return apiRequest<DailyReviewResponse>(
    `/api/app/review/daily?${query.toString()}`,
  );
}

/** Today's review stack: on this day in past years, then the age ladder. */
export async function getTodayReview(date: string, tzOffsetMinutes: number) {
  const query = new URLSearchParams({
    date,
    tzOffset: String(tzOffsetMinutes),
  });
  return apiRequest<TodayReviewResponse>(
    `/api/app/review/today?${query.toString()}`,
  );
}

export async function markReviewMemo(input: ReviewMarkInput) {
  return apiRequest<{ ok: true }>("/api/app/review/marks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getReviewSettings() {
  return apiRequest<ReviewSettingsResponse>("/api/app/review/settings");
}

export async function updateReviewSettings(input: ReviewSettingsUpdate) {
  return apiRequest<ReviewSettingsResponse>("/api/app/review/settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function getRandomWalkMemo(exclude: string[] = []) {
  const query = new URLSearchParams();
  if (exclude.length > 0) query.set("exclude", exclude.join(","));
  return apiRequest<RandomMemoResponse>(
    `/api/app/review/random?${query.toString()}`,
  );
}

export async function getWalkNextMemo(memoId: string, exclude: string[] = []) {
  const query = new URLSearchParams({ memoId });
  if (exclude.length > 0) query.set("exclude", exclude.join(","));
  return apiRequest<WalkNextResponse>(
    `/api/app/review/walk?${query.toString()}`,
  );
}

export async function createMemo(input: CreateMemoRequest) {
  return apiRequest<Memo>("/api/app/memos", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateMemo(id: string, input: UpdateMemoRequest) {
  return apiRequest<Memo>(`/api/app/memos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function trashMemo(id: string) {
  return apiRequest<Memo>(`/api/app/memos/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function hardDeleteMemo(id: string) {
  return apiRequest<{ ok: true }>(
    `/api/app/memos/${encodeURIComponent(id)}?hard=true`,
    { method: "DELETE" },
  );
}

export async function getMemoContext(id: string) {
  return apiRequest<MemoContext>(`/api/app/memos/${encodeURIComponent(id)}`);
}

export async function getRelatedMemos(id: string) {
  return apiRequest<RelatedMemosResponse>(
    `/api/app/memos/${encodeURIComponent(id)}/related`,
  );
}

export async function restoreMemoRevision(memo: string, revision: string) {
  return apiRequest<Memo>(
    `/api/v1/memos/${encodeURIComponent(memo)}/revisions/restore`,
    {
      method: "POST",
      body: JSON.stringify({ revision }),
    },
  );
}

export async function replaceMemoRelations(
  memo: string,
  relations: Array<{
    related_memo: string;
    type: "reference" | "comment";
  }>,
) {
  return apiRequest<{
    relations: MemoContext["relations"][number]["relation"][];
  }>(`/api/v1/memos/${encodeURIComponent(memo)}/relations`, {
    method: "PATCH",
    body: JSON.stringify({ relations }),
  });
}

/** Comments under a memo, oldest first (`id` is the bare memo id). */
export async function listMemoComments(id: string) {
  return apiRequest<{ comments: Memo[] }>(
    `/api/app/memos/${encodeURIComponent(id)}/comments`,
  );
}

/** Adds a comment; it inherits the parent memo's visibility. */
export async function createMemoComment(
  id: string,
  input: { content: string; client_id?: string },
) {
  return apiRequest<Memo>(`/api/app/memos/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** People who can be @mentioned: active team members, without emails. */
export async function listMentionableUsers() {
  return apiRequest<{
    members: { username: string; displayName: string }[];
  }>("/api/app/team/members");
}
