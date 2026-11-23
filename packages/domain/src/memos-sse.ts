import {
  type FlareMoDb,
  type MemosSseEventRow,
  memosSseEvents,
} from "@flaremo/db";
import { and, asc, gt, inArray, lt, sql } from "drizzle-orm";
import { d1IdsPerStatement } from "./d1-limits";
import { isActiveTeamMember, type TeamViewer } from "./team-permissions";

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
  /** Owning organization; required so protected events stay org-scoped. */
  teamId?: string | null;
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
    teamId: event.teamId ?? null,
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
 * Memos' SSE hub: private events are visible only to their creator;
 * protected/public events are visible to any active team member.
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

/**
 * Delivery mirrors the memo read boundary: private events go only to their
 * creator, protected events only to members of the event's organization, and
 * public events to any active member. A protected event without a team id is
 * undeliverable (fail-closed for legacy rows written before the column).
 */
export function canReceiveMemosSseEvent(
  event: MemosSseEventRow,
  user: TeamViewer,
) {
  if (!isActiveTeamMember(user)) return false;
  if (event.visibility === "private") return event.creatorId === user.id;
  if (event.visibility === "protected") {
    return Boolean(event.teamId && event.teamId === user.teamOrganizationId);
  }
  return true;
}

/** SSE event rows older than this are pruned by the daily cron. Clients
 * reconnect with Last-Event-ID for at most one missed session, so a week of
 * replay is generous; the table is otherwise the only outbox that grew
 * without bound. */
export const MEMOS_SSE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export async function pruneMemosSseEvents(db: FlareMoDb, before: Date) {
  const cutoff = before.toISOString();
  // Bounded pages, deleted page by page. The previous version selected 1000
  // ids and deleted them in a single statement, which D1 rejects past 100
  // bindings — so on any instance with more than a hundred expired events the
  // daily sweep threw and the table only ever grew.
  let pruned = 0;
  while (true) {
    const stale = await db
      .select({ id: memosSseEvents.id })
      .from(memosSseEvents)
      .where(lt(memosSseEvents.createdAt, cutoff))
      .limit(d1IdsPerStatement());
    if (stale.length === 0) return pruned;
    const ids = stale.map((row) => row.id);
    await db.delete(memosSseEvents).where(inArray(memosSseEvents.id, ids));
    pruned += ids.length;
    if (ids.length < d1IdsPerStatement()) return pruned;
  }
}
