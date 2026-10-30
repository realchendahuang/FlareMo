import type { CalendarView, HourlyActivityResponse } from "@flaremo/contracts";
import type { FlareMoDb, UserRow } from "@flaremo/db";
import { memos, tasks } from "@flaremo/db";
import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { notComment } from "./memo-comment-filter";
import { nextDayKey, taskToDto } from "./tasks";

// The calendar is a presentation of data that already has a home: notes keep
// being located by `created_at`, scheduled items keep being tasks located by
// `due_at`. Nothing here introduces a new schedulable-only entity.
export async function getCalendarView(
  db: FlareMoDb,
  user: UserRow,
  query: { from: string; to: string; tz?: number },
): Promise<CalendarView> {
  const { from, to } = query;
  // Day keys are the client's local days. tz is the client's
  // getTimezoneOffset() (UTC - local in minutes, e.g. -480 for UTC+8), so
  // local wall clock = UTC - tz and UTC bounds = local-day bounds + tz.
  //
  // Deliberate asymmetry (not a bug): notes are *moments in time* — their
  // `created_at` is an absolute instant, so they are bucketed into the
  // viewer's local day via the tz offset. Tasks are *local-day semantics* —
  // `due_at` is a plain calendar day ("due on the 12th"), so their day key is
  // compared literally, with no timezone conversion. A due date is not an
  // instant and has no meaningful "UTC instant" to shift.
  const offsetMinutes = -(query.tz ?? 0);
  const boundShift = (query.tz ?? 0) * 60_000;
  const startUtc = new Date(
    new Date(`${from}T00:00:00Z`).getTime() + boundShift,
  );
  const endUtc = new Date(
    new Date(`${to}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000 + boundShift,
  );

  const [noteRows, noteTaskRows, taskRows] = await Promise.all([
    db
      .select({
        date: sql<string>`substr(datetime(${memos.createdAt}, ${`${offsetMinutes} minutes`}), 1, 10)`,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(memos)
      .where(
        and(
          eq(memos.userId, user.id),
          inArray(memos.status, ["normal", "archived"]),
          gte(memos.createdAt, startUtc.toISOString()),
          lt(memos.createdAt, endUtc.toISOString()),
          notComment(),
        ),
      )
      .groupBy(
        sql`substr(datetime(${memos.createdAt}, ${`${offsetMinutes} minutes`}), 1, 10)`,
      ),
    // `has_incomplete_tasks` is stamped by the memo write path whenever the
    // Markdown task list has unchecked items. Rows written before stamping
    // existed fall back to a content scan in the same predicate, so legacy
    // memos show up without rewriting them.
    db
      .select({
        date: sql<string>`substr(datetime(${memos.createdAt}, ${`${offsetMinutes} minutes`}), 1, 10)`,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(memos)
      .where(
        and(
          eq(memos.userId, user.id),
          inArray(memos.status, ["normal", "archived"]),
          gte(memos.createdAt, startUtc.toISOString()),
          lt(memos.createdAt, endUtc.toISOString()),
          notComment(),
          sql`(
            json_extract(${memos.payload}, '$.property.has_incomplete_tasks') = 1
            OR (
              json_extract(${memos.payload}, '$.property.has_incomplete_tasks') IS NULL
              AND (
                ${memos.content} LIKE '%- [ ]%'
                OR ${memos.content} LIKE '%* [ ]%'
                OR ${memos.content} LIKE '%+ [ ]%'
              )
            )
          )`,
        ),
      )
      .groupBy(
        sql`substr(datetime(${memos.createdAt}, ${`${offsetMinutes} minutes`}), 1, 10)`,
      ),
    db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, user.id),
          isNull(tasks.deletedAt),
          // Inclusive on the last day via an exclusive next-day bound so a
          // task stored with a time component (`2026-09-12T15:00:00Z` on
          // legacy rows; writes are date-only) still lands on the 12th.
          gte(tasks.dueAt, from),
          lt(tasks.dueAt, nextDayKey(to)),
        ),
      )
      .orderBy(asc(tasks.dueAt), asc(tasks.sortOrder), asc(tasks.id)),
  ]);

  return {
    notes: noteRows,
    note_tasks: noteTaskRows,
    tasks: taskRows.map(taskToDto),
  };
}

/**
 * Returns the number of memos created in each local hour (0–23) for a single
 * calendar day. All 24 slots are always present; empty hours have count 0.
 *
 * Timezone handling mirrors getCalendarView: `tz` is the client's
 * Date#getTimezoneOffset() (UTC − local in minutes). UTC+8 sends −480;
 * offsetMinutes = −(−480) = +480, so datetime(created_at, '+480 minutes')
 * yields the local wall-clock time.
 */
export async function getHourlyActivity(
  db: FlareMoDb,
  user: UserRow,
  query: { date?: string; from?: string; to?: string; tz?: number },
): Promise<HourlyActivityResponse> {
  const fromDate = query.from ?? query.date;
  const toDate = query.to ?? query.date;
  if (!fromDate || !toDate) {
    return { hours: [] };
  }
  const offsetMinutes = -(query.tz ?? 0);
  const boundShift = (query.tz ?? 0) * 60_000;
  // Inclusive local-day bounds converted to UTC instants.
  const startUtc = new Date(
    new Date(`${fromDate}T00:00:00Z`).getTime() + boundShift,
  );
  const endUtc = new Date(
    new Date(`${toDate}T00:00:00Z`).getTime() +
      24 * 60 * 60 * 1000 +
      boundShift,
  );

  const rows = await db
    .select({
      date: sql<string>`substr(datetime(${memos.createdAt}, ${`${offsetMinutes} minutes`}), 1, 10)`,
      hour: sql<number>`CAST(substr(datetime(${memos.createdAt}, ${`${offsetMinutes} minutes`}), 12, 2) AS INTEGER)`.mapWith(
        Number,
      ),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(memos)
    .where(
      and(
        eq(memos.userId, user.id),
        inArray(memos.status, ["normal", "archived"]),
        gte(memos.createdAt, startUtc.toISOString()),
        lt(memos.createdAt, endUtc.toISOString()),
        notComment(),
      ),
    )
    .groupBy(
      sql`substr(datetime(${memos.createdAt}, ${`${offsetMinutes} minutes`}), 1, 13)`,
    );

  const byDateHour = new Map<string, number>();
  for (const r of rows) {
    byDateHour.set(`${r.date}_${r.hour}`, r.count);
  }

  const result: Array<{ date: string; hour: number; count: number }> = [];
  const cur = new Date(`${fromDate}T12:00:00Z`);
  const end = new Date(`${toDate}T12:00:00Z`);
  while (cur.getTime() <= end.getTime()) {
    const dStr = cur.toISOString().slice(0, 10);
    for (let h = 0; h < 24; h++) {
      result.push({
        date: dStr,
        hour: h,
        count: byDateHour.get(`${dStr}_${h}`) ?? 0,
      });
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return {
    hours: result,
  };
}
