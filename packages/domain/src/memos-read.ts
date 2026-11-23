import {
  type ListMemosQuery,
  type MemoSpace,
  type MemoStatsQueryInput,
  type MemoStatsResponse,
  parseMemoSearchQuery,
} from "@flaremo/contracts";
import type { FlareMoDb, MemoRow } from "@flaremo/db";
import { attachments, memos, memoTags } from "@flaremo/db";
import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";
import { NotFoundError, ValidationError } from "./errors";
import { notComment } from "./memo-comment-filter";
import { compileMemoFilter } from "./memo-filter";
import {
  hourRangeForLocalWindow,
  localDateOfUtcHour,
  readHourlyCountsInRange,
  readHourlyCountTotals,
} from "./memo-hourly-counts";
import { DEFAULT_MEMO_FILTER_SCAN_LIMIT } from "./memos-helpers";
import {
  buildActivity,
  buildFtsQuery,
  createDateKeyFormatter,
  decodePageToken,
  encodePageToken,
  escapeLike,
  memoSearchScopeToState,
  toUtcDayStart,
} from "./memos-query";
import { normalizeMemoTags } from "./tags";
import {
  memoReadScope,
  scopedReadScope,
  spaceScope,
  type TeamViewer,
} from "./team-permissions";

export type MemoListResult = {
  memos: MemoRow[];
  nextPageToken?: string;
};

export async function listMemos(
  db: FlareMoDb,
  user: TeamViewer,
  query: ListMemosQuery,
  options: MemoFilterOptions = {},
): Promise<MemoListResult> {
  return listMemosForViewer(db, user, query, options);
}

/** Optional list-scanning knobs threaded from the worker's env. */
export type MemoFilterOptions = {
  /** Upper bound for candidate rows scanned for a not-fully-translatable CEL filter. */
  celScanLimit?: number;
};

/**
 * List memos using the same visibility boundary as the Memos API. An
 * anonymous viewer is intentionally restricted to normal public memos. Active
 * members receive their own rows plus normal team/public rows, while team
 * administrators may also manage non-private archived or trashed rows.
 */
