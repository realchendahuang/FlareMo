/**
 * Maintenance and reads for `memo_hourly_counts`, the derived per-author
 * activity counter that keeps the stats endpoint off a `memos` scan.
 *
 * The counter is bucketed on the UTC hour of `created_at`. The caller's IANA
 * time zone is applied here at read time, which is the whole point: a UTC day
 * straddles two local days, so day buckets could only be re-bucketed
 * approximately, and `currentStreak` walks the activity array and breaks on the
 * first zero — an off-by-one-day boundary silently breaks a streak.
 *
 * Every counter answers "memos authored by this user, created in this UTC hour,
 * currently in this status". A status transition therefore moves one unit
 * between columns and never touches the hour bucket.
 *
 * Nothing here is authoritative. `memos` is; `recalibrateAllHourlyCounts`
 * rebuilds this table from it so a missed write self-heals within a day.
 */
import { type FlareMoDb, memoHourlyCounts, memos } from "@flaremo/db";
import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { notComment } from "./memo-comment-filter";

/**
 * Rows per bulk-insert statement in the recalibration.
 *
 * D1 allows at most 100 bound parameters per query and each row binds six
 * (user_id, utc_hour, three counters, updated_at), so 16 is the largest chunk
 * that fits. A larger value makes the whole recalibration throw as soon as a
 * user has more than 16 active UTC hours — which every instance with any
 * history reaches — and since the throw precedes the sweep below it, drift
 * would then never be repaired at all.
 */
const UPSERT_CHUNK_ROWS = 16;

/** Statuses that a counter column exists for. `deleted` is deliberately absent. */
export type MemoCountKey = "normal" | "archived" | "trashed";

export type HourlyCountAdjustment = {
  userId: string;
  utcHour: string;
  deltas: Record<MemoCountKey, number>;
};

/**
 * `substr(created_at, 1, 13)` — "2026-01-31T09".
 *
 * Imported bundles can carry any `create_time` a client liked, so this
 * normalizes through `Date` instead of slicing: a value we cannot parse yields
 * `null` and the caller skips the adjustment rather than writing a bucket that
 * the recalibration would have to clean up. Unparseable rows are exactly the
 * ones the daily rebuild reads straight from `memos` anyway.
 */
export function utcHourOf(createdAt: string): string | null {
  const parsed = new Date(createdAt);
  const time = parsed.getTime();
  if (Number.isNaN(time)) return null;
  return parsed.toISOString().slice(0, 13);
}

function countKeyForStatus(
  status: MemoCountKey | "deleted",
): MemoCountKey | null {
  // `deleted` is a soft terminal state that no counter column represents: the
  // live counts query excludes it too (see getMemoStats), so a memo entering it
  // simply stops being counted.
  return status === "deleted" ? null : status;
}

function emptyDeltas(): Record<MemoCountKey, number> {
  return { normal: 0, archived: 0, trashed: 0 };
}

function addTo(
  target: Map<string, HourlyCountAdjustment>,
  userId: string,
  utcHour: string,
  key: MemoCountKey,
  amount: number,
) {
  if (amount === 0) return;
  const id = `${userId}\u0000${utcHour}`;
  let row = target.get(id);
  if (!row) {
    row = { userId, utcHour, deltas: emptyDeltas() };
    target.set(id, row);
  }
  row.deltas[key] += amount;
}

/**
 * The adjustment for a memo that did not exist before: its creation adds one
 * unit to the column matching its status.
 */
export function adjustmentForNewMemo(memo: {
  userId: string;
  createdAt: string;
  status: string;
}): HourlyCountAdjustment[] {
  const key = countKeyForStatus(memo.status as MemoCountKey);
  const utcHour = utcHourOf(memo.createdAt);
  if (!key || !utcHour) return [];
  const map = new Map<string, HourlyCountAdjustment>();
  addTo(map, memo.userId, utcHour, key, 1);
  return [...map.values()];
}

/**
 * The adjustment for a memo that already existed, given the row before and
 * after the write.
 *
 * Three things can move: the status (one column loses a unit, another gains
 * one), the author (a reassignment debits the old author and credits the new),
 * and `created_at` (import overwrite / revision restore moves the unit between
 * hour buckets). Treating them independently is what keeps this correct when
 * two of them change at once.
 */
