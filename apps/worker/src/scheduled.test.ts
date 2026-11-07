import {
  applyFlaremoMigrations,
  attachments,
  createDb,
  dataTasks,
  memberRemovalJobs,
  memos,
  memosNotifications,
  pushSubscriptions,
} from "@flaremo/db";
import {
  createDataTask,
  createMemberRemovalJob,
  createMemo,
  createProject,
  createResourceId,
  createTask,
  ensureSingleUser,
  moveMemoToTrash,
  type PushPayload,
  pushNotificationToUser,
  type TeamViewer,
} from "@flaremo/domain";
import { eq } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlareMoEnv } from "./env";
import { runQueuedJobs, runScheduledMaintenance } from "./index";

const NOW = Date.parse("2026-09-15T03:00:00.000Z");

vi.mock("@flaremo/domain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flaremo/domain")>();
  // The default no-op resolves with the same stats shape as the real
  // function; scheduled-tasks aggregates every delivery attempt.
  return {
    ...actual,
    pushNotificationToUser: vi.fn(async () => ({
      attempted: 0,
      delivered: 0,
      failed: 0,
      failureCategories: {
        endpoint_expired: 0,
        http_4xx: 0,
        http_5xx: 0,
        network_error: 0,
        crypto_error: 0,
        payload_error: 0,
        unknown: 0,
      },
    })),
  };
});

/** Minimal R2 bucket double covering the maintenance surface: delete + list. */
class FakeR2Bucket {
  objects = new Set<string>();
  deletedKeys: string[][] = [];
  listPrefixes: string[] = [];
  failPut = false;
  failDelete = false;

  async put(key: string) {
    if (this.failPut) throw new Error("R2 put failed");
    this.objects.add(key);
  }

  async delete(keys: string | string[]) {
    if (this.failDelete) throw new Error("R2 delete failed");
    const list = Array.isArray(keys) ? keys : [keys];
    this.deletedKeys.push(list);
    for (const key of list) this.objects.delete(key);
  }
  async list(options: { prefix?: string; cursor?: string }) {
    const prefix = options.prefix ?? "";
    this.listPrefixes.push(prefix);
    return {
      objects: [...this.objects]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key })),
      truncated: false,
      cursor: undefined,
    };
  }
}

async function insertAttachment(
  db: ReturnType<typeof createDb>,
  userId: string,
  fields: { memoId?: string | null; createdAt: string },
) {
  const id = createResourceId("attachments");
  await db.insert(attachments).values({
    id,
    userId,
    memoId: fields.memoId ?? null,
    r2Key: `${id}/clip.bin`,
    filename: "clip.bin",
    contentType: "application/octet-stream",
    size: 10,
    state: "ready",
    createdAt: fields.createdAt,
    updatedAt: fields.createdAt,
  });
  return id;
}

