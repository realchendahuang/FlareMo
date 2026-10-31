import type { FlareMoDb, MemoRow, UserRow } from "@flaremo/db";
import { memoReviewMarks, memos, memoTags } from "@flaremo/db";
import { and, asc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";
import { NotFoundError, ValidationError } from "./errors";
import { parseResourceName } from "./ids";
import { notComment } from "./memo-comment-filter";
import { getStoredSetting, upsertStoredSetting } from "./settings";

/**
 * Today's review: a short, stable stack of old notes for one reader.
 *
 * Two sources feed it. "On this day" takes the same calendar day in past
 * years, one note per year first. The ladder takes one note from each of a
 * few age bands (about a week, a few weeks, a few months, most of a year)
 * so a note comes back once it has had time to be forgotten. Each band is
 * read by date range from D1, not from the latest page of the timeline, so
 * a busy writer still gets notes from months back.
 *
 * Picks are seeded by the date: the same day always yields the same stack
 * (a reload does not reshuffle it), the next day yields a different one.
 * Notes read in the review during the previous 30 days, notes the reader
 * muted, and notes carrying an excluded tag stay out.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive local-day age bands of the ladder, nearest first. */
const LADDER_BANDS: ReadonlyArray<readonly [number, number]> = [
  [3, 13],
  [14, 59],
  [60, 149],
  [150, 364],
];

/** A daily habit is a few minutes: the whole stack stays this short. */
export const REVIEW_DECK_LIMIT = 7;
/** "On this day" notes kept when the ladder is full. */
const YEARS_SHARE = 3;
/** At most this many notes from one past year. */
const PER_YEAR = 2;
/** A note read in the review stays out of it for this many days. */
export const REVIEW_COOLDOWN_DAYS = 30;
/** Candidate rows read per band; the pick only needs a varied sample. */
const BAND_SCAN_LIMIT = 400;
/** "On this day" candidates kept per past year before the seeded pick. */
const YEAR_SCAN_LIMIT = 50;
/**
 * How many past years "on this day" reaches back. Far enough that a decade of
 * notes is all visible, short enough that the query count stays fixed.
 */
export const YEARS_LOOKBACK = 20;

/**
 * The viewer-local calendar days "on this day" searches: the same month and
 * day in each of the previous `yearsBack` years. Feb 29 only exists in leap
 * years, so those years are skipped rather than matched against a day that
 * never happened.
 */
export function onThisDayWindows(
  date: string,
  yearsBack = YEARS_LOOKBACK,
): string[] {
  const monthDay = date.slice(5);
  const thisYear = Number(date.slice(0, 4));
  const days: string[] = [];
  for (let year = thisYear - 1; year >= thisYear - yearsBack; year -= 1) {
    const day = `${year}-${monthDay}`;
    const parsed = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) continue;
    if (parsed.toISOString().slice(0, 10) !== day) continue;
    days.push(day);
  }
  return days;
}
/** Seeded candidates per pool checked against excluded tags. */
const POOL_HEAD = 12;

export const REVIEW_SETTINGS_KEY = "flaremo.review.SETTINGS";
const MAX_EXCLUDED_TAGS = 50;

export type ReviewReason =
  | { type: "years"; years: number }
  | { type: "ladder"; days: number };

export type ReviewDeckEntry = {
  memo: MemoRow;
  reason: ReviewReason;
  reviewed: boolean;
};

export type ReviewSettings = {
  excludedTags: string[];
  mutedCount: number;
};

type Candidate = { id: string; createdAt: string };

function assertDate(date: string) {
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(date))) {
    throw new ValidationError("Invalid review date");
  }
}