export async function listMemosForViewer(
  db: FlareMoDb,
  user: TeamViewer | null,
  query: ListMemosQuery,
  options: MemoFilterOptions = {},
): Promise<MemoListResult> {
  const search = parseMemoSearchQuery(query.q);
  // Awaited: compiling a CEL expression now resolves the parser on demand,
  // so a query without `filter` never loads it at all.
  const celFilter = await compileMemoFilter(query.filter);
  const cursor = query.page_token
    ? decodePageToken(query.page_token, query.order_by)
    : undefined;
  const direction = query.order_by.endsWith(" asc") ? "asc" : "desc";
  const orderColumn = query.order_by.startsWith("updated_at")
    ? memos.updatedAt
    : memos.createdAt;
  const filters = [memoReadScope(user)];
  const spaceFilter = spaceScope(user, query.space);
  if (spaceFilter) filters.push(spaceFilter);
  if (celFilter?.sqlPredicate) filters.push(celFilter.sqlPredicate);
  // Comments live under their parent memo, never as timeline entries, the
  // same as upstream Memos (ListMemos skips rows with a COMMENT parent).
  // They are read through the comment endpoints instead.
  filters.push(notComment());

  // The established `state` query parameter wins over a search scope so that
  // Memos-compatible clients retain their existing filtering semantics.
  const searchState = query.state ?? memoSearchScopeToState(search.scope);
  if (searchState) {
    filters.push(eq(memos.status, searchState));
  } else if (query.q?.trim() && !query.include_deleted) {
    // Full-text search is intentionally broader than the timeline: archived
    // notes stay discoverable, while trashed notes remain opt-in via in:trash.
    filters.push(inArray(memos.status, ["normal", "archived"]));
  } else if (!query.include_deleted) {
    filters.push(eq(memos.status, "normal"));
  }

  if (query.visibility) {
    filters.push(eq(memos.visibility, query.visibility));
  }

  let likeScanFallback = false;
  if (search.text) {
    const ftsQuery = buildFtsQuery(search.text);
    if (ftsQuery) {
      filters.push(sql`${memos.id} IN (
        SELECT memo_id FROM memos_fts WHERE memos_fts MATCH ${ftsQuery}
      )`);
    } else {
      // Non-Latin text (CJK and friends) cannot use the unicode61 FTS index,
      // so the query falls back to a LIKE scan. It is bounded by the same
      // scan-limit window as CEL filters below instead of scanning the
      // author's whole corpus on every keystroke.
      likeScanFallback = true;
      filters.push(
        sql`${memos.content} LIKE ${`%${escapeLike(search.text)}%`} ESCAPE '\\'`,
      );
    }
  }

  if (search.hasAttachment) {
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM ${attachments}
        WHERE ${attachments.memoId} = ${memos.id}
          AND ${attachments.deletedAt} IS NULL
          AND ${attachments.state} = 'ready'
      )`,
    );
  }

  if (search.isPinned) {
    filters.push(eq(memos.pinned, true));
  }

  if (search.after) {
    filters.push(gte(memos.createdAt, toUtcDayStart(search.after)));
  }

  if (search.before) {
    filters.push(lt(memos.createdAt, toUtcDayStart(search.before)));
  }

  if (query.tag) {
    const tag = normalizeMemoTags([query.tag])[0];
    if (!tag) {
      return { memos: [] };
    }
    // Hierarchical tag filter: `工作` matches `工作` and any descendant
    // (`工作/项目A`), while `工作/项目A` matches itself and deeper children.
    // The candidate set is exact-equals plus LIKE-prefix with the separator.
    const escapedPrefix = escapeLike(`${tag}/`);
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM ${memoTags}
        WHERE ${memoTags.memoId} = ${memos.id}
          AND (
            ${memoTags.tag} = ${tag}
            OR ${memoTags.tag} LIKE ${`${escapedPrefix}%`} ESCAPE '\\'
          )
      )`,
    );
  }

  if (query.untagged) {
    filters.push(
      sql`NOT EXISTS (
        SELECT 1 FROM ${memoTags}
        WHERE ${memoTags.memoId} = ${memos.id}
      )`,
    );
  }

  if (cursor) {
    const sortFilter =
      direction === "asc"
        ? or(
            gt(orderColumn, cursor.sortValue),
            and(eq(orderColumn, cursor.sortValue), gt(memos.id, cursor.id)),
          )
        : or(
            lt(orderColumn, cursor.sortValue),
            and(eq(orderColumn, cursor.sortValue), lt(memos.id, cursor.id)),
          );
    const cursorFilter = or(
      sql`${memos.pinned} < ${cursor.pinned ? 1 : 0}`,
      and(eq(memos.pinned, cursor.pinned), sortFilter),
    );
    if (cursorFilter) filters.push(cursorFilter);
  }

  const orderedQuery = db
    .select()
    .from(memos)
    .where(and(...filters.filter(Boolean)))
    .orderBy(
      desc(memos.pinned),
      direction === "asc" ? asc(orderColumn) : desc(orderColumn),
      direction === "asc" ? asc(memos.id) : desc(memos.id),
    );
  // Never hydrate an unbounded candidate set for a user-supplied expression.
  // If the bounded window contains a complete page plus a lookahead match,
  // the existing cursor safely resumes after that page. Otherwise require a
  // narrower query rather than silently claiming that a partial scan is final.
  // A CEL filter that fully translates to SQL (checked by completeInSql) is
  // evaluated by SQLite itself and needs neither the JS scan nor the limit.
  const fullyPushedDown = celFilter?.completeInSql === true;
  const scanLimit = options.celScanLimit ?? DEFAULT_MEMO_FILTER_SCAN_LIMIT;
  const jsScan = (celFilter && !fullyPushedDown) || likeScanFallback;
  if (celFilter && !fullyPushedDown) {
    // Probe cheaply (id only) before hydrating full rows, so an abusive
    // expression costs an index-shaped scan instead of 5000 full-row reads.
    const probe = await db
      .select({ id: memos.id })
      .from(memos)
      .where(and(...filters.filter(Boolean)))
      .orderBy(
        desc(memos.pinned),
        direction === "asc" ? asc(orderColumn) : desc(orderColumn),
        direction === "asc" ? asc(memos.id) : desc(memos.id),
      )
      .limit(scanLimit + 1);
    if (probe.length > scanLimit && !likeScanFallback) {
      throw new ValidationError(
        `Filter scan limit reached (${scanLimit} memos). Narrow the query using a tag, date range, state, or visibility.`,
      );
    }
  }
  const candidates = await orderedQuery.limit(
    jsScan ? scanLimit + 1 : query.page_size + 1,
  );
  const rows =
    celFilter && !fullyPushedDown
      ? candidates.slice(0, scanLimit).filter((memo) => celFilter(memo, user))
      : candidates;
  if (candidates.length > scanLimit && rows.length <= query.page_size) {
    throw new ValidationError(
      `Search scan limit reached (${scanLimit} memos). Narrow the query using a tag, date range, state, or visibility.`,
    );
  }

  const page = rows.slice(0, query.page_size);
  const next = rows.length > query.page_size ? page.at(-1) : undefined;

  return {
    memos: page,
    nextPageToken: next
      ? encodePageToken({
          id: next.id,
          orderBy: query.order_by,
          pinned: next.pinned,
          sortValue: query.order_by.startsWith("updated_at")
            ? next.updatedAt
            : next.createdAt,
        })
      : undefined,
  };
}