describe("scheduled maintenance", () => {
  let mf: Miniflare;
  let db: ReturnType<typeof createDb>;
  let r2: FakeR2Bucket;
  let user: TeamViewer;
  let env: FlareMoEnv;

  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-scheduled-test" },
    });
    const database = await mf.getD1Database("DB");
    db = createDb(database);
    await applyFlaremoMigrations(database);
    user = (await ensureSingleUser(db, {
      email: "owner@example.com",
      name: "Owner",
    })) as TeamViewer;
    r2 = new FakeR2Bucket();
    env = {
      DB: database,
      ATTACHMENTS: r2,
      FLAREMO_EMBEDDING_PROVIDER: "none",
      // Non-empty keys open the web-push branch; the pushNotificationToUser
      // mock keeps the tests off the real crypto path.
      FLAREMO_VAPID_PUBLIC_KEY: "test-public-key",
      FLAREMO_VAPID_PRIVATE_KEY: "test-private-key",
    } as unknown as FlareMoEnv;
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("runs only message-selected jobs in the Queue path", async () => {
    const queued = await createDataTask(db, user, { kind: "export" });
    const cronOnly = await createDataTask(db, user, { kind: "export" });
    await db
      .update(dataTasks)
      .set({ createdAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(dataTasks.id, cronOnly.id));

    await runQueuedJobs(env, {
      removalJobIds: [],
      exportTaskIds: [queued.id],
    });

    const queuedAfter = await db
      .select()
      .from(dataTasks)
      .where(eq(dataTasks.id, queued.id))
      .get();
    const cronOnlyAfter = await db
      .select()
      .from(dataTasks)
      .where(eq(dataTasks.id, cronOnly.id))
      .get();
    expect(queuedAfter?.status).toBe("succeeded");
    // Full cron maintenance would delete this row by its old created_at;
    // Queue delivery must leave unrelated maintenance work untouched.
    expect(cronOnlyAfter?.id).toBe(cronOnly.id);
  });

  it("requeues Queue failures and keeps cron recovery available", async () => {
    const failed = await createDataTask(db, user, { kind: "export" });
    r2.failPut = true;

    // Failures #1 and #2 are retryable. The queue path throws so Cloudflare
    // redelivers, while the row remains claimable by the cron reconciler.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await expect(
        runQueuedJobs(env, {
          removalJobIds: [],
          exportTaskIds: [failed.id],
        }),
      ).rejects.toThrow("R2 put failed");
      expect(
        await db
          .select()
          .from(dataTasks)
          .where(eq(dataTasks.id, failed.id))
          .get(),
      ).toMatchObject({
        status: "queued",
        phase: "retrying",
        attempts: attempt,
      });
    }

    // Failure #3 exhausts the budget and becomes terminal; the Queue message
    // is acknowledged instead of looping forever.
    await runQueuedJobs(env, {
      removalJobIds: [],
      exportTaskIds: [failed.id],
    });
    expect(
      await db
        .select()
        .from(dataTasks)
        .where(eq(dataTasks.id, failed.id))
        .get(),
    ).toMatchObject({ status: "failed", attempts: 3 });

    // A redelivery of the terminal export is an idempotent no-op, while an
    // unrelated queued export remains cron-recoverable.
    r2.failPut = false;
    await runQueuedJobs(env, {
      removalJobIds: [],
      exportTaskIds: [failed.id],
    });
    expect(
      await db
        .select()
        .from(dataTasks)
        .where(eq(dataTasks.id, failed.id))
        .get(),
    ).toMatchObject({ status: "failed", attempts: 3 });

    const cronFallback = await createDataTask(db, user, { kind: "export" });
    await runScheduledMaintenance(env, NOW);
    expect(
      await db
        .select()
        .from(dataTasks)
        .where(eq(dataTasks.id, cronFallback.id))
        .get(),
    ).toMatchObject({ status: "succeeded" });
  });

  it("recovers a Queue-requeued export during the next cron sweep", async () => {
    const task = await createDataTask(db, user, { kind: "export" });
    r2.failPut = true;
    await expect(
      runQueuedJobs(env, { removalJobIds: [], exportTaskIds: [task.id] }),
    ).rejects.toThrow("R2 put failed");
    expect(
      await db.select().from(dataTasks).where(eq(dataTasks.id, task.id)).get(),
    ).toMatchObject({ status: "queued", phase: "retrying", attempts: 1 });

    r2.failPut = false;
    await runScheduledMaintenance(env, NOW);
    expect(
      await db.select().from(dataTasks).where(eq(dataTasks.id, task.id)).get(),
    ).toMatchObject({ status: "succeeded" });
  });

  it("requeues member removal failures and dead-letters the final attempt", async () => {
    const job = await createMemberRemovalJob(db, "users/missing", user.id);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await expect(
        runQueuedJobs(env, {
          removalJobIds: [job.id],
          exportTaskIds: [],
        }),
      ).rejects.toThrow();
      expect(
        await db
          .select()
          .from(memberRemovalJobs)
          .where(eq(memberRemovalJobs.id, job.id))
          .get(),
      ).toMatchObject({
        status: "queued",
        phase: "retrying",
        attempts: attempt,
      });
    }

    await runQueuedJobs(env, {
      removalJobIds: [job.id],
      exportTaskIds: [],
    });
    expect(
      await db
        .select()
        .from(memberRemovalJobs)
        .where(eq(memberRemovalJobs.id, job.id))
        .get(),
    ).toMatchObject({
      status: "failed",
      phase: "dead",
      attempts: 3,
    });
  });

  it("purges expired trash with its attachments and sweeps orphaned ones", async () => {
    const live = await createMemo(db, user, {
      content: "keep",
      visibility: "private",
      source: "web",
    });
    const expiredTrash = await createMemo(db, user, {
      content: "old trash",
      visibility: "private",
      source: "web",
    });
    await moveMemoToTrash(db, user, expiredTrash.id);
    const trashAttachmentId = await insertAttachment(db, user.id, {
      memoId: expiredTrash.id,
      createdAt: new Date(NOW - 40 * 86_400_000).toISOString(),
    });
    await db
      .update(memos)
      .set({ deletedAt: new Date(NOW - 40 * 86_400_000).toISOString() })
      .where(eq(memos.id, expiredTrash.id));

    const boundOld = await insertAttachment(db, user.id, {
      memoId: live.id,
      createdAt: new Date(NOW - 10 * 86_400_000).toISOString(),
    });
    const orphan = await insertAttachment(db, user.id, {
      createdAt: new Date(NOW - 10 * 86_400_000).toISOString(),
    });
    const freshOrphan = await insertAttachment(db, user.id, {
      createdAt: new Date(NOW).toISOString(),
    });

    await runScheduledMaintenance(env, NOW);

    // The orphan GC runs first, then the trash purge deletes its R2 keys via
    // the hard-delete path.
    expect(r2.deletedKeys).toEqual([
      [expect.stringContaining(orphan)],
      [expect.stringContaining(trashAttachmentId)],
    ]);
    const remainingIds = (await db.select().from(attachments)).map(
      (row) => row.id,
    );
    expect(remainingIds).toContain(boundOld);
    expect(remainingIds).toContain(freshOrphan);
    expect(remainingIds).not.toContain(orphan);
    const trashedRow = await db
      .select()
      .from(memos)
      .where(eq(memos.id, expiredTrash.id))
      .get();
    expect(trashedRow).toBeUndefined();
    // The hard delete marks its attachment rows `deleting` instead of
    // dropping them inline; the next daily sweep finalizes them.
    const marked = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, trashAttachmentId))
      .get();
    expect(marked?.state).toBe("deleting");
    await runScheduledMaintenance(env, NOW);
    expect(
      (await db.select().from(attachments)).some(
        (row) => row.id === trashAttachmentId,
      ),
    ).toBe(false);
  });

  it("files daily review and overdue notifications exactly once per day", async () => {
    const anchor = await createMemo(db, user, {
      content: "a year ago today",
      visibility: "private",
      source: "web",
    });
    await db
      .update(memos)
      .set({ createdAt: "2025-09-15T10:00:00.000Z" })
      .where(eq(memos.id, anchor.id));
    const project = await createProject(db, user, { name: "plan" });
    await createTask(db, user, { type: "user" }, {
      project_id: project.id,
      title: "overdue chore",
      due_at: "2026-09-01",
    } as never);

    await runScheduledMaintenance(env, NOW);
    let rows = await db.select().from(memosNotifications);
    expect(rows.filter((row) => row.type === "daily_review")).toHaveLength(1);
    expect(rows.filter((row) => row.type === "task_overdue")).toHaveLength(1);

    // A cron retry for the same day must not duplicate the inbox rows.
    await runScheduledMaintenance(env, NOW);
    rows = await db.select().from(memosNotifications);
    expect(rows.filter((row) => row.type === "daily_review")).toHaveLength(1);
    expect(rows.filter((row) => row.type === "task_overdue")).toHaveLength(1);
  });

  it("keeps later maintenance steps running when an earlier step fails", async () => {
    const anchor = await createMemo(db, user, {
      content: "a year ago today",
      visibility: "private",
      source: "web",
    });
    await db
      .update(memos)
      .set({ createdAt: "2025-09-15T10:00:00.000Z" })
      .where(eq(memos.id, anchor.id));
    await insertAttachment(db, user.id, {
      createdAt: new Date(NOW - 10 * 86_400_000).toISOString(),
    });

    r2.failDelete = true;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await runScheduledMaintenance(env, NOW);
    } finally {
      r2.failDelete = false;
    }

    const summaryLine = logSpy.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.includes("scheduled maintenance complete"));
    const summary = JSON.parse(summaryLine ?? "{}") as {
      ok?: boolean;
      failedSteps?: string[];
    };
    // The R2 delete failure is contained to the attachment step; every pass
    // after it still runs.
    expect(summary.ok).toBe(false);
    expect(summary.failedSteps).toContain("attachment-gc");
    expect(errorSpy).toHaveBeenCalled();
    const rows = await db.select().from(memosNotifications);
    expect(rows.filter((row) => row.type === "daily_review")).toHaveLength(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("expires stale data tasks and garbage-collects their export artifacts", async () => {
    const taskId = createResourceId("data_tasks");
    await db.insert(dataTasks).values({
      id: taskId,
      userId: user.id,
      kind: "export",
      status: "succeeded",
      phase: "completed",
      manifestKey: `exports/${taskId}/manifest.json`,
      createdAt: new Date(NOW - 30 * 86_400_000).toISOString(),
      updatedAt: new Date(NOW - 30 * 86_400_000).toISOString(),
      completedAt: new Date(NOW - 30 * 86_400_000).toISOString(),
      expiresAt: new Date(NOW - 1).toISOString(),
    });
    r2.objects.add(`exports/${taskId}/manifest.json`);
    r2.objects.add("exports/other/artifact.json");

    await runScheduledMaintenance(env, NOW);

    const row = await db
      .select()
      .from(dataTasks)
      .where(eq(dataTasks.id, taskId))
      .get();
    expect(row).toBeUndefined();
    expect(r2.listPrefixes).toContain(`exports/${taskId}`);
    expect(r2.objects.has(`exports/${taskId}/manifest.json`)).toBe(false);
    // Artifacts of live tasks are untouched.
    expect(r2.objects.has("exports/other/artifact.json")).toBe(true);
  });

  it("pushes an overdue reminder whose payload deep-links to /projects", async () => {
    // A subscription row makes the web-push branch live; the mock on
    // pushNotificationToUser captures the plaintext payload, so the click
    // URL — the /calendar → /projects migration's regression guard — is
    // asserted without depending on the aes128gcm crypto internals.
    await db.insert(pushSubscriptions).values({
      id: createResourceId("push"),
      userId: user.id,
      endpoint: "https://push.example/endpoint-1",
      p256dh: "test-p256dh",
      auth: "test-auth",
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    });

    const project = await createProject(db, user, { name: "plan" });
    await createTask(db, user, { type: "user" }, {
      project_id: project.id,
      title: "overdue chore",
      due_at: "2026-09-01",
    } as never);

    const pushes: Array<{ userId: string; payload: PushPayload }> = [];
    vi.mocked(pushNotificationToUser).mockClear();
    vi.mocked(pushNotificationToUser).mockImplementation(
      async (_db, _keys, userId, payload) => {
        pushes.push({ userId, payload });
        return {
          attempted: 2,
          delivered: 1,
          failed: 1,
          failureCategories: {
            endpoint_expired: 0,
            http_4xx: 0,
            http_5xx: 1,
            network_error: 0,
            crypto_error: 0,
            payload_error: 0,
            unknown: 0,
          },
        };
      },
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      await runScheduledMaintenance(env, NOW);

      const summary = logSpy.mock.calls
        .map(([line]) => {
          try {
            return JSON.parse(String(line)) as {
              message?: string;
              counts?: { push?: unknown };
            };
          } catch {
            return {};
          }
        })
        .find((entry) => entry.message === "scheduled maintenance complete");
      expect(summary?.counts?.push).toMatchObject({
        attempted: 2,
        delivered: 1,
        failed: 1,
        failureCategories: { http_5xx: 1 },
      });
      const warning = warnSpy.mock.calls
        .map(([line]) => {
          try {
            return JSON.parse(String(line)) as {
              message?: string;
              failureCategories?: { http_5xx?: number };
            };
          } catch {
            return {};
          }
        })
        .find(
          (entry) =>
            entry.message === "scheduled web push completed with failures",
        );
      expect(warning?.failureCategories?.http_5xx).toBe(1);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }

    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.userId).toBe(user.id);
    expect(pushes[0]?.payload).toMatchObject({
      title: "FlareMo 任务提醒",
      body: "有 1 个任务已经逾期。",
      url: "/projects",
    });

    // The inbox row carries the task title as its snippet.
    const rows = await db.select().from(memosNotifications);
    const overdueRow = rows.find((row) => row.type === "task_overdue");
    expect(overdueRow?.snippet).toBe("overdue chore");
  });
});