/** `YYYY-MM-DD` shifted by whole days, computed in UTC to dodge DST. */
export function shiftDay(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** UTC instant at which a viewer-local day begins. */
function localDayStartUtc(date: string, tzOffset: number): string {
  return new Date(
    Date.parse(`${date}T00:00:00.000Z`) - tzOffset * 60_000,
  ).toISOString();
}

/** The viewer-local `YYYY-MM-DD` of a stored UTC timestamp. */
export function localDayOf(createdAt: string, tzOffset: number): string {
  return new Date(Date.parse(createdAt) + tzOffset * 60_000)
    .toISOString()
    .slice(0, 10);
}

/** Whole local days from `from` to `to`. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}

/** FNV-1a: a stable per-day order without a server-side random seed. */
function seededRank(date: string, id: string): number {
  let hash = 0x811c9dc5;
  const input = `${date}|${id}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function bySeed<T extends { id: string }>(date: string, items: T[]): T[] {
  return [...items].sort(
    (a, b) => seededRank(date, a.id) - seededRank(date, b.id),
  );
}

function normalizeTag(tag: string) {
  return tag.trim().replace(/^#/, "");
}

/** A tag or any of its children (`日记` also covers `日记/2025`). */
function isExcludedTag(tag: string, excluded: readonly string[]) {
  return excluded.some((item) => tag === item || tag.startsWith(`${item}/`));
}

async function readExcludedTags(db: FlareMoDb, user: UserRow) {
  const stored = await getStoredSetting(db, user, REVIEW_SETTINGS_KEY);
  const value = stored?.value as { excludedTags?: unknown } | undefined;
  return Array.isArray(value?.excludedTags)
    ? value.excludedTags.filter(
        (tag): tag is string => typeof tag === "string" && tag.length > 0,
      )
    : [];
}

export async function buildTodayReview(
  db: FlareMoDb,
  user: UserRow,
  input: { date: string; tzOffset?: number },
): Promise<ReviewDeckEntry[]> {
  const date = input.date.trim();
  assertDate(date);
  const tzOffset = input.tzOffset ?? 0;
  const cooldownStart = shiftDay(date, -REVIEW_COOLDOWN_DAYS);

  const [excludedTags, marks] = await Promise.all([
    readExcludedTags(db, user),
    db
      .select({
        memoId: memoReviewMarks.memoId,
        muted: memoReviewMarks.muted,
        lastReviewedOn: memoReviewMarks.lastReviewedOn,
      })
      .from(memoReviewMarks)
      .where(
        and(
          eq(memoReviewMarks.userId, user.id),
          or(
            eq(memoReviewMarks.muted, true),
            gte(memoReviewMarks.lastReviewedOn, cooldownStart),
          ),
        ),
      ),
  ]);
  const muted = new Set<string>();
  const cooling = new Set<string>();
  const readToday = new Set<string>();
  for (const mark of marks) {
    if (mark.muted) muted.add(mark.memoId);
    if (mark.lastReviewedOn === date) readToday.add(mark.memoId);
    else if (mark.lastReviewedOn && mark.lastReviewedOn >= cooldownStart) {
      cooling.add(mark.memoId);
    }
  }
  // Read today stays in today's stack: that is what keeps progress stable.
  const eligible = (candidate: Candidate) =>
    !muted.has(candidate.id) && !cooling.has(candidate.id);

  const ownNormal = and(
    eq(memos.userId, user.id),
    eq(memos.status, "normal"),
    notComment(),
  );
  const monthDay = date.slice(5);
  // One bounded range per past year instead of one scan over every note.
  // `datetime()` on the column matches the calendar day but cannot use
  // `memos_user_created_id_idx`; the range can, and the local-day check below
  // drops the one boundary note a timezone offset can pull in.
  const onThisDayQueries = onThisDayWindows(date).map((day) =>
    db
      .select({ id: memos.id, createdAt: memos.createdAt })
      .from(memos)
      .where(
        and(
          ownNormal,
          gte(memos.createdAt, localDayStartUtc(day, tzOffset)),
          lt(memos.createdAt, localDayStartUtc(shiftDay(day, 1), tzOffset)),
        ),
      )
      .orderBy(asc(memos.createdAt))
      .limit(YEAR_SCAN_LIMIT),
  );
  const [onThisDayGroups, ...bands] = await Promise.all([
    Promise.all(onThisDayQueries),
    ...LADDER_BANDS.map(([nearest, furthest]) =>
      db
        .select({ id: memos.id, createdAt: memos.createdAt })
        .from(memos)
        .where(
          and(
            ownNormal,
            gte(
              memos.createdAt,
              localDayStartUtc(shiftDay(date, -furthest), tzOffset),
            ),
            lt(
              memos.createdAt,
              localDayStartUtc(shiftDay(date, -nearest + 1), tzOffset),
            ),
          ),
        )
        .orderBy(asc(memos.createdAt))
        .limit(BAND_SCAN_LIMIT),
    ),
  ]);

  // Group "on this day" by how many years back, keeping only whole years.
  const years = new Map<number, Candidate[]>();
  for (const candidate of onThisDayGroups.flat()) {
    if (!eligible(candidate)) continue;
    const day = localDayOf(candidate.createdAt, tzOffset);
    if (day.slice(5) !== monthDay) continue;
    const count = Number(date.slice(0, 4)) - Number(day.slice(0, 4));
    if (count < 1) continue;
    years.set(count, [...(years.get(count) ?? []), candidate]);
  }
  const yearPools = [...years.entries()]
    .sort(([a], [b]) => b - a)
    .map(([count, list]) => ({
      count,
      list: bySeed(date, list).slice(0, POOL_HEAD),
    }));
  const bandPools = bands.map((rows) =>
    bySeed(date, rows.filter(eligible)).slice(0, POOL_HEAD),
  );

  // One tag lookup for every seeded head, instead of per pick.
  const blocked = new Set<string>();
  if (excludedTags.length > 0) {
    const ids = [
      ...yearPools.flatMap((pool) => pool.list),
      ...bandPools.flat(),
    ].map((candidate) => candidate.id);
    for (const chunk of chunkForD1([...new Set(ids)], d1IdsPerStatement())) {
      const rows = await db
        .select({ memoId: memoTags.memoId, tag: memoTags.tag })
        .from(memoTags)
        .where(inArray(memoTags.memoId, chunk));
      for (const row of rows) {
        if (isExcludedTag(row.tag, excludedTags)) blocked.add(row.memoId);
      }
    }
  }
  const allowed = (candidate: Candidate) => !blocked.has(candidate.id);

  const ladder: Array<{ id: string; reason: ReviewReason }> = [];
  const taken = new Set<string>();
  for (const pool of bandPools) {
    const pick = pool.find((candidate) => allowed(candidate));
    if (!pick) continue;
    taken.add(pick.id);
    ladder.push({
      id: pick.id,
      reason: {
        type: "ladder",
        days: daysBetween(localDayOf(pick.createdAt, tzOffset), date),
      },
    });
  }

  // Years get their share first (one per year, furthest first), then a
  // second note per year if the ladder left room.
  const yearSlots = Math.max(YEARS_SHARE, REVIEW_DECK_LIMIT - ladder.length);
  const perYear = yearPools.map((pool) => ({
    count: pool.count,
    list: pool.list.filter(allowed),
  }));
  const yearPicks: Array<{ id: string; reason: ReviewReason }> = [];
  for (let round = 0; round < PER_YEAR; round += 1) {
    for (const pool of perYear) {
      if (yearPicks.length >= yearSlots) break;
      const pick = pool.list[round];
      if (!pick || taken.has(pick.id)) continue;
      taken.add(pick.id);
      yearPicks.push({
        id: pick.id,
        reason: { type: "years", years: pool.count },
      });
    }
  }
  // Keep the furthest-first reading order inside "on this day".
  yearPicks.sort((a, b) =>
    a.reason.type === "years" && b.reason.type === "years"
      ? b.reason.years - a.reason.years
      : 0,
  );

  const ordered = [
    ...yearPicks,
    // Furthest back first: the older a note, the more it has to say again.
    ...ladder.reverse(),
  ].slice(0, REVIEW_DECK_LIMIT);
  if (ordered.length === 0) return [];

  const rows = await db
    .select()
    .from(memos)
    .where(
      inArray(
        memos.id,
        ordered.map((item) => item.id),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ordered.flatMap((item) => {
    const memo = byId.get(item.id);
    return memo
      ? [{ memo, reason: item.reason, reviewed: readToday.has(item.id) }]
      : [];
  });
}

async function ownMemoId(db: FlareMoDb, user: UserRow, memoName: string) {
  const id = parseResourceName(memoName.trim(), "memos");
  const row = await db
    .select({ id: memos.id })
    .from(memos)
    .where(and(eq(memos.id, id), eq(memos.userId, user.id)))
    .get();
  if (!row) throw new NotFoundError("Memo not found");
  return row.id;
}

/** Record a review read, or mute / unmute a note for the review. */
export async function markReviewMemo(
  db: FlareMoDb,
  user: UserRow,
  input: {
    memoId: string;
    date: string;
    action: "reviewed" | "mute" | "unmute";
  },
): Promise<void> {
  const date = input.date.trim();
  assertDate(date);
  const memoId = await ownMemoId(db, user, input.memoId);
  const updatedAt = new Date().toISOString();
  const set =
    input.action === "reviewed"
      ? { lastReviewedOn: date, updatedAt }
      : { muted: input.action === "mute", updatedAt };
  await db
    .insert(memoReviewMarks)
    .values({ userId: user.id, memoId, ...set })
    .onConflictDoUpdate({
      target: [memoReviewMarks.userId, memoReviewMarks.memoId],
      set,
    });
}

export async function getReviewSettings(
  db: FlareMoDb,
  user: UserRow,
): Promise<ReviewSettings> {
  const [excludedTags, mutedRow] = await Promise.all([
    readExcludedTags(db, user),
    db
      .select({ count: sql<number>`count(*)` })
      .from(memoReviewMarks)
      .innerJoin(memos, eq(memos.id, memoReviewMarks.memoId))
      .where(
        and(
          eq(memoReviewMarks.userId, user.id),
          eq(memoReviewMarks.muted, true),
          eq(memos.status, "normal"),
        ),
      )
      .get(),
  ]);
  return { excludedTags, mutedCount: Number(mutedRow?.count ?? 0) };
}

export async function updateReviewSettings(
  db: FlareMoDb,
  user: UserRow,
  input: { excludedTags?: string[]; restoreMuted?: boolean },
): Promise<ReviewSettings> {
  if (input.excludedTags) {
    const excludedTags = [
      ...new Set(input.excludedTags.map(normalizeTag).filter(Boolean)),
    ].slice(0, MAX_EXCLUDED_TAGS);
    await upsertStoredSetting(db, user, REVIEW_SETTINGS_KEY, { excludedTags });
  }
  if (input.restoreMuted) {
    await db
      .update(memoReviewMarks)
      .set({ muted: false, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(memoReviewMarks.userId, user.id),
          eq(memoReviewMarks.muted, true),
        ),
      );
  }
  return getReviewSettings(db, user);
}
