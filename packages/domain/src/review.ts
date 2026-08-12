import type { FlareMoDb, MemoRow, UserRow } from "@flaremo/db";
import { memoRelations, memos, memoTags, users } from "@flaremo/db";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { ValidationError } from "./errors";
import { parseResourceName } from "./ids";
import { getMemoById } from "./memos";
import { insertMemoNotification } from "./memos-user";

export type WalkVia =
  | { type: "tag"; tag: string }
  | { type: "relation" }
  | { type: "jump" };

const DAILY_REVIEW_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "On this day" review: normal memos whose creation month-day matches the
 * given local date, excluding memos created on that exact date. The caller
 * passes the viewer's local date and UTC offset (minutes ahead of UTC) so
 * month-day comparisons stay in the viewer's frame without a server
 * time-zone guess.
 */
export async function listDailyReviewMemos(
  db: FlareMoDb,
  user: UserRow,
  input: { date: string; tzOffset?: number },
): Promise<MemoRow[]> {
  const date = input.date.trim();
  if (!DAILY_REVIEW_DATE_PATTERN.test(date) || Number.isNaN(Date.parse(date))) {
    throw new ValidationError("Invalid review date");
  }
  const tzOffset = input.tzOffset ?? 0;
  const monthDay = date.slice(5);
  return db
    .select()
    .from(memos)
    .where(
      and(
        eq(memos.userId, user.id),
        eq(memos.status, "normal"),
        sql`substr(datetime(${memos.createdAt}, printf('%+d minutes', ${tzOffset})), 6, 5) = ${monthDay}`,
        sql`substr(datetime(${memos.createdAt}, printf('%+d minutes', ${tzOffset})), 1, 10) != ${date}`,
      ),
    )
    .orderBy(asc(memos.createdAt), asc(memos.id));
}

/**
 * File one "daily review" inbox row per user for the given UTC date. The
 * source event id (`daily-review:<date>`) plus the receiver/source/type
 * unique index make cron retries idempotent; a user without on-this-day
 * history simply gets nothing. Returns the number of rows created.
 */
export async function createDailyReviewNotifications(
  db: FlareMoDb,
  input: { date: string },
): Promise<number> {
  const date = input.date.trim();
  if (!DAILY_REVIEW_DATE_PATTERN.test(date) || Number.isNaN(Date.parse(date))) {
    throw new ValidationError("Invalid review date");
  }
  const allUsers = await db.select().from(users);
  let created = 0;
  for (const user of allUsers) {
    const reviewMemos = await listDailyReviewMemos(db, user, {
      date,
      tzOffset: 0,
    });
    // Rows come back ascending, so the last entry is the most recent memo and
    // anchors the notification's required memo reference.
    const anchor = reviewMemos[reviewMemos.length - 1];
    if (!anchor) continue;
    const inserted = await insertMemoNotification(db, {
      receiverId: user.id,
      senderId: user.id,
      type: "daily_review",
      sourceEventId: `daily-review:${date}`,
      memoId: anchor.id,
    });
    if (inserted.meta.changes > 0) created += 1;
  }
  return created;
}

/**
 * Pick one random normal memo outside the exclusion set. Exclusions are
 * applied in memory rather than as bound parameters so long random walks
 * cannot exceed D1's bound-parameter limit.
 */
export async function getRandomMemo(
  db: FlareMoDb,
  user: UserRow,
  excludeIds: string[] = [],
): Promise<MemoRow | null> {
  const rows = await db
    .select({ id: memos.id })
    .from(memos)
    .where(and(eq(memos.userId, user.id), eq(memos.status, "normal")));
  const excluded = new Set(excludeIds);
  const candidates = rows.filter((row) => !excluded.has(row.id));
  if (candidates.length === 0) return null;
  const picked = pickRandom(candidates);
  return (
    (await db.select().from(memos).where(eq(memos.id, picked.id)).get()) ?? null
  );
}

/**
 * Continue a random walk from `memoId`: prefer a normal memo sharing a tag,
 * then a memo connected through memo_relations (either direction), and
 * finally a completely unrelated random memo ("jump"). Returns null when
 * every normal memo has already been walked through.
 */
