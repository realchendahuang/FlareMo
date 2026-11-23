import { applyFlaremoMigrations, createDb, memos } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildTodayReview,
  buildTodayReviewSummary,
  markReviewMemo,
} from "./review-deck";
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
    d1Databases: { DB: `review-deck-${Math.random()}` },
  });
  const database = await mf.getD1Database("DB");
  db = createDb(database);
  await applyFlaremoMigrations(database);
  owner = await ensureTeamOwner(db);
});

afterEach(async () => {
  await mf.dispose();
});

const TODAY = "2026-03-15";

function memoRow(id: string, createdAt: string) {
  return {
    id,
    userId: owner.id,
    content: `note ${id}`,
    visibility: "private" as const,
    status: "normal" as const,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("buildTodayReviewSummary", () => {
  it("counts the same deck the review page renders", async () => {
    await db
      .insert(memos)
      .values([
        memoRow("memos/review-today", "2026-03-15T10:00:00.000Z"),
        memoRow("memos/review-band", "2026-03-12T10:00:00.000Z"),
        memoRow("memos/review-year", "2025-03-15T10:00:00.000Z"),
      ]);

    const deck = await buildTodayReview(db, owner, { date: TODAY });
    const summary = await buildTodayReviewSummary(db, owner, { date: TODAY });

    expect(deck.length).toBeGreaterThanOrEqual(2);
    expect(summary.total).toBe(deck.length);
    expect(summary.reviewed).toBe(0);
    expect(summary.remaining).toBe(deck.length);

    const first = deck[0];
    if (!first) throw new Error("review deck is empty");
    await markReviewMemo(db, owner, {
      memoId: first.memo.id,
      date: TODAY,
      action: "reviewed",
    });

    const after = await buildTodayReviewSummary(db, owner, { date: TODAY });
    expect(after.reviewed).toBe(1);
    expect(after.remaining).toBe(after.total - 1);
  });
});
