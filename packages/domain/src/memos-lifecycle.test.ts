import type { UserRow } from "@flaremo/db";
import {
  applyFlaremoMigrations,
  attachments,
  createDb,
  memoRelations,
  memos,
} from "@flaremo/db";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindMemoAttachments } from "./attachments-lifecycle";
import { d1IdsPerRepeatedBinding } from "./d1-limits";
import { createMemo } from "./memos";
import { createMemoComment } from "./memos-comments";
import { hardDeleteMemo } from "./memos-lifecycle";
import { getAttachmentStorageBytes } from "./quotas";
import { listMemoRelationsForMemosForViewer } from "./relations";
import { ensureSingleUser } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let owner: UserRow;

beforeEach(async () => {
  mf = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "flaremo-lifecycle-test" },
  });
  const database = await mf.getD1Database("DB");
  db = createDb(database);
  await applyFlaremoMigrations(database);
  owner = await ensureSingleUser(db, {
    email: "owner@example.com",
    name: "Owner",
  });
});

afterEach(async () => {
  await mf.dispose();
});

async function insertMemo(id: string, createdAt = new Date().toISOString()) {
  await db.insert(memos).values({
    id,
    userId: owner.id,
    content: id,
    createdAt,
    updatedAt: createdAt,
  });
}

describe("hardDeleteMemo", () => {
  it("removes comment replies instead of promoting them", async () => {
    const parent = await createMemo(db, owner, {
      content: "parent",
      visibility: "private",
      source: "web",
    });
    const comment = await createMemoComment(db, owner, parent.id, {
      content: "reply",
    });
    const nested = await createMemoComment(db, owner, comment.id, {
      content: "nested reply",
    });
    await db.insert(attachments).values({
      id: "attachments/comment-file",
      userId: owner.id,
      memoId: comment.id,
      r2Key: "r2/comment-file",
      filename: "comment.png",
      size: 10,
      thumbnailSize: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await hardDeleteMemo(db, owner, parent.id);

    const remaining = await db.select({ id: memos.id }).from(memos);
    expect(remaining.map((row) => row.id)).toEqual([]);
    expect(await db.select().from(memoRelations)).toEqual([]);
    const [attachment] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, "attachments/comment-file"));
    expect(attachment?.state).toBe("deleting");
    // The nested reply is a real row that was part of the tree, not an
    // artifact of the relation cascade.
    expect(nested.id).not.toBe(comment.id);
  });
});

describe("D1 parameter budgeting", () => {
  it("halves the chunk for a two-sided binding", () => {
    expect(d1IdsPerRepeatedBinding(2)).toBe(48);
    expect(d1IdsPerRepeatedBinding(1)).toBe(96);
  });

  it("binds the contract's maximum attachment list", async () => {
    const memo = await createMemo(db, owner, {
      content: "with attachments",
      visibility: "private",
      source: "web",
    });
    const names = Array.from(
      { length: 100 },
      (_, index) => `attachments/a${index}`,
    );
    const now = new Date().toISOString();
    for (let offset = 0; offset < names.length; offset += 10) {
      await db.insert(attachments).values(
        names.slice(offset, offset + 10).map((name) => ({
          id: name,
          userId: owner.id,
          r2Key: `r2/${name}`,
          filename: "file.bin",
          size: 1,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    const bound = await bindMemoAttachments(db, owner, memo.id, names);
    expect(bound).toHaveLength(100);
  });

  it("counts preview bytes against attachment storage", async () => {
    const now = new Date().toISOString();
    await db.insert(attachments).values({
      id: "attachments/with-preview",
      userId: owner.id,
      r2Key: "r2/with-preview",
      filename: "photo.jpg",
      size: 1000,
      thumbnailSize: 250,
      createdAt: now,
      updatedAt: now,
    });
    expect(await getAttachmentStorageBytes(db, owner.id)).toBe(1250);
  });

  it("reads more memo ids than a single statement can bind", async () => {
    const parent = await createMemo(db, owner, {
      content: "parent",
      visibility: "private",
      source: "web",
    });
    const childIds = Array.from(
      { length: 60 },
      (_, index) => `memos/child-${index}`,
    );
    for (const id of childIds) await insertMemo(id);
    const now = new Date().toISOString();
    for (let offset = 0; offset < childIds.length; offset += 10) {
      await db.insert(memoRelations).values(
        childIds.slice(offset, offset + 10).map((id) => ({
          memoId: parent.id,
          relatedMemoId: id,
          type: "reference" as const,
          createdAt: now,
        })),
      );
    }

    const grouped = await listMemoRelationsForMemosForViewer(db, owner, [
      parent.id,
      ...childIds,
    ]);
    expect(grouped.get(parent.id)).toHaveLength(60);
  });
});
