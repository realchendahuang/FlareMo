import type { CalendarView } from "@flaremo/contracts";
import type { FlareMoDb, UserRow } from "@flaremo/db";
import { memos, tasks } from "@flaremo/db";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { taskToDto } from "./tasks";

// The calendar is a presentation of data that already has a home: notes keep
// being located by `created_at`, scheduled items keep being tasks located by
// `due_at`. Nothing here introduces a new schedulable-only entity.
export async function getCalendarView(
  db: FlareMoDb,
  user: UserRow,
  query: { from: string; to: string },
): Promise<CalendarView> {
  const { from, to } = query;

  const [noteRows, noteTaskRows, taskRows] = await Promise.all([
    db
      .select({
        date: sql<string>`substr(${memos.createdAt}, 1, 10)`,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(memos)
      .where(
        and(
          eq(memos.userId, user.id),
          inArray(memos.status, ["normal", "archived"]),
          gte(memos.createdAt, `${from}T00:00:00.000Z`),
          sql`substr(${memos.createdAt}, 1, 10) <= ${to}`,
        ),
      )
      .groupBy(sql`substr(${memos.createdAt}, 1, 10)`),
    // `has_incomplete_tasks` is stamped by the memo write path whenever the
    // Markdown task list has unchecked items. Rows written before stamping
    // existed fall back to a content scan in the same predicate, so legacy
    // memos show up without rewriting them.
    db
      .select({
        date: sql<string>`substr(${memos.createdAt}, 1, 10)`,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(memos)
      .where(
        and(
          eq(memos.userId, user.id),
          inArray(memos.status, ["normal", "archived"]),
          gte(memos.createdAt, `${from}T00:00:00.000Z`),
          sql`substr(${memos.createdAt}, 1, 10) <= ${to}`,
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
      .groupBy(sql`substr(${memos.createdAt}, 1, 10)`),
    db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, user.id),
          gte(tasks.dueAt, from),
          lte(tasks.dueAt, to),
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
