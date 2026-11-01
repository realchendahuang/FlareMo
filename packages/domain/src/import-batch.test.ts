import { importBundleSchema } from "@flaremo/contracts";
import {
  applyFlaremoMigrations,
  attachments,
  createDb,
  memoRelations,
  memos,
  shares,
} from "@flaremo/db";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importData } from "./import-export";
import type { TeamViewer } from "./team-permissions";
import { ensureTeamOwner } from "./test-support";
import { createFlaremoMember } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let owner: TeamViewer;

beforeEach(async () => {
  mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: `import-batch-${Math.random()}` },
  });
  db = createDb(await mf.getD1Database("DB"));
  await applyFlaremoMigrations(await mf.getD1Database("DB"));
  owner = await ensureTeamOwner(db);
});

afterEach(async () => {
  await mf.dispose();
});

describe("importData batching", () => {
  it("imports attachments, relations, shares and projects beyond one D1 statement", async () => {
    const memoCount = 30;
    const memoEntries = Array.from({ length: memoCount }, (_, i) => ({
      name: `memos/m-${i}`,
      content: `content ${i}`,
      visibility: "private" as const,
      state: "normal" as const,
      pinned: false,
      payload: {},
      create_time: "2024-01-01T00:00:00.000Z",
    }));

    // 40 relations = 40 rows x 4 columns: past the per-statement row cap if
    // they were flushed as one multi-row insert.
    const relationEntries = Array.from({ length: 40 }, (_, i) => ({
      memo: `memos/m-${i % memoCount}`,
      related_memo: `memos/m-${(i + 1) % memoCount}`,
      type: "reference" as const,
      create_time: "2024-01-02T00:00:00.000Z",
    }));

    const attachmentEntries = Array.from({ length: 120 }, (_, i) => ({
      name: `attachments/a-${i}`,
      id: `a-${i}`,
      memo: `memos/m-${i % memoCount}`,
      filename: `file-${i}.txt`,
      content_type: "text/plain",
      size: 10,
      etag: null,
      payload: {},
      create_time: "2024-01-03T00:00:00.000Z",
      update_time: "2024-01-03T00:00:00.000Z",
    }));

    const shareEntries = Array.from({ length: 25 }, (_, i) => ({
      name: `shares/s-${i}`,
      id: `s-${i}`,
      token: `tok-${i}`,
      memo: `memos/m-${i}`,
      expires_at: null,
      create_time: "2024-01-04T00:00:00.000Z",
    }));

    const bundle = importBundleSchema.parse({
      version: 5,
      memos: memoEntries,
      relations: relationEntries,
      attachments: attachmentEntries,
      shares: shareEntries,
    });

    const result = await importData(db, owner, bundle, { conflict: "skip" });

    expect(result.imported_memos).toBe(memoCount);
    expect(result.imported_attachments).toBe(120);
    // 40 entries cover only 30 distinct (memo, related) pairs, and
    // `onConflictDoNothing` still reports only the rows actually inserted —
    // the batched path has to preserve that count, not the input length.
    expect(result.imported_relations).toBe(30);
    expect(result.imported_shares).toBe(25);

    expect(await db.select().from(memos)).toHaveLength(memoCount);
    expect(await db.select().from(attachments)).toHaveLength(120);
    expect(await db.select().from(memoRelations)).toHaveLength(30);
    expect(await db.select().from(shares)).toHaveLength(25);
  });

  it("re-importing with overwrite replaces rather than duplicates", async () => {
    const bundle = importBundleSchema.parse({
      version: 5,
      memos: [
        {
          name: "memos/dup",
          content: "first",
          visibility: "private",
          state: "normal",
          pinned: false,
          payload: {},
          create_time: "2024-01-01T00:00:00.000Z",
        },
      ],
      attachments: [
        {
          name: "attachments/dup-a",
          id: "dup-a",
          memo: "memos/dup",
          filename: "a.txt",
          content_type: "text/plain",
          size: 5,
          etag: null,
          payload: {},
          create_time: "2024-01-03T00:00:00.000Z",
          update_time: "2024-01-03T00:00:00.000Z",
        },
      ],
    });
    await importData(db, owner, bundle);
    const second = await importData(db, owner, bundle, {
      conflict: "overwrite",
    });
    expect(second.overwritten_memos).toBe(1);
    expect(
      await db.select().from(memos).where(eq(memos.content, "first")),
    ).toHaveLength(1);
    expect(await db.select().from(attachments)).toHaveLength(1);
  });

  it("refuses ids owned by another account before writing anything", async () => {
    const stranger = await createFlaremoMember(db, {
      email: "stranger@example.com",
      name: "Stranger",
    });
    const now = new Date().toISOString();
    await db.insert(memos).values({
      id: "memos/owned-elsewhere",
      userId: stranger.id,
      content: "not yours",
      createdAt: now,
      updatedAt: now,
    });
    const bundle = importBundleSchema.parse({
      version: 5,
      memos: [
        {
          name: "memos/owned-elsewhere",
          content: "imported copy",
          visibility: "private",
          state: "normal",
          pinned: false,
          payload: {},
          create_time: now,
        },
      ],
    });

    await expect(importData(db, owner, bundle)).rejects.toThrow(
      /owned by another account/,
    );
    expect(
      await db
        .select({ content: memos.content })
        .from(memos)
        .where(eq(memos.id, "memos/owned-elsewhere")),
    ).toEqual([{ content: "not yours" }]);
  });
});