/**
 * Team-wide per-user memo totals for the Memos ListAllUserStats RPC — the
 * only fields its DTO consumes. Two grouped queries replace the per-user
 * stat fan-out; users without memos are absent from the map and default to
 * zero upstream. Counting semantics mirror getMemoStats (total excludes
 * trashed).
 */
export async function listMemoTotalsByUser(db: FlareMoDb) {
  const [countRows, tagRows] = await Promise.all([
    db
      .select({
        userId: memos.userId,
        total:
          sql<number>`SUM(CASE WHEN ${memos.status} IN ('normal', 'archived') THEN 1 ELSE 0 END)`.mapWith(
            Number,
          ),
      })
      .from(memos)
      .where(notComment())
      .groupBy(memos.userId),
    db
      .select({
        userId: memos.userId,
        name: memoTags.tag,
        count: sql<number>`COUNT(*)`.mapWith(Number),
      })
      .from(memoTags)
      .innerJoin(memos, eq(memoTags.memoId, memos.id))
      .where(and(inArray(memos.status, ["normal", "archived"]), notComment()))
      .groupBy(memos.userId, memoTags.tag),
  ]);
  const totals = new Map<
    string,
    { total: number; tags: Map<string, number> }
  >();
  for (const row of countRows) {
    totals.set(row.userId, { total: row.total ?? 0, tags: new Map() });
  }
  for (const row of tagRows) {
    const entry = totals.get(row.userId);
    if (entry) entry.tags.set(row.name, row.count);
  }
  return totals;
}

/**
 * The activity window the heatmap used before `days` became a parameter, and
 * the default for any caller that does not ask for a specific span.
 */
export const DEFAULT_ACTIVITY_DAYS = 84;

/**
 * Longest window the endpoint will serve: one year, the span the heatmap's year
 * view renders. Bounding it keeps a single request from scanning the counter
 * table end to end.
 */
export const MAX_ACTIVITY_DAYS = 366;

export type MemoStatsOptions = {
  /**
   * Space partition for the workspace sidebar. Absent keeps the historical
   * own-corpus semantics the Memos-compatible clients depend on; when set,
   * every number (counts, tags, activity) obeys the same read scope plus
   * space partition as the corresponding list view.
   */
  space?: MemoSpace;
};

/** Tag counts for one author's normal + archived memos, name-ascending. */
async function readOwnCorpusTagCounts(db: FlareMoDb, userId: string) {
  return db
    .select({
      name: memoTags.tag,
      count: sql<number>`COUNT(*)`.mapWith(Number),
    })
    .from(memoTags)
    .innerJoin(memos, eq(memoTags.memoId, memos.id))
    .where(
      and(
        eq(memoTags.userId, userId),
        inArray(memos.status, ["normal", "archived"]),
        notComment(),
      ),
    )
    .groupBy(memoTags.tag)
    .orderBy(asc(memoTags.tag));
}

/**
 * Stats for the viewer's own corpus, answered from `memo_hourly_counts`.
 *
 * This is the path the web workspace and the Memos-compatible clients take, and
 * the one that used to cost ~20k rows_read per request: three full scans of
 * `memos` plus a fourth for `active_days`, on a 4.7k-memo instance. Every number
 * here is now derived from counter rows, so the cost tracks the hours the user
 * actually wrote at rather than their total memo count.
 *
 * `counts` and `active_days` are exact: the counters are per status and per UTC
 * hour, and summing them yields the same totals the live `SUM(CASE WHEN …)`
 * produced. `activity` re-buckets UTC hours into the caller's time zone — see
 * {@link localDateOfUtcHour} for the one boundary case that is approximate.
 *
 * `tags` still reads `memo_tags` live. That is the one number here without a
 * counter: per-tag all-time counts are a different shape from a date-bucketed
 * one, and a second maintenance path (create, edit, rename, delete, import) is
 * not worth the drift surface for the smaller share of the cost.
 */
