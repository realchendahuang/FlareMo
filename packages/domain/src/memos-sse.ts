import {
  type FlareMoDb,
  type MemosSseEventRow,
  memosSseEvents,
  type UserRow,
} from "@flaremo/db";
import { and, asc, gt, sql } from "drizzle-orm";

export const MEMOS_SSE_EVENT_TYPES = [
  "memo.created",
  "memo.updated",
  "memo.deleted",
  "memo.comment.created",
  "reaction.upserted",
  "reaction.deleted",
] as const;

export type MemosSseEventType = (typeof MEMOS_SSE_EVENT_TYPES)[number];

export type NewMemosSseEvent = {
  type: MemosSseEventType;
  name: string;
  parent?: string;
  visibility: "private" | "protected" | "public";
  creatorId: string;
  createdAt: string;
};

/**
 * Return an insert statement so resource mutations can append their event in
 * the same D1 batch as the mutation itself. Keeping this as a statement
 * factory prevents a successful memo write from becoming an SSE ghost event.
 */
export function insertMemosSseEvent(db: FlareMoDb, event: NewMemosSseEvent) {
  return db.insert(memosSseEvents).values({
    type: event.type,
    name: event.name,
    parent: event.parent ?? null,
    visibility: event.visibility,
    creatorId: event.creatorId,
    createdAt: event.createdAt,
  });
}

export async function getLatestMemosSseEventId(db: FlareMoDb) {
  const row = await db
    .select({
      id: sql<number>`coalesce(max(${memosSseEvents.id}), 0)`.mapWith(Number),
    })
    .from(memosSseEvents)
    .get();
  return row?.id ?? 0;
}

/**
 * Read a bounded replay page using the same visibility rules as upstream
 * Memos' SSE hub: private events are visible to their creator or an admin;
 * protected/public events are visible to any authenticated subscriber.
 */
export async function listMemosSseEvents(
  db: FlareMoDb,
  afterId: number,
  limit = 32,
): Promise<MemosSseEventRow[]> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 128));
  const filters = [gt(memosSseEvents.id, Math.max(0, Math.trunc(afterId)))];

  return db
    .select()
    .from(memosSseEvents)
    .where(and(...filters))
    .orderBy(asc(memosSseEvents.id))
    .limit(safeLimit);
}

export function canReceiveMemosSseEvent(
  event: MemosSseEventRow,
  user: UserRow,
) {
  if (user.role === "owner") return true;
  if (event.visibility !== "private") return true;
  return event.creatorId === user.id;
}
