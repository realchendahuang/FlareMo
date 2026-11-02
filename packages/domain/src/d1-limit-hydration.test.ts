import {
  applyFlaremoMigrations,
  attachments,
  createDb,
  memos,
  reactions,
} from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAttachmentsForMemosForViewer } from "./attachments-list";
import { listReactionsForMemosForViewer } from "./memos-reactions";
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
});