async function getOwnCorpusMemoStats(
  db: FlareMoDb,
  user: TeamViewer,
  input: {
    formatLocalDate: (date: Date) => string;
    anchorKey: string;
    days: number;
  },
): Promise<MemoStatsResponse> {
  const { formatLocalDate, anchorKey, days } = input;
  const wantedDates = new Set(
    buildActivity(anchorKey, new Map(), days).map((day) => day.date),
  );
  const { fromHour, toHour } = hourRangeForLocalWindow(anchorKey, days);
  const [totals, hourRows, tagRows] = await Promise.all([
    readHourlyCountTotals(db, user.id),
    readHourlyCountsInRange(db, user.id, fromHour, toHour),
    readOwnCorpusTagCounts(db, user.id),
  ]);
  const localCounts = new Map<string, number>();
  for (const row of hourRows) {
    const key = localDateOfUtcHour(row.utcHour, formatLocalDate);
    if (!wantedDates.has(key)) continue;
    localCounts.set(
      key,
      (localCounts.get(key) ?? 0) + row.normal + row.archived,
    );
  }
  return {
    counts: {
      normal: totals.normal,
      archived: totals.archived,
      trashed: totals.trashed,
      total: totals.normal + totals.archived,
    },
    active_days: totals.activeDays,
    tags: tagRows,
    activity: buildActivity(anchorKey, localCounts, days),
  };
}

