import { importBundleSchema } from "@flaremo/contracts";
import {
  applyFlaremoMigrations,
  createDb,
  memoHourlyCounts,
  memos,
} from "@flaremo/db";
import { and, eq, sql } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importData } from "./import-export";
import { notComment } from "./memo-comment-filter";
import {
  adjustmentForMemoTransition,
  adjustmentForNewMemo,
  hourlyCountStatements,
  hourRangeForLocalWindow,
  localDateOfUtcHour,
  pruneEmptyHourlyCountRows,
  readHourlyCountTotals,
  recalibrateAllHourlyCounts,
  utcHourOf,
} from "./memo-hourly-counts";
import { createMemoComment } from "./memos-comments";
import { hardDeleteMemo } from "./memos-lifecycle";
import { createDateKeyFormatter } from "./memos-query";
import { getMemoStats } from "./memos-read";
import { createMemo, updateMemo } from "./memos-write";
import type { TeamViewer } from "./team-permissions";
import { ensureTeamOwner } from "./test-support";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let owner: TeamViewer;

beforeEach(async () => {
  mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "flaremo-hourly-counts-test" },
  });
  const database = await mf.getD1Database("DB");
  db = createDb(database);
  await applyFlaremoMigrations(database);
  owner = await ensureTeamOwner(db);
});

afterEach(async () => {
  await mf.dispose();
});

/** Apply counter statements outside a memo batch, to simulate stray writes. */
async function applyStrayAdjustments(
  adjustments: Parameters<typeof hourlyCountStatements>[1],
) {
  for (const statement of hourlyCountStatements(
    db,
    adjustments,
    new Date().toISOString(),
  )) {
    await db.batch([statement] as unknown as Parameters<typeof db.batch>[0]);
  }
}