export function adjustmentForMemoTransition(
  before: { userId: string; createdAt: string; status: string },
  after: { userId: string; createdAt: string; status: string },
): HourlyCountAdjustment[] {
  const fromKey = countKeyForStatus(before.status as MemoCountKey);
  const toKey = countKeyForStatus(after.status as MemoCountKey);
  const fromHour = utcHourOf(before.createdAt);
  const toHour = utcHourOf(after.createdAt);
  if (!fromHour) return [];
  const map = new Map<string, HourlyCountAdjustment>();
  if (fromKey) addTo(map, before.userId, fromHour, fromKey, -1);
  if (toKey && toHour) addTo(map, after.userId, toHour, toKey, 1);
  return [...map.values()].filter((row) =>
    Object.values(row.deltas).some((value) => value !== 0),
  );
}

/** Merge several adjustment lists so one batch statement serves one bucket. */
export function mergeAdjustments(
  lists: Array<HourlyCountAdjustment[]>,
): HourlyCountAdjustment[] {
  const map = new Map<string, HourlyCountAdjustment>();
  for (const list of lists) {
    for (const row of list) {
      addTo(map, row.userId, row.utcHour, "normal", row.deltas.normal);
      addTo(map, row.userId, row.utcHour, "archived", row.deltas.archived);
      addTo(map, row.userId, row.utcHour, "trashed", row.deltas.trashed);
    }
  }
  return [...map.values()].filter((row) =>
    Object.values(row.deltas).some((value) => value !== 0),
  );
}

/**
 * Statements to append to a memo write's `db.batch`.
 *
 * The insert side clamps at zero so a debit that arrives before its credit can
 * never leave a negative counter, and the update side does the same. Drift is
 * possible in principle (the counter is not transactional with `memos`), which
 * is what the daily recalibration is for; a negative or wrong number would show
 * up in the heatmap, so the floor is enforced on both paths.
 *
 * The return type is left to inference on purpose: `onConflictDoUpdate` widens
 * to `SQLiteInsertBase`, which is what `db.batch` accepts, and naming a
 * narrower type here breaks the batch call sites.
 */
export function hourlyCountStatements(
  db: FlareMoDb,
  adjustments: HourlyCountAdjustment[],
  now: string,
) {
  return adjustments.map((row) =>
    db
      .insert(memoHourlyCounts)
      .values({
        userId: row.userId,
        utcHour: row.utcHour,
        normalCount: Math.max(0, row.deltas.normal),
        archivedCount: Math.max(0, row.deltas.archived),
        trashedCount: Math.max(0, row.deltas.trashed),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [memoHourlyCounts.userId, memoHourlyCounts.utcHour],
        set: {
          normalCount: sql`max(0, ${memoHourlyCounts.normalCount} + ${row.deltas.normal})`,
          archivedCount: sql`max(0, ${memoHourlyCounts.archivedCount} + ${row.deltas.archived})`,
          trashedCount: sql`max(0, ${memoHourlyCounts.trashedCount} + ${row.deltas.trashed})`,
          updatedAt: now,
        },
      }),
  );
}

export type HourlyCountRow = {
  utcHour: string;
  normal: number;
  archived: number;
  trashed: number;
};

/**
 * The inclusive UTC hour range that can contain a local-day window ending on
 * `todayKey`.
 *
 * `todayKey` is a *local* calendar date, so the earliest instant it denotes
 * varies by zone. IANA offsets run from -12:00 to +14:00, so a 15-hour pad on
 * each side covers every zone with an hour to spare; the read is then filtered
 * down to the wanted local dates in JS, which is what makes the pad harmless.
 */
export function hourRangeForLocalWindow(
  todayKey: string,
  days: number,
): { fromHour: string; toHour: string } {
  const todayUtc = new Date(`${todayKey}T00:00:00.000Z`);
  const firstDayUtc = todayUtc.getTime() - (days - 1) * 24 * 60 * 60 * 1000;
  const pad = 15 * 60 * 60 * 1000;
  return {
    fromHour: new Date(firstDayUtc - pad).toISOString().slice(0, 13),
    toHour: new Date(todayUtc.getTime() + 24 * 60 * 60 * 1000 + pad)
      .toISOString()
      .slice(0, 13),
  };
}