export async function getMemoStats(
  db: FlareMoDb,
  user: TeamViewer,
  query: MemoStatsQueryInput,
  options: MemoStatsOptions = {},
): Promise<MemoStatsResponse> {
  const dateKeyFormatter = createDateKeyFormatter(query.time_zone ?? "UTC");
  // The activity window ends on the client-supplied anchor when present (the
  // year view requests the navigated year's Dec 31 so historical years render
  // their own cells, issue #144); otherwise today. `counts` and `active_days`
  // are all-time and deliberately unaffected by the anchor.
  const anchorKey = query.until ?? dateKeyFormatter(new Date());
  // Clamped again here because the schema is not the only caller. The
  // `Number.isFinite` guard matters: a NaN would survive Math.min/Math.max
  // (both propagate it) and then blow up inside `toISOString()` on an Invalid
  // Date, turning a bad argument into a 500 instead of a wrong-but-served
  // window.
  const requestedDays = query.days ?? DEFAULT_ACTIVITY_DAYS;
  const days = Number.isFinite(requestedDays)
    ? Math.min(MAX_ACTIVITY_DAYS, Math.max(1, Math.trunc(requestedDays)))
    : DEFAULT_ACTIVITY_DAYS;

  // The counter only describes the viewer's own memos. A space-partitioned
  // query widens the corpus to team and public memos authored by other people,
  // which no per-author counter can reproduce, so those keep the live queries.
  if (!options.space) {
    return getOwnCorpusMemoStats(db, user, {
      formatLocalDate: dateKeyFormatter,
      anchorKey,
      days,
    });
  }

  // Comments sit under their parent and are not records of their own.
  const corpus = and(scopedReadScope(user, options.space), notComment());
  const normalOrArchived = inArray(memos.status, ["normal", "archived"]);
  // A local-day window can start up to 15 hours before its first UTC day, so
  // the raw-row cutoff is padded to match `hourRangeForLocalWindow` (+1 day
  // covers that pad). Anchored at the window's end day, not at now, so a
  // historical anchor reaches back into its own year.
  const anchorUtcStart = new Date(`${anchorKey}T00:00:00Z`).getTime();
  const recentCutoff = new Date(
    (Number.isNaN(anchorUtcStart) ? Date.now() : anchorUtcStart) -
      (days + 1) * 24 * 60 * 60 * 1000,
  );

  const [countRow, tagRows, activeDayRows, recentRows, spaceCountRows] =
    await Promise.all([
      db
        .select({
          normal:
            sql<number>`SUM(CASE WHEN ${memos.status} = 'normal' THEN 1 ELSE 0 END)`.mapWith(
              Number,
            ),
          archived:
            sql<number>`SUM(CASE WHEN ${memos.status} = 'archived' THEN 1 ELSE 0 END)`.mapWith(
              Number,
            ),
          trashed:
            sql<number>`SUM(CASE WHEN ${memos.status} = 'trashed' THEN 1 ELSE 0 END)`.mapWith(
              Number,
            ),
          total:
            sql<number>`SUM(CASE WHEN ${memos.status} IN ('normal', 'archived') THEN 1 ELSE 0 END)`.mapWith(
              Number,
            ),
        })
        .from(memos)
        .where(corpus)
        .get(),
      db
        .select({
          name: memoTags.tag,
          count: sql<number>`COUNT(*)`.mapWith(Number),
        })
        .from(memoTags)
        .innerJoin(memos, eq(memoTags.memoId, memos.id))
        .where(and(corpus, normalOrArchived))
        .groupBy(memoTags.tag)
        .orderBy(asc(memoTags.tag)),
      db
        .select({ day: sql<string>`substr(${memos.createdAt}, 1, 10)` })
        .from(memos)
        .where(and(corpus, normalOrArchived))
        .groupBy(sql`substr(${memos.createdAt}, 1, 10)`),
      db
        .select({ createdAt: memos.createdAt })
        .from(memos)
        .where(
          and(
            corpus,
            normalOrArchived,
            gte(memos.createdAt, recentCutoff.toISOString()),
          ),
        ),
      // Sidebar badges for the two spaces, computed under the same read
      // boundary as the mixed timeline.
      Promise.all([
        db
          .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
          .from(memos)
          .where(
            and(
              scopedReadScope(user, "personal"),
              eq(memos.status, "normal"),
              notComment(),
            ),
          ),
        db
          .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
          .from(memos)
          .where(
            and(
              scopedReadScope(user, "team"),
              eq(memos.status, "normal"),
              notComment(),
            ),
          ),
      ]),
    ]);

  const activityCounts = new Map<string, number>();
  for (const row of recentRows) {
    const date = new Date(row.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = dateKeyFormatter(date);
    activityCounts.set(key, (activityCounts.get(key) ?? 0) + 1);
  }

  const [personalCountRows, teamCountRows] = spaceCountRows;
  return {
    counts: {
      normal: countRow?.normal ?? 0,
      archived: countRow?.archived ?? 0,
      trashed: countRow?.trashed ?? 0,
      total: countRow?.total ?? 0,
      spaces: {
        personal: personalCountRows[0]?.count ?? 0,
        team: teamCountRows[0]?.count ?? 0,
      },
    },
    active_days: activeDayRows.length,
    tags: tagRows,
    activity: buildActivity(anchorKey, activityCounts, days),
  };
}

export async function getMemoById(
  db: FlareMoDb,
  user: TeamViewer,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<MemoRow> {
  return getMemoByIdForViewer(db, user, id, options);
}

/**
 * Resolve a memo for a read-only viewer without ever substituting the owner
 * user for an anonymous request. This prevents a public request from
 * inheriting the owner's private timeline by accident.
 */
export async function getMemoByIdForViewer(
  db: FlareMoDb,
  user: TeamViewer | null,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<MemoRow> {
  const filters = [eq(memos.id, id), memoReadScope(user)];
  if (!options.includeDeleted) {
    filters.push(inArray(memos.status, ["normal", "archived", "trashed"]));
  }

  const row = await db
    .select()
    .from(memos)
    .where(and(...filters.filter(Boolean)))
    .get();

  if (!row) {
    throw new NotFoundError("Memo not found");
  }

  return row;
}

/**
 * Batched sibling of {@link getMemoByIdForViewer}: resolve many memo ids under
 * the same read scope in one query. Callers that previously looped the
 * single-id helper can now hydrate relations and related memos from a map; a
 * missing key means exactly what the single-id helper's NotFoundError meant.
 */
export async function getMemosByIdsForViewer(
  db: FlareMoDb,
  user: TeamViewer | null,
  ids: string[],
  options: { includeDeleted?: boolean } = {},
): Promise<Map<string, MemoRow>> {
  if (ids.length === 0) return new Map();
  // Callers feed whole pages into this helper (comment lists and Connect list
  // RPCs allow up to 1000 ids), so the chunking has to live here rather than at
  // each call site. `memoReadScope` adds its own bindings on top.
  const result = new Map<string, MemoRow>();
  for (const idChunk of chunkForD1(ids, d1IdsPerStatement())) {
    const filters = [inArray(memos.id, idChunk), memoReadScope(user)];
    if (!options.includeDeleted) {
      filters.push(inArray(memos.status, ["normal", "archived", "trashed"]));
    }
    const rows = await db
      .select()
      .from(memos)
      .where(and(...filters.filter(Boolean)));
    for (const row of rows) result.set(row.id, row);
  }
  return result;
}

export async function getMemoByClientId(
  db: FlareMoDb,
  userId: string,
  clientId: string,
): Promise<MemoRow | undefined> {
  return db
    .select()
    .from(memos)
    .where(and(eq(memos.userId, userId), eq(memos.clientId, clientId)))
    .get();
}