/** Insert a memo with a caller-chosen creation instant, bypassing createMemo. */
async function seedMemo(input: {
  id: string;
  createdAt: string;
  status?: "normal" | "archived" | "trashed" | "deleted";
}) {
  await db.insert(memos).values({
    id: input.id,
    userId: owner.id,
    content: `seeded ${input.id}`,
    visibility: "private",
    status: input.status ?? "normal",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

/** The counts a live scan of `memos` would produce, for comparison. */
async function liveTotals(userId: string) {
  const rows = await db
    .select({ status: memos.status, createdAt: memos.createdAt })
    .from(memos)
    // The live oracle mirrors the product rule: comments are not records.
    .where(and(eq(memos.userId, userId), notComment()));
  const result = {
    normal: 0,
    archived: 0,
    trashed: 0,
    activeDays: new Set<string>(),
  };
  for (const row of rows) {
    if (row.status === "normal") {
      result.normal += 1;
      result.activeDays.add(row.createdAt.slice(0, 10));
    } else if (row.status === "archived") {
      result.archived += 1;
      result.activeDays.add(row.createdAt.slice(0, 10));
    } else if (row.status === "trashed") {
      result.trashed += 1;
    }
  }
  return {
    normal: result.normal,
    archived: result.archived,
    trashed: result.trashed,
    activeDays: result.activeDays.size,
  };
}

describe("utcHourOf", () => {
  it("buckets on the UTC hour", () => {
    expect(utcHourOf("2026-01-31T09:15:22.400Z")).toBe("2026-01-31T09");
    expect(utcHourOf("2026-01-31T23:59:59.999Z")).toBe("2026-01-31T23");
  });

  it("normalizes a non-ISO instant instead of slicing it", () => {
    // An import bundle can carry a local-time string; slicing would have
    // produced a bucket off by the offset.
    expect(utcHourOf("2026-01-31T09:15:22+09:00")).toBe("2026-01-31T00");
  });

  it("returns null for an unparseable value so the caller can skip it", () => {
    expect(utcHourOf("not a date")).toBeNull();
    expect(utcHourOf("")).toBeNull();
  });
});

describe("adjustment planning", () => {
  const memo = { userId: "u1", createdAt: "2026-01-31T09:00:00.000Z" };

  it("credits the column matching the new memo's status", () => {
    expect(adjustmentForNewMemo({ ...memo, status: "normal" })).toEqual([
      {
        userId: "u1",
        utcHour: "2026-01-31T09",
        deltas: { normal: 1, archived: 0, trashed: 0 },
      },
    ]);
  });

  it("ignores a new memo in the terminal deleted state", () => {
    expect(adjustmentForNewMemo({ ...memo, status: "deleted" })).toEqual([]);
  });

  it("moves one unit between columns on a status change", () => {
    expect(
      adjustmentForMemoTransition(
        { ...memo, status: "normal" },
        { ...memo, status: "archived" },
      ),
    ).toEqual([
      {
        userId: "u1",
        utcHour: "2026-01-31T09",
        deltas: { normal: -1, archived: 1, trashed: 0 },
      },
    ]);
  });

  it("debits without crediting when a memo enters the deleted state", () => {
    expect(
      adjustmentForMemoTransition(
        { ...memo, status: "normal" },
        { ...memo, status: "deleted" },
      ),
    ).toEqual([
      {
        userId: "u1",
        utcHour: "2026-01-31T09",
        deltas: { normal: -1, archived: 0, trashed: 0 },
      },
    ]);
  });

  it("is empty when nothing that the counter tracks changed", () => {
    // A plain content edit is the overwhelmingly common write; it must not
    // emit a statement at all.
    expect(
      adjustmentForMemoTransition(
        { ...memo, status: "normal" },
        { ...memo, status: "normal" },
      ),
    ).toEqual([]);
  });

  it("moves the unit between hour buckets when created_at changes", () => {
    const adjustments = adjustmentForMemoTransition(
      { ...memo, status: "normal" },
      { ...memo, createdAt: "2026-02-01T09:00:00.000Z", status: "normal" },
    );
    expect(adjustments).toHaveLength(2);
    expect(adjustments).toContainEqual({
      userId: "u1",
      utcHour: "2026-01-31T09",
      deltas: { normal: -1, archived: 0, trashed: 0 },
    });
    expect(adjustments).toContainEqual({
      userId: "u1",
      utcHour: "2026-02-01T09",
      deltas: { normal: 1, archived: 0, trashed: 0 },
    });
  });

  it("moves the unit between authors on reassignment", () => {
    const adjustments = adjustmentForMemoTransition(
      { ...memo, status: "normal" },
      { ...memo, userId: "u2", status: "normal" },
    );
    expect(adjustments).toContainEqual({
      userId: "u1",
      utcHour: "2026-01-31T09",
      deltas: { normal: -1, archived: 0, trashed: 0 },
    });
    expect(adjustments).toContainEqual({
      userId: "u2",
      utcHour: "2026-01-31T09",
      deltas: { normal: 1, archived: 0, trashed: 0 },
    });
  });
});

describe("counter maintenance through the write paths", () => {
  it("agrees with a live scan after creates, status moves, and a hard delete", async () => {
    const first = await createMemo(db, owner, {
      content: "memo 0",
      visibility: "private",
      source: "web",
    });
    const second = await createMemo(db, owner, {
      content: "memo 1",
      visibility: "private",
      source: "web",
    });
    const third = await createMemo(db, owner, {
      content: "memo 2",
      visibility: "private",
      source: "web",
    });
    await updateMemo(db, owner, second.id, { status: "archived" });
    await updateMemo(db, owner, third.id, { status: "trashed" });
    await hardDeleteMemo(db, owner, first.id);

    expect(await readHourlyCountTotals(db, owner.id)).toEqual(
      await liveTotals(owner.id),
    );
  });

  it("leaves the counter untouched for a content-only edit", async () => {
    const memo = await createMemo(db, owner, {
      content: "before",
      visibility: "private",
      source: "web",
    });
    const before = await readHourlyCountTotals(db, owner.id);
    await updateMemo(db, owner, memo.id, { content: "after" });
    expect(await readHourlyCountTotals(db, owner.id)).toEqual(before);
    expect(await liveTotals(owner.id)).toEqual({
      normal: 1,
      archived: 0,
      trashed: 0,
      activeDays: 1,
    });
  });

  it("keeps counts correct across a restore from trash", async () => {
    const memo = await createMemo(db, owner, {
      content: "recyclable",
      visibility: "private",
      source: "web",
    });
    await updateMemo(db, owner, memo.id, { status: "trashed" });
    expect((await readHourlyCountTotals(db, owner.id)).trashed).toBe(1);
    await updateMemo(db, owner, memo.id, { status: "normal" });
    const totals = await readHourlyCountTotals(db, owner.id);
    expect(totals).toEqual(await liveTotals(owner.id));
    expect(totals.normal).toBe(1);
    expect(totals.trashed).toBe(0);
  });

  it("never lets a counter go negative", async () => {
    // A stray debit (a retried statement, a half-applied migration) must not
    // surface as a negative number in the heatmap. Issued directly because the
    // public write paths cannot produce one: a second hard delete of the same
    // memo is rejected as not-found before any counter statement is built.
    await applyStrayAdjustments([
      {
        userId: owner.id,
        utcHour: "2026-01-01T00",
        deltas: { normal: -5, archived: 0, trashed: 0 },
      },
    ]);
    expect(await readHourlyCountTotals(db, owner.id)).toEqual({
      normal: 0,
      archived: 0,
      trashed: 0,
      activeDays: 0,
    });

    // A credit on top of the floored row still lands correctly.
    await applyStrayAdjustments([
      {
        userId: owner.id,
        utcHour: "2026-01-01T00",
        deltas: { normal: 2, archived: 0, trashed: 0 },
      },
    ]);
    expect((await readHourlyCountTotals(db, owner.id)).normal).toBe(2);
  });
});

describe("comments stay out of the counter", () => {
  // A comment lives under its parent memo and is not a record of its own:
  // the stats, heatmap and streak leave it out. Every path that could move
  // the counter for a comment (create, trash, restore, hard delete, the
  // nightly rebuild) must skip it, or a debit without a credit would let the
  // `max(0, …)` floor eat a real memo's count.

  it("does not credit a comment on creation", async () => {
    const parent = await createMemo(db, owner, {
      content: "parent",
      visibility: "private",
      source: "web",
    });
    const before = await readHourlyCountTotals(db, owner.id);

    await createMemoComment(db, owner, parent.id, { content: "a comment" });
    await createMemoComment(db, owner, parent.id, {
      content: "tagged comment #insight",
    });

    const after = await readHourlyCountTotals(db, owner.id);
    expect(after).toEqual(before);
    expect(after).toEqual(await liveTotals(owner.id));
  });

  it("keeps the parent's count through a comment's trash and restore", async () => {
    const parent = await createMemo(db, owner, {
      content: "parent",
      visibility: "private",
      source: "web",
    });
    const comment = await createMemoComment(db, owner, parent.id, {
      content: "a comment",
    });

    await updateMemo(db, owner, comment.id, { status: "trashed" });
    expect(await readHourlyCountTotals(db, owner.id)).toMatchObject({
      normal: 1,
      trashed: 0,
    });
    await updateMemo(db, owner, comment.id, { status: "normal" });

    const totals = await readHourlyCountTotals(db, owner.id);
    expect(totals).toEqual(await liveTotals(owner.id));
    expect(totals).toMatchObject({ normal: 1, trashed: 0 });
  });

  it("removes a hard-deleted comment without disturbing the parent", async () => {
    const parent = await createMemo(db, owner, {
      content: "parent",
      visibility: "private",
      source: "web",
    });
    const comment = await createMemoComment(db, owner, parent.id, {
      content: "a comment",
    });

    await hardDeleteMemo(db, owner, comment.id);

    const totals = await readHourlyCountTotals(db, owner.id);
    expect(totals).toEqual(await liveTotals(owner.id));
    expect(totals.normal).toBe(1);
  });

  it("survives a mixed sequence of memos and comments", async () => {
    const parent = await createMemo(db, owner, {
      content: "parent",
      visibility: "private",
      source: "web",
    });
    const second = await createMemo(db, owner, {
      content: "second",
      visibility: "private",
      source: "web",
    });
    const comment = await createMemoComment(db, owner, parent.id, {
      content: "a comment",
    });
    await updateMemo(db, owner, second.id, { status: "archived" });
    await updateMemo(db, owner, comment.id, { status: "trashed" });

    const totals = await readHourlyCountTotals(db, owner.id);
    expect(totals).toEqual(await liveTotals(owner.id));
    expect(totals).toMatchObject({ normal: 1, archived: 1, trashed: 0 });
  });

  it("agrees with getMemoStats and with a rebuild", async () => {
    const parent = await createMemo(db, owner, {
      content: "parent",
      visibility: "private",
      source: "web",
    });
    await createMemoComment(db, owner, parent.id, { content: "a comment" });

    const stats = await getMemoStats(db, owner, { time_zone: "UTC" });
    const live = await liveTotals(owner.id);
    expect(stats.counts.normal).toBe(1);
    expect(stats.counts.total).toBe(live.normal + live.archived);
    expect(stats.active_days).toBe(live.activeDays);

    await recalibrateAllHourlyCounts(db, new Date().toISOString());
    expect(await readHourlyCountTotals(db, owner.id)).toMatchObject({
      normal: 1,
    });
  });
});

describe("getMemoStats own-corpus read path", () => {
  it("reproduces the live counts and active_days", async () => {
    await seedMemo({ id: "a", createdAt: "2026-01-05T10:00:00.000Z" });
    await seedMemo({ id: "b", createdAt: "2026-01-05T11:00:00.000Z" });
    await seedMemo({ id: "c", createdAt: "2026-01-06T11:00:00.000Z" });
    await seedMemo({
      id: "d",
      createdAt: "2026-01-07T11:00:00.000Z",
      status: "archived",
    });
    await seedMemo({
      id: "e",
      createdAt: "2026-01-08T11:00:00.000Z",
      status: "trashed",
    });
    await recalibrateAllHourlyCounts(db, new Date().toISOString());

    const stats = await getMemoStats(db, owner, { time_zone: "UTC" });
    expect(stats.counts).toEqual({
      normal: 3,
      archived: 1,
      trashed: 1,
      total: 4,
    });
    // distinct UTC creation dates holding a normal or archived memo: the 5th,
    // 6th, and 7th. The trashed memo's day does not count.
    expect(stats.active_days).toBe(3);
  });

  it("re-buckets one row onto different local dates per time zone", async () => {
    // Late-evening UTC on the previous day: the same instant is "yesterday" in
    // UTC and "today" in Tokyo, so the assertion cannot pass by coincidence
    // whichever day the suite happens to run.
    const instant = new Date(Date.now() - 24 * 60 * 60 * 1000);
    instant.setUTCHours(23, 30, 0, 0);
    const utcDay = createDateKeyFormatter("UTC")(instant);
    const tokyoDay = createDateKeyFormatter("Asia/Tokyo")(instant);
    expect(tokyoDay).not.toBe(utcDay);

    await seedMemo({ id: "late", createdAt: instant.toISOString() });
    await recalibrateAllHourlyCounts(db, new Date().toISOString());

    const countOn = (
      stats: { activity: { date: string; count: number }[] },
      date: string,
    ) => stats.activity.find((day) => day.date === date)?.count ?? 0;

    const utc = await getMemoStats(db, owner, { time_zone: "UTC", days: 10 });
    expect(countOn(utc, utcDay)).toBe(1);
    expect(countOn(utc, tokyoDay)).toBe(0);

    const tokyo = await getMemoStats(db, owner, {
      time_zone: "Asia/Tokyo",
      days: 10,
    });
    expect(countOn(tokyo, tokyoDay)).toBe(1);
    expect(countOn(tokyo, utcDay)).toBe(0);
  });

  it("honors the requested window length", async () => {
    const short = await getMemoStats(db, owner, { time_zone: "UTC" });
    expect(short.activity).toHaveLength(84);
    const year = await getMemoStats(db, owner, { time_zone: "UTC", days: 366 });
    expect(year.activity).toHaveLength(366);
  });

  it("returns counts for memos older than the window", async () => {
    // The old implementation pulled a 90-day raw-row window for `activity`
    // while `counts` scanned everything, so a long-dormant account showed an
    // empty heatmap and a real total. The counter serves both from all-time
    // rows, independent of the window.
    await seedMemo({ id: "ancient", createdAt: "2021-03-04T09:00:00.000Z" });
    await recalibrateAllHourlyCounts(db, new Date().toISOString());
    const stats = await getMemoStats(db, owner, { time_zone: "UTC" });
    expect(stats.counts.total).toBe(1);
    expect(stats.active_days).toBe(1);
    expect(stats.activity.every((day) => day.count === 0)).toBe(true);
  });

  it("clamps an out-of-range window instead of trusting the caller", async () => {
    const stats = await getMemoStats(db, owner, {
      time_zone: "UTC",
      days: 100_000,
    });
    expect(stats.activity).toHaveLength(366);
  });

  it("falls back to the default window on a non-finite value", async () => {
    // Math.min/Math.max both propagate NaN, which would then reach
    // `toISOString()` as an Invalid Date and throw — a bad argument turning into
    // a 500 instead of a served window.
    const stats = await getMemoStats(db, owner, {
      time_zone: "UTC",
      days: Number.NaN,
    });
    expect(stats.activity).toHaveLength(84);
  });
});

describe("recalibration", () => {
  it("rebuilds after a bundle import that bypasses the write paths", async () => {
    // `importData` inserts `memos` directly and rewrites `created_at` on the
    // overwrite branch, so it moves memos between UTC hour buckets without
    // emitting a single counter statement. Backfilling history is exactly the
    // workload this counter exists to make cheap, so it has to land correctly.
    const result = await importData(
      db,
      owner,
      // Parsed rather than hand-built: `importData` expects a bundle that has
      // already been through the contract schema, which is what supplies the
      // empty collections it iterates.
      importBundleSchema.parse({
        version: 5,
        memos: [
          {
            name: "memos/imported-a",
            content: "imported a",
            visibility: "private",
            state: "normal",
            pinned: false,
            payload: {},
            create_time: "2019-09-20T20:43:00.000Z",
          },
          {
            name: "memos/imported-b",
            content: "imported b",
            visibility: "private",
            state: "archived",
            pinned: false,
            payload: {},
            create_time: "2021-01-02T03:04:00.000Z",
          },
          {
            name: "memos/imported-c",
            content: "imported c",
            visibility: "private",
            state: "trashed",
            pinned: false,
            payload: {},
            create_time: "2022-06-07T08:09:00.000Z",
          },
        ],
      }),
    );
    expect(result.imported_memos).toBe(3);
    expect(await readHourlyCountTotals(db, owner.id)).toEqual(
      await liveTotals(owner.id),
    );

    const stats = await getMemoStats(db, owner, { time_zone: "UTC" });
    expect(stats.counts).toEqual({
      normal: 1,
      archived: 1,
      trashed: 1,
      total: 2,
    });
    expect(stats.active_days).toBe(2);
  });

  it("repairs a counter that drifted away from memos", async () => {
    const memo = await createMemo(db, owner, {
      content: "drifty",
      visibility: "private",
      source: "web",
    });
    await updateMemo(db, owner, memo.id, { status: "archived" });
    expect((await readHourlyCountTotals(db, owner.id)).normal).toBe(0);

    // Simulate a write that never reached the counter.
    await db.insert(memos).values({
      id: "ghost",
      userId: owner.id,
      content: "inserted behind the counter's back",
      visibility: "private",
      status: "normal",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await recalibrateAllHourlyCounts(db, new Date().toISOString());
    expect(await readHourlyCountTotals(db, owner.id)).toEqual(
      await liveTotals(owner.id),
    );
  });

  it("rebuilds a user whose counter spans more than one insert chunk", async () => {
    // D1 caps a query at 100 bound parameters and each counter row binds six,
    // so the rebuild has to chunk at 16 rows. An earlier chunk size of 200
    // looked safe but overflowed the moment a user had more than 16 active
    // UTC hours — which is every instance with any history at all. The throw
    // happened before the sweep, so the nightly job failed *and* left the
    // counter unrepaired. The other tests here seed a handful of memos and
    // never crossed the boundary, which is why this went unnoticed.
    const HOURS = 40;
    for (let hour = 0; hour < HOURS; hour += 1) {
      // Distinct UTC hours, spread across days — the bucket count has to equal
      // the memo count or the test never crosses the chunk boundary.
      const createdAt = new Date(
        Date.UTC(2026, 0, 1 + Math.floor(hour / 24), hour % 24, 0, 0),
      ).toISOString();
      await seedMemo({
        id: `memos/chunky-${String(hour).padStart(3, "0")}`,
        createdAt,
      });
    }

    await recalibrateAllHourlyCounts(db, new Date().toISOString());

    // Assert the premise, not just the outcome: if the seed ever collapses
    // into fewer buckets this test would silently stop covering the boundary
    // it exists to guard.
    const bucketCount = await db
      .select({ c: sql<number>`count(*)`.mapWith(Number) })
      .from(memoHourlyCounts)
      .get();
    expect(bucketCount?.c).toBe(HOURS);

    const totals = await readHourlyCountTotals(db, owner.id);
    expect(totals).toEqual(await liveTotals(owner.id));
    expect(totals.normal).toBe(HOURS);
  });

  it("drops tombstones left by a fully drained bucket", async () => {
    const memo = await createMemo(db, owner, {
      content: "temporary",
      visibility: "private",
      source: "web",
    });
    await updateMemo(db, owner, memo.id, { status: "trashed" });
    await hardDeleteMemo(db, owner, memo.id);
    await pruneEmptyHourlyCountRows(db);
    const totals = await readHourlyCountTotals(db, owner.id);
    expect(totals).toEqual({
      normal: 0,
      archived: 0,
      trashed: 0,
      activeDays: 0,
    });
  });
});

describe("read-side window helpers", () => {
  it("pads the UTC hour range past both ends of the local window", () => {
    const { fromHour, toHour } = hourRangeForLocalWindow("2026-03-10", 1);
    // A single local day cannot need fewer than its own 24 buckets plus the
    // widest zone offsets on both sides.
    expect(fromHour < "2026-03-10").toBe(true);
    expect(toHour > "2026-03-10").toBe(true);
  });

  it("maps an hour bucket to the local date containing its end", () => {
    const utc = createDateKeyFormatter("UTC");
    const tokyo = createDateKeyFormatter("Asia/Tokyo");
    expect(localDateOfUtcHour("2026-01-05T14", utc)).toBe("2026-01-05");
    // 14:00-14:59 UTC is 23:00-23:59 the same day in Tokyo (+9).
    expect(localDateOfUtcHour("2026-01-05T14", tokyo)).toBe("2026-01-05");
    // 15:00-15:59 UTC crosses into the next Tokyo day.
    expect(localDateOfUtcHour("2026-01-05T15", tokyo)).toBe("2026-01-06");
  });
});