/**
 * The local date a UTC hour bucket belongs to.
 *
 * A bucket spans `[hh:00:00, hh:59:59.999]`. For every zone whose offset is a
 * whole number of hours that interval sits inside one local day, so the
 * mapping is exact. The ~20 zones with :30/:45 offsets (Asia/Kolkata,
 * Asia/Kathmandu, …) can split one bucket across midnight; the bucket is then
 * attributed to the day containing its *end*, which keeps the count in the
 * window and can shift a single memo to the adjacent day. Chosen over minute
 * granularity deliberately: a 60x larger table to remove a one-hour ambiguity
 * in a minority of zones is not a trade worth making for a heatmap.
 */
export function localDateOfUtcHour(
  utcHour: string,
  formatLocalDate: (date: Date) => string,
): string {
  return formatLocalDate(new Date(`${utcHour}:59:59.999Z`));
}

/**
 * Counter rows whose UTC hour falls in `[fromHour, toHour]`, both inclusive
 * and compared as strings — "2026-01-31T09" sorts lexicographically, so the
 * primary key doubles as the range index.
 */
export async function readHourlyCountsInRange(
  db: FlareMoDb,
  userId: string,
  fromHour: string,
  toHour: string,
): Promise<HourlyCountRow[]> {
  const rows = await db
    .select({
      utcHour: memoHourlyCounts.utcHour,
      normal: memoHourlyCounts.normalCount,
      archived: memoHourlyCounts.archivedCount,
      trashed: memoHourlyCounts.trashedCount,
    })
    .from(memoHourlyCounts)
    .where(
      and(
        eq(memoHourlyCounts.userId, userId),
        gte(memoHourlyCounts.utcHour, fromHour),
        lte(memoHourlyCounts.utcHour, toHour),
      ),
    );
  return rows;
}

export type HourlyCountTotals = {
  normal: number;
  archived: number;
  trashed: number;
  /** Distinct UTC days on which the author had a normal or archived memo. */
  activeDays: number;
};

/**
 * All-time totals for one author.
 *
 * Scans the author's counter rows — bounded by the hours they actually wrote
 * at, not by their memo count — using the `(user_id, utc_hour)` primary key as
 * a covering index. `activeDays` matches the live query's
 * `count(distinct substr(created_at,1,10))` because both bucket in UTC.
 */
export async function readHourlyCountTotals(
  db: FlareMoDb,
  userId: string,
): Promise<HourlyCountTotals> {
  const row = await db
    .select({
      normal:
        sql<number>`coalesce(sum(${memoHourlyCounts.normalCount}), 0)`.mapWith(
          Number,
        ),
      archived:
        sql<number>`coalesce(sum(${memoHourlyCounts.archivedCount}), 0)`.mapWith(
          Number,
        ),
      trashed:
        sql<number>`coalesce(sum(${memoHourlyCounts.trashedCount}), 0)`.mapWith(
          Number,
        ),
      activeDays:
        sql<number>`count(distinct case when ${memoHourlyCounts.normalCount} + ${memoHourlyCounts.archivedCount} > 0 then substr(${memoHourlyCounts.utcHour}, 1, 10) end)`.mapWith(
          Number,
        ),
    })
    .from(memoHourlyCounts)
    .where(eq(memoHourlyCounts.userId, userId))
    .get();
  return {
    normal: row?.normal ?? 0,
    archived: row?.archived ?? 0,
    trashed: row?.trashed ?? 0,
    activeDays: row?.activeDays ?? 0,
  };
}

/**
 * Rebuild the counter for every author straight from `memos`.
 *
 * Converging in two steps rather than diffing: the grouped scan upserts every
 * live bucket stamped with `now`, then anything still carrying an older stamp
 * is a tombstone from drift and gets swept. A missed incremental write has no
 * row to decrement, so "delete all and reinsert" is the only alternative that
 * actually converges — and that would briefly expose an empty table to
 * concurrent readers, which mark-and-sweep does not.
 *
 * This is the authority for correctness: every incremental write above is an
 * optimization this pass can always overwrite.
 */