export async function getWalkNextMemo(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  excludeIds: string[] = [],
): Promise<{ memo: MemoRow | null; via: WalkVia | null }> {
  const normalizedMemoId = parseResourceName(memoId.trim(), "memos");
  if (!normalizedMemoId || normalizedMemoId === "memos/") {
    throw new ValidationError("Invalid memo id");
  }
  await getMemoById(db, user, normalizedMemoId);
  const excluded = new Set([normalizedMemoId, ...excludeIds]);

  const sourceTags = (
    await db
      .select({ tag: memoTags.tag })
      .from(memoTags)
      .where(and(eq(memoTags.memoId, normalizedMemoId)))
  ).map((row) => row.tag);

  if (sourceTags.length > 0) {
    const tagCandidates = (
      await db
        .select({ memoId: memoTags.memoId, tag: memoTags.tag })
        .from(memoTags)
        .innerJoin(memos, eq(memoTags.memoId, memos.id))
        .where(
          and(
            eq(memoTags.userId, user.id),
            inArray(memoTags.tag, sourceTags),
            eq(memos.status, "normal"),
          ),
        )
    ).filter((row) => !excluded.has(row.memoId));
    if (tagCandidates.length > 0) {
      const picked = pickRandom(tagCandidates);
      const memo = await db
        .select()
        .from(memos)
        .where(eq(memos.id, picked.memoId))
        .get();
      if (memo) return { memo, via: { type: "tag", tag: picked.tag } };
    }
  }

  const relations = await db
    .select({
      memoId: memoRelations.memoId,
      relatedMemoId: memoRelations.relatedMemoId,
    })
    .from(memoRelations)
    .where(
      or(
        eq(memoRelations.memoId, normalizedMemoId),
        eq(memoRelations.relatedMemoId, normalizedMemoId),
      ),
    );
  const relatedIds = [
    ...new Set(
      relations.map((relation) =>
        relation.memoId === normalizedMemoId
          ? relation.relatedMemoId
          : relation.memoId,
      ),
    ),
  ].filter((id) => !excluded.has(id));
  if (relatedIds.length > 0) {
    const related = await db
      .select()
      .from(memos)
      .where(
        and(
          eq(memos.userId, user.id),
          eq(memos.status, "normal"),
          inArray(memos.id, relatedIds),
        ),
      );
    if (related.length > 0) {
      return { memo: pickRandom(related), via: { type: "relation" } };
    }
  }

  const memo = await getRandomMemo(db, user, [...excluded]);
  return memo ? { memo, via: { type: "jump" } } : { memo: null, via: null };
}

export type RelatedMemo = {
  memo: MemoRow;
  sharedTags: string[];
  viaRelation: boolean;
};

/**
 * Lightweight "related notes": rank normal memos by direct relation (either
 * direction, strongest signal) plus the number of shared exact tags. This is
 * the pre-Vectorize version of flomo's related notes; semantic ranking can
 * replace the scoring later without changing the route contract.
 */
export async function listRelatedMemos(
  db: FlareMoDb,
  user: UserRow,
  memoId: string,
  input: { limit?: number } = {},
): Promise<RelatedMemo[]> {
  const normalizedMemoId = parseResourceName(memoId.trim(), "memos");
  if (!normalizedMemoId || normalizedMemoId === "memos/") {
    throw new ValidationError("Invalid memo id");
  }
  await getMemoById(db, user, normalizedMemoId);
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);

  const sourceTags = (
    await db
      .select({ tag: memoTags.tag })
      .from(memoTags)
      .where(eq(memoTags.memoId, normalizedMemoId))
  ).map((row) => row.tag);

  const sharedTagsByMemo = new Map<string, Set<string>>();
  if (sourceTags.length > 0) {
    const rows = await db
      .select({ memoId: memoTags.memoId, tag: memoTags.tag })
      .from(memoTags)
      .innerJoin(memos, eq(memoTags.memoId, memos.id))
      .where(
        and(
          eq(memoTags.userId, user.id),
          inArray(memoTags.tag, sourceTags),
          eq(memos.status, "normal"),
        ),
      );
    for (const row of rows) {
      if (row.memoId === normalizedMemoId) continue;
      const tags = sharedTagsByMemo.get(row.memoId) ?? new Set<string>();
      tags.add(row.tag);
      sharedTagsByMemo.set(row.memoId, tags);
    }
  }

  const relations = await db
    .select({
      memoId: memoRelations.memoId,
      relatedMemoId: memoRelations.relatedMemoId,
    })
    .from(memoRelations)
    .where(
      or(
        eq(memoRelations.memoId, normalizedMemoId),
        eq(memoRelations.relatedMemoId, normalizedMemoId),
      ),
    );
  const relatedIds = new Set(
    relations.map((relation) =>
      relation.memoId === normalizedMemoId
        ? relation.relatedMemoId
        : relation.memoId,
    ),
  );

  const candidateIds = [
    ...new Set([...sharedTagsByMemo.keys(), ...relatedIds]),
  ];
  if (candidateIds.length === 0) return [];
  const rows = await db
    .select()
    .from(memos)
    .where(
      and(
        eq(memos.userId, user.id),
        eq(memos.status, "normal"),
        inArray(memos.id, candidateIds),
      ),
    );

  return rows
    .map((memo) => ({
      memo,
      sharedTags: [...(sharedTagsByMemo.get(memo.id) ?? [])].sort(),
      viaRelation: relatedIds.has(memo.id),
    }))
    .sort(
      (a, b) =>
        relatedScore(b) - relatedScore(a) ||
        b.memo.createdAt.localeCompare(a.memo.createdAt) ||
        a.memo.id.localeCompare(b.memo.id),
    )
    .slice(0, limit);
}

function relatedScore(entry: RelatedMemo): number {
  return (entry.viaRelation ? 3 : 0) + entry.sharedTags.length;
}

function pickRandom<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) {
    throw new Error("pickRandom requires a non-empty array");
  }
  return item;
}
