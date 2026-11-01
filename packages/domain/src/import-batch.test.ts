import { importBundleSchema } from "@flaremo/contracts";
import {
  applyFlaremoMigrations,
  attachments,
  createDb,
  memoRelations,
  memos,
  shares,
  taskActivity,
} from "@flaremo/db";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDataTask, getDataTask, runImportTask } from "./data-tasks";
import {
  exportData,
  finalizeImportTaskAudit,
  importData,
  rollbackImportTask,
} from "./import-export";
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

  it("exports team ids, omits share tokens, and re-mints them on import", async () => {
    const now = new Date().toISOString();
    await db.insert(memos).values({
      id: "memos/team-note",
      userId: owner.id,
      teamId: owner.teamOrganizationId,
      content: "team note",
      visibility: "protected",
      status: "normal",
      pinned: false,
      payload: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(shares).values({
      id: "shares/team-share",
      memoId: "memos/team-note",
      userId: owner.id,
      token: "original-secret-token",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    });

    const bundle = await exportData(db, owner);
    const exportedMemo = bundle.memos.find(
      (memo) => memo.name === "memos/team-note",
    );
    expect(exportedMemo?.team_id).toBe(owner.teamOrganizationId);
    const exportedShare = bundle.shares.find(
      (share) => share.name === "shares/team-share",
    );
    expect(exportedShare).toBeDefined();
    expect(exportedShare).not.toHaveProperty("token");

    await db.delete(shares).where(eq(shares.userId, owner.id));
    await db.delete(memos).where(eq(memos.userId, owner.id));
    await importData(db, owner, bundle, { conflict: "skip" });

    const restored = await db
      .select()
      .from(memos)
      .where(eq(memos.id, "memos/team-note"))
      .get();
    expect(restored?.teamId).toBe(owner.teamOrganizationId);
    expect(restored?.visibility).toBe("protected");
    const restoredShare = await db
      .select()
      .from(shares)
      .where(eq(shares.memoId, "memos/team-note"))
      .get();
    expect(restoredShare?.token).toBeTruthy();
    expect(restoredShare?.token).not.toBe("original-secret-token");
  });

  it("rolls back every row recorded in the import checkpoint", async () => {
    const now = new Date().toISOString();
    const task = await createDataTask(db, owner, { kind: "import" });
    const bundle = importBundleSchema.parse({
      version: 6,
      memos: [
        {
          name: "memos/rollback-me",
          content: "rollback",
          visibility: "private",
          state: "normal",
          pinned: false,
          payload: {},
          create_time: now,
        },
      ],
    });
    await importData(db, owner, bundle, { auditTaskId: task.id });
    expect(
      await db
        .select({ id: memos.id })
        .from(memos)
        .where(eq(memos.id, "memos/rollback-me")),
    ).toHaveLength(1);

    const rolledBack = await rollbackImportTask(db, task.id);
    expect(rolledBack.deleted).toBe(1);
    expect(
      await db
        .select({ id: memos.id })
        .from(memos)
        .where(eq(memos.id, "memos/rollback-me")),
    ).toHaveLength(0);
  });

  it("retrying a task rolls back the interrupted attempt first", async () => {
    const now = new Date().toISOString();
    const task = await createDataTask(db, owner, { kind: "import" });
    const bundle = importBundleSchema.parse({
      version: 6,
      memos: [
        {
          name: "memos/retry-once",
          content: "retry",
          visibility: "private",
          state: "normal",
          pinned: false,
          payload: {},
          create_time: now,
        },
      ],
    });
    // Simulate a worker killed after the first insert but before the task row
    // was completed: the ledger and its memo are still there.
    await importData(db, owner, bundle, { auditTaskId: task.id });
    expect(
      await db
        .select({ id: memos.id })
        .from(memos)
        .where(eq(memos.id, "memos/retry-once")),
    ).toHaveLength(1);

    const result = await runImportTask(db, owner, task.id, bundle, {
      conflict: "duplicate",
    });
    expect(result.imported_memos).toBe(1);
    // The partial row was removed, so duplicate mode did not produce a twin.
    expect(
      await db
        .select({ id: memos.id })
        .from(memos)
        .where(eq(memos.id, "memos/retry-once")),
    ).toHaveLength(1);
    expect((await getDataTask(db, owner, task.id)).status).toBe("succeeded");
  });

  it("strips the rollback marker from imported task activity on success", async () => {
    const now = new Date().toISOString();
    const task = await createDataTask(db, owner, { kind: "import" });
    const bundle = importBundleSchema.parse({
      version: 6,
      memos: [],
      attachments: [],
      relations: [],
      shares: [],
      projects: [],
      tasks: [
        {
          name: "tasks/audit-task",
          project_id: null,
          source_memo_id: null,
          title: "audited",
          notes: null,
          status: "todo",
          priority: "none",
          due_at: null,
          sort_order: 0,
          completed_at: null,
          deleted_at: null,
          created_at: now,
          updated_at: now,
        },
      ],
      task_activity: [
        {
          task_id: "tasks/audit-task",
          actor_type: "user",
          actor_name: null,
          action: "created",
          changes: { title: "audited" },
          created_at: now,
        },
      ],
    });
    await importData(db, owner, bundle, { auditTaskId: task.id });
    const [marked] = await db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.userId, owner.id));
    expect(marked?.changes).toMatchObject({
      title: "audited",
      __import_task_id: task.id,
    });

    await finalizeImportTaskAudit(db, task.id, owner.id);
    const [cleaned] = await db
      .select()
      .from(taskActivity)
      .where(eq(taskActivity.userId, owner.id));
    expect(cleaned?.changes).toMatchObject({ title: "audited" });
    expect(cleaned?.changes).not.toHaveProperty("__import_task_id");
  });
});