export async function recalibrateAllHourlyCounts(
  db: FlareMoDb,
  now: string,
): Promise<void> {
  await rebuildHourlyCounts(db, now);
}

/**
 * Rebuild one author's counter.
 *
 * The import path is the reason this exists as a separate entry point: a
 * bundle import writes `memos` directly and rewrites `created_at` on overwrite,
 * so it moves memos between hour buckets without going through the incremental
 * statements. Recomputing the importing user once is both cheaper and more
 * reliable than emitting an adjustment per memo — a 50k-memo bundle would
 * otherwise be 50k counter statements.
 */
export async function recalibrateUserHourlyCounts(
  db: FlareMoDb,
  userId: string,
  now: string,
): Promise<void> {
  await rebuildHourlyCounts(db, now, userId);
}

async function rebuildHourlyCounts(
  db: FlareMoDb,
  now: string,
  userId?: string,
): Promise<void> {
  const scope = userId ? eq(memos.userId, userId) : undefined;
  const grouped = await db
    .select({
      userId: memos.userId,
      utcHour: sql<string>`substr(${memos.createdAt}, 1, 13)`,
      normal:
        sql<number>`sum(case when ${memos.status} = 'normal' then 1 else 0 end)`.mapWith(
          Number,
        ),
      archived:
        sql<number>`sum(case when ${memos.status} = 'archived' then 1 else 0 end)`.mapWith(
          Number,
        ),
      trashed:
        sql<number>`sum(case when ${memos.status} = 'trashed' then 1 else 0 end)`.mapWith(
          Number,
        ),
    })
    .from(memos)
    // Comments live under their parent and are never counted (see
    // createMemoComment); the rebuild must agree or it would re-add them.
    .where(
      scope
        ? and(scope, isNotNull(memos.createdAt), notComment())
        : and(isNotNull(memos.createdAt), notComment()),
    )
    .groupBy(memos.userId, sql`substr(${memos.createdAt}, 1, 13)`);

  const live = grouped.filter(
    (row) => row.normal + row.archived + row.trashed > 0,
  );
  // Chunked because of D1's 100-bound-parameter ceiling; see
  // `UPSERT_CHUNK_ROWS` for why the chunk is as small as it is.
  for (let offset = 0; offset < live.length; offset += UPSERT_CHUNK_ROWS) {
    const chunk = live.slice(offset, offset + UPSERT_CHUNK_ROWS);
    await db
      .insert(memoHourlyCounts)
      .values(
        chunk.map((row) => ({
          userId: row.userId,
          utcHour: row.utcHour,
          normalCount: row.normal,
          archivedCount: row.archived,
          trashedCount: row.trashed,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [memoHourlyCounts.userId, memoHourlyCounts.utcHour],
        set: {
          normalCount: sql`excluded.normal_count`,
          archivedCount: sql`excluded.archived_count`,
          trashedCount: sql`excluded.trashed_count`,
          updatedAt: now,
        },
      });
  }
  // Only once every live bucket carries the new stamp: sweeping first would
  // delete rows the upserts are about to recreate, and a crash in between would
  // leave the counter empty.
  await db
    .delete(memoHourlyCounts)
    .where(
      userId
        ? and(
            eq(memoHourlyCounts.userId, userId),
            sql`${memoHourlyCounts.updatedAt} < ${now}`,
          )
        : sql`${memoHourlyCounts.updatedAt} < ${now}`,
    );
}

/**
 * Drop buckets whose counters all reached zero.
 *
 * A bucket can legitimately hit zero (its last memo was archived, trashed, or
 * hard-deleted) and the row is then just a tombstone that would otherwise
 * accumulate forever. Harmless if it races a concurrent write: the writer's
 * upsert re-creates the row, and both the read path and the recalibration treat
 * a missing row and a zero row identically.
 */
export async function pruneEmptyHourlyCountRows(db: FlareMoDb): Promise<void> {
  await db
    .delete(memoHourlyCounts)
    .where(
      sql`${memoHourlyCounts.normalCount} = 0 and ${memoHourlyCounts.archivedCount} = 0 and ${memoHourlyCounts.trashedCount} = 0`,
    );
}
