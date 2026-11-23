import type { UserRow } from "@flaremo/db";
import { applyFlaremoMigrations, createDb } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDataTask,
  DATA_TASK_MAX_ATTEMPTS,
  deleteExpiredDataTasks,
  expireStaleDataTasks,
  getDataTask,
  retryOrFailDataTask,
  updateDataTask,
} from "./data-tasks";
import { NotFoundError } from "./errors";
import { createTeamMember, ensureTeamOwner } from "./test-support";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: UserRow;

describe("data tasks", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-data-tasks-test" },
    });
    const database = await mf.getD1Database("DB");
    db = createDb(database);
    await applyFlaremoMigrations(database);
    user = await ensureTeamOwner(db);
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("creates tasks queued and scopes reads to the owner", async () => {
    const task = await createDataTask(db, user, {
      kind: "export",
      phase: "created",
    });
    expect(task.status).toBe("queued");
    expect(task.kind).toBe("export");

    const other = await createTeamMember(db, "Other");
    await expect(getDataTask(db, other, task.id)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("requeues exports only below the retry cap and fails imports immediately", async () => {
    const task = await createDataTask(db, user, { kind: "export" });
    expect(DATA_TASK_MAX_ATTEMPTS).toBe(3);

    await updateDataTask(db, task.id, { status: "running" });
    expect(
      await retryOrFailDataTask(db, task.id, "r2_transient", "first failure"),
    ).toBe("queued");
    let row = await getDataTask(db, user, task.id);
    expect(row).toMatchObject({
      status: "queued",
      phase: "retrying",
      attempts: 1,
      errorCode: "r2_transient",
      completedAt: null,
      leaseUntil: null,
    });

    // Duplicate failure notifications on an already-queued row are no-ops and
    // must not consume an additional attempt.
    expect(
      await retryOrFailDataTask(db, task.id, "r2_transient", "duplicate"),
    ).toBe("queued");
    row = await getDataTask(db, user, task.id);
    expect(row.attempts).toBe(1);

    await updateDataTask(db, task.id, {
      status: "running",
      leaseUntil: new Date().toISOString(),
    });
    expect(
      await retryOrFailDataTask(db, task.id, "r2_transient", "second failure"),
    ).toBe("queued");
    row = await getDataTask(db, user, task.id);
    expect(row.attempts).toBe(2);

    await updateDataTask(db, task.id, {
      status: "running",
      leaseUntil: new Date().toISOString(),
    });
    expect(
      await retryOrFailDataTask(db, task.id, "r2_terminal", "third failure"),
    ).toBe("failed");
    row = await getDataTask(db, user, task.id);
    expect(row).toMatchObject({
      status: "failed",
      attempts: 3,
      errorCode: "r2_terminal",
    });
    // Terminal failures stay terminal; a late duplicate error cannot restart
    // the state machine with a fourth attempt.
    expect(await retryOrFailDataTask(db, task.id, "late", "duplicate")).toBe(
      "failed",
    );
    row = await getDataTask(db, user, task.id);
    expect(row.attempts).toBe(3);

    const importTask = await createDataTask(db, user, { kind: "import" });
    await updateDataTask(db, importTask.id, { status: "running" });
    expect(
      await retryOrFailDataTask(
        db,
        importTask.id,
        "import_failed",
        "imports are not replay-safe",
      ),
    ).toBe("failed");
    const failedImport = await getDataTask(db, user, importTask.id);
    expect(failedImport).toMatchObject({
      status: "failed",
      attempts: 1,
      errorCode: "import_failed",
    });
  });

  it("uses the indexed expires_at boundary for cleanup, not created_at", async () => {
    const task = await createDataTask(db, user, { kind: "export" });
    const raw = await mf.getD1Database("DB");
    const createdAt = new Date(
      Date.now() - 20 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await raw
      .prepare(
        "UPDATE data_tasks SET created_at = ?, expires_at = ? WHERE id = ?",
      )
      .bind(createdAt, expiresAt, task.id)
      .run();

    // An old created_at alone must no longer expire the row: expires_at is the
    // indexed TTL authority and is still in the future.
    await expect(deleteExpiredDataTasks(db)).resolves.toEqual([]);
  });

  it("requeues a stale running export until its third attempt fails", async () => {
    const task = await createDataTask(db, user, { kind: "export" });
    const staleLease = () => new Date(Date.now() - 1_000).toISOString();

    for (const attempts of [1, 2]) {
      await updateDataTask(db, task.id, {
        status: "running",
        leaseUntil: staleLease(),
      });
      await expect(expireStaleDataTasks(db)).resolves.toBe(1);
      const row = await getDataTask(db, user, task.id);
      expect(row).toMatchObject({
        status: "queued",
        phase: "retrying",
        attempts,
        errorCode: "task_expired",
        completedAt: null,
        leaseUntil: null,
      });
    }

    await updateDataTask(db, task.id, {
      status: "running",
      leaseUntil: staleLease(),
    });
    await expect(expireStaleDataTasks(db)).resolves.toBe(1);
    const terminal = await getDataTask(db, user, task.id);
    expect(terminal).toMatchObject({
      status: "failed",
      attempts: DATA_TASK_MAX_ATTEMPTS,
      errorCode: "task_expired",
    });
    // A failed row is no longer in the queued/running stale set.
    await expect(expireStaleDataTasks(db)).resolves.toBe(0);
  });

  it("releases a stale queued export lease without consuming an attempt", async () => {
    const task = await createDataTask(db, user, { kind: "export" });
    await updateDataTask(db, task.id, {
      status: "queued",
      phase: "retrying",
      attempts: 1,
      errorCode: "r2_transient",
      leaseUntil: new Date(Date.now() - 1_000).toISOString(),
    });

    await expect(expireStaleDataTasks(db)).resolves.toBe(1);
    const row = await getDataTask(db, user, task.id);
    expect(row).toMatchObject({
      status: "queued",
      phase: "retrying",
      attempts: 1,
      errorCode: "r2_transient",
      leaseUntil: null,
    });

    // Clearing the expired lease makes the row immediately claimable by the
    // normal queued sweep; a second stale pass has nothing left to do.
    await expect(expireStaleDataTasks(db)).resolves.toBe(0);
  });

  it("rolls back a stale import ledger and still fails it without retry", async () => {
    const task = await createDataTask(db, user, { kind: "import" });
    await updateDataTask(db, task.id, {
      status: "running",
      attempts: 1,
      leaseUntil: new Date(Date.now() - 1_000).toISOString(),
    });
    const raw = await mf.getD1Database("DB");
    const now = new Date().toISOString();
    await raw.batch([
      raw
        .prepare(
          `INSERT INTO memos
            (id, user_id, content, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind("memos/stale-import", user.id, "partial import", now, now),
      raw
        .prepare(
          `INSERT INTO import_task_rows (task_id, table_name, row_id)
           VALUES (?, 'memos', ?)`,
        )
        .bind(task.id, "memos/stale-import"),
    ]);

    await expect(expireStaleDataTasks(db)).resolves.toBe(1);
    const row = await getDataTask(db, user, task.id);
    expect(row).toMatchObject({
      status: "failed",
      attempts: 1,
      errorCode: "task_expired",
      leaseUntil: null,
    });
    const restored = await raw
      .prepare("SELECT count(*) AS n FROM memos WHERE id = ?")
      .bind("memos/stale-import")
      .first<{ n: number }>();
    expect(restored?.n).toBe(0);
    const ledger = await raw
      .prepare("SELECT count(*) AS n FROM import_task_rows WHERE task_id = ?")
      .bind(task.id)
      .first<{ n: number }>();
    expect(ledger?.n).toBe(0);
  });

  it("deletes rows past the TTL", async () => {
    const task = await createDataTask(db, user, { kind: "export" });
    const removed = await deleteExpiredDataTasks(
      db,
      new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    );
    expect(removed).toEqual([task.id]);
    await expect(getDataTask(db, user, task.id)).rejects.toThrow(NotFoundError);
  });
});
