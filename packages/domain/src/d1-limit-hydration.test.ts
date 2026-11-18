import {
  applyFlaremoMigrations,
  attachments,
  createDb,
  memoRelations,
  memos,
  reactions,
  tasks,
  users,
} from "@flaremo/db";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finalizeAttachmentCleanupForIds } from "./attachments-lifecycle";
import {
  listAttachments,
  listAttachmentsForMemosForViewer,
} from "./attachments-list";
import { ValidationError } from "./errors";
import { getMemoContextData } from "./memo-context";
import { syncTasksFromMemoLines } from "./memo-task-sync";
import { listReactionsForMemosForViewer } from "./memos-reactions";
import { getWalkNextMemo } from "./review";
import type { TeamViewer } from "./team-permissions";
import { ensureTeamOwner } from "./test-support";
import { getFlaremoUserNames } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let owner: TeamViewer;

beforeEach(async () => {
  mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: `d1-limit-${Math.random()}` },
  });
  const database = await mf.getD1Database("DB");
  db = createDb(database);
  await applyFlaremoMigrations(database);
  owner = await ensureTeamOwner(db);
});

afterEach(async () => {
  await mf.dispose();
});

const now = "2026-01-01T00:00:00.000Z";

function memoRow(index: number) {
  return {
    id: `memos/d1-limit-${index}`,
    userId: owner.id,
    content: `note ${index}`,
    visibility: "private" as const,
    status: "normal" as const,
    createdAt: now,
    updatedAt: now,
  };
}

function attachmentRow(index: number) {
  return {
    id: `attachments/d1-limit-${index}`,
    userId: owner.id,
    memoId: `memos/d1-limit-${index}`,
    r2Key: `imports/d1-limit/${index}`,
    filename: `${index}.txt`,
    contentType: "text/plain",
    size: 1,
    state: "ready" as const,
    etag: null,
    payload: {},
    createdAt: now,
    updatedAt: now,
  };
}

function reactionRow(index: number) {
  return {
    id: `reactions/d1-limit-${index}`,
    creatorId: owner.id,
    contentId: `memos/d1-limit-${index}`,
    reactionType: "thumbsup",
    createdAt: now,
  };
}

describe("D1 per-statement parameter cap", () => {
  it("hydrates a full 100-memo page of attachments and reactions", async () => {
    // Batched inserts keep each test statement under the same 100-parameter
    // cap the production code is protecting against.
    for (let offset = 0; offset < 100; offset += 8) {
      await db
        .insert(memos)
        .values(Array.from({ length: 8 }, (_, i) => memoRow(offset + i)));
    }
    for (let offset = 0; offset < 100; offset += 6) {
      await db
        .insert(attachments)
        .values(Array.from({ length: 6 }, (_, i) => attachmentRow(offset + i)));
    }
    for (let offset = 0; offset < 100; offset += 10) {
      await db
        .insert(reactions)
        .values(Array.from({ length: 10 }, (_, i) => reactionRow(offset + i)));
    }

    const ids = Array.from({ length: 100 }, (_, i) => `memos/d1-limit-${i}`);
    const rows = await listAttachmentsForMemosForViewer(db, owner, ids);
    expect(rows).toHaveLength(100);

    const reactionRows = await listReactionsForMemosForViewer(db, owner, ids);
    expect(reactionRows).toHaveLength(100);
  });

  it("chunks user name lookups, attachment finalization, memo context, random walk, and task line sync past 100 items", async () => {
    const count = 130;
    for (let offset = 0; offset < count; offset += 10) {
      await db.insert(users).values(
        Array.from({ length: Math.min(10, count - offset) }, (_, i) => ({
          id: `users/u-${offset + i}`,
          email: `u-${offset + i}@example.com`,
          name: `User ${offset + i}`,
          status: "active" as const,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    const names = await getFlaremoUserNames(
      db,
      Array.from({ length: count }, (_, i) => `users/u-${i}`),
    );
    expect(names.size).toBe(count);

    await db.insert(memos).values(memoRow(999));
    for (let offset = 0; offset < count; offset += 8) {
      const size = Math.min(8, count - offset);
      await db
        .insert(memos)
        .values(Array.from({ length: size }, (_, i) => memoRow(offset + i)));
    }
    for (let offset = 0; offset < count; offset += 20) {
      const size = Math.min(20, count - offset);
      await db.insert(memoRelations).values(
        Array.from({ length: size }, (_, i) => ({
          memoId: "memos/d1-limit-999",
          relatedMemoId: `memos/d1-limit-${offset + i}`,
          type: "reference" as const,
          createdAt: now,
        })),
      );
    }

    const context = await getMemoContextData(db, owner, "memos/d1-limit-999");
    expect(context.relations).toHaveLength(count);

    const walked = await getWalkNextMemo(db, owner, "memos/d1-limit-999");
    expect(walked.via).toEqual({ type: "relation" });
    expect(walked.memo?.id).toMatch(/^memos\/d1-limit-/);

    for (let offset = 0; offset < count; offset += 6) {
      const size = Math.min(6, count - offset);
      await db.insert(tasks).values(
        Array.from({ length: size }, (_, i) => ({
          id: `tasks/t-${offset + i}`,
          userId: owner.id,
          sourceMemoId: "memos/d1-limit-999",
          title: `item-${offset + i}`,
          status: "todo" as const,
          priority: "medium" as const,
          sortOrder: offset + i,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    const previousContent = Array.from(
      { length: count },
      (_, i) => `- [ ] item-${i}`,
    ).join("\n");
    const nextContent = Array.from(
      { length: count },
      (_, i) => `- [x] item-${i}`,
    ).join("\n");
    await syncTasksFromMemoLines(db, {
      userId: owner.id,
      memoId: "memos/d1-limit-999",
      previousContent,
      nextContent,
      now,
    });
    const completedTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.status, "done"));
    expect(completedTasks).toHaveLength(count);

    for (let offset = 0; offset < count; offset += 6) {
      const size = Math.min(6, count - offset);
      await db
        .insert(attachments)
        .values(
          Array.from({ length: size }, (_, i) => attachmentRow(offset + i)),
        );
    }
    await finalizeAttachmentCleanupForIds(
      db,
      Array.from({ length: count }, (_, i) => `attachments/d1-limit-${i}`),
    );
    expect(await db.select().from(attachments)).toHaveLength(0);

    await expect(
      listAttachments(db, owner, { pageSize: -1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
