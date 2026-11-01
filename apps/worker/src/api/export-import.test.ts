import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../index";
import { createAppTestHarness, json } from "../test-support/app";
import { createTestRuntime } from "../test-support/runtime";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { fetchApp, createMemo, bootstrapAndSignIn } = createAppTestHarness(
  () => ({
    env,
    sessionCookie,
  }),
);

describe("FlareMo export and import tasks", () => {
  beforeEach(async () => {
    ({ runtime: mf, env } = await createTestRuntime({
      databaseName: "flaremo-test",
      attachmentsName: "flaremo-attachments-test",
      env: { FLAREMO_DEPLOY_REPOSITORY: "example/flaremo" },
    }));
    sessionCookie = await bootstrapAndSignIn();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("creates an export task, streams its manifest and attachment bytes", async () => {
    await createMemo("export memo #tag-a");
    await createMemo("export memo #tag-b");

    const created = await fetchApp("http://flaremo.test/api/v1/export/tasks", {
      method: "POST",
    });
    expect(created.status).toBe(202);
    const createdBody = await created.json<{
      task: { id: string; status: string; kind: string };
    }>();
    expect(createdBody.task.kind).toBe("export");
    expect(createdBody.task.status).toBe("succeeded");
    const taskId = createdBody.task.id;

    const listed = await json<{ tasks: Array<{ id: string }> }>(
      await fetchApp("http://flaremo.test/api/v1/export/tasks"),
    );
    expect(listed.tasks.map((task) => task.id)).toContain(taskId);

    const statusBody = await json<{
      task: {
        id: string;
        status: string;
        phase: string;
        progress_total: number;
      };
    }>(await fetchApp(`http://flaremo.test/api/v1/export/tasks/${taskId}`));
    expect(statusBody.task.status).toBe("succeeded");
    expect(statusBody.task.phase).toBe("completed");

    const manifestResponse = await fetchApp(
      `http://flaremo.test/api/v1/export/tasks/${taskId}/manifest`,
    );
    expect(manifestResponse.ok).toBe(true);
    const manifest = (await manifestResponse.json()) as {
      format_version: number;
      counts: { memos: number; attachments: number; relations: number };
      data_chunks: Array<{ kind: string; key: string; record_count: number }>;
    };
    expect(manifest.format_version).toBe(1);
    expect(manifest.counts.memos).toBe(2);
    expect(manifest.data_chunks.length).toBeGreaterThan(0);

    const memosChunk = manifest.data_chunks.find(
      (chunk) => chunk.kind === "memos",
    );
    expect(memosChunk).toBeTruthy();
    if (!memosChunk) {
      throw new Error("expected a memos chunk in the export manifest");
    }
    const chunkFileName = memosChunk.key.split("/").at(-1);
    if (!chunkFileName) {
      throw new Error("expected the chunk key to end in a file name");
    }
    const chunkResponse = await fetchApp(
      `http://flaremo.test/api/v1/export/tasks/${taskId}/data/${encodeURIComponent(
        chunkFileName,
      )}`,
    );
    expect(chunkResponse.ok).toBe(true);
    const chunkText = await chunkResponse.text();
    expect(chunkText.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("exports attachments through the task download endpoint", async () => {
    const memo = await createMemo("export with attachment");
    const formData = new FormData();
    formData.set("memo", memo.name);
    formData.set(
      "file",
      new File(["export-me-bytes"], "export.txt", { type: "text/plain" }),
    );
    const uploaded = await json<{ name: string }>(
      await fetchApp("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        body: formData,
      }),
    );
    const attachmentId = uploaded.name.split("/").at(-1);
    if (!attachmentId) {
      throw new Error("expected the attachment name to end in an id");
    }

    const created = await json<{ task: { id: string } }>(
      await fetchApp("http://flaremo.test/api/v1/export/tasks", {
        method: "POST",
      }),
    );
    const manifest = await json<{
      counts: { attachments: number };
      attachments: Array<{ id: string; filename: string }>;
    }>(
      await fetchApp(
        `http://flaremo.test/api/v1/export/tasks/${created.task.id}/manifest`,
      ),
    );
    expect(manifest.counts.attachments).toBe(1);
    expect(manifest.attachments[0].id).toBe(attachmentId);

    const download = await fetchApp(
      `http://flaremo.test/api/v1/export/tasks/${created.task.id}/attachments/${attachmentId}`,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("text/plain");
    expect(await download.text()).toBe("export-me-bytes");
  });

  it("hands export tasks to DATA_EXPORT_QUEUE and runs them in the consumer", async () => {
    const sent: Array<{ taskId: string }> = [];
    (env as unknown as Record<string, unknown>).DATA_EXPORT_QUEUE = {
      send: async (message: { taskId: string }) => {
        sent.push(message);
      },
    };

    await createMemo("queued export memo");
    const created = await fetchApp("http://flaremo.test/api/v1/export/tasks", {
      method: "POST",
    });
    expect(created.status).toBe(202);
    const createdBody = await created.json<{
      task: { id: string; status: string };
    }>();
    // Queue-bound deployments return the queued row immediately; the
    // consumer runs the shared executor afterwards.
    expect(createdBody.task.status).toBe("queued");
    expect(sent).toEqual([{ taskId: createdBody.task.id }]);

    const acked: string[] = [];
    await app.queue?.(
      {
        queue: "flaremo-data-export",
        retryAll: () => {},
        ackAll: () => {},
        messages: [
          {
            id: "export-1",
            timestamp: new Date(),
            attempts: 1,
            body: { taskId: createdBody.task.id },
            ack: () => acked.push("export-1"),
            retry: () => {},
          },
          {
            id: "poison",
            timestamp: new Date(),
            attempts: 1,
            body: { bogus: true },
            ack: () => acked.push("poison"),
            retry: () => {},
          },
        ],
      } as unknown as MessageBatch,
      env,
    );
    // Every message is acked — the malformed body is dropped, never retried.
    expect(acked.sort()).toEqual(["export-1", "poison"]);

    const statusBody = await json<{ task: { status: string } }>(
      await fetchApp(
        `http://flaremo.test/api/v1/export/tasks/${createdBody.task.id}`,
      ),
    );
    expect(statusBody.task.status).toBe("succeeded");

    const manifest = await json<{ counts: { memos: number } }>(
      await fetchApp(
        `http://flaremo.test/api/v1/export/tasks/${createdBody.task.id}/manifest`,
      ),
    );
    expect(manifest.counts.memos).toBe(1);
  });

  it("runs an import task and reports its result", async () => {
    const created = await fetchApp("http://flaremo.test/api/v1/import/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conflict: "duplicate",
        bundle: {
          version: 2,
          memos: [
            {
              name: "memos/import-task-memo",
              content: "imported via task",
              visibility: "private",
              state: "normal",
              pinned: false,
              payload: {},
              create_time: "2023-11-14T22:13:20Z",
              update_time: "2023-11-14T22:13:20Z",
            },
          ],
          attachments: [],
          relations: [],
          shares: [],
        },
      }),
    });
    expect(created.status).toBe(202);
    const body = await created.json<{
      task: { status: string; kind: string };
      result: { imported_memos: number };
    }>();
    expect(body.task.status).toBe("succeeded");
    expect(body.task.kind).toBe("import");
    expect(body.result.imported_memos).toBe(1);

    const listed = await json<{
      memos: Array<{ name: string; content: string }>;
    }>(await fetchApp("http://flaremo.test/api/v1/memos?q=imported+via+task"));
    expect(listed.memos).toHaveLength(1);
    expect(listed.memos[0].name).toBe("memos/import-task-memo");
  });

  it("rolls a failed import back and retries it from the stored bundle", async () => {
    const now = "2023-11-14T22:13:20Z";
    const memo = {
      name: "memos/retry-import",
      content: "retry import",
      visibility: "private" as const,
      state: "normal" as const,
      pinned: false,
      payload: {},
      create_time: now,
      update_time: now,
    };
    const taskId = crypto.randomUUID();
    const bundleKey = `imports/${taskId}/bundle.json`;
    const userId = (
      await env.DB.prepare("SELECT id FROM users LIMIT 1").first<{
        id: string;
      }>()
    )?.id;
    expect(userId).toBeTruthy();
    // Simulate the state a killed Worker leaves behind: a failed task, the
    // original bundle in R2, one committed memo, and its ledger row.
    await env.DB.prepare(
      `INSERT INTO data_tasks
        (id, user_id, kind, status, phase, attempts, manifest_key, options,
         progress_done, progress_total, created_at, updated_at)
       VALUES (?, ?, 'import', 'failed', 'importing', 1, ?, ?, 0, 0, ?, ?)`,
    )
      .bind(
        taskId,
        userId,
        bundleKey,
        JSON.stringify({ conflict: "skip" }),
        now,
        now,
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO memos
        (id, user_id, content, created_at, updated_at)
       VALUES ('memos/retry-import', ?, 'partial attempt', ?, ?)`,
    )
      .bind(userId, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO import_task_rows (task_id, table_name, row_id) VALUES (?, 'memos', 'memos/retry-import')",
    )
      .bind(taskId)
      .run();
    await env.ATTACHMENTS.put(
      bundleKey,
      JSON.stringify({
        version: 6,
        memos: [memo],
        attachments: [],
        relations: [],
        shares: [],
      }),
    );

    const retried = await fetchApp(
      `http://flaremo.test/api/v1/import/tasks/${taskId}/retry`,
      { method: "POST" },
    );
    expect(retried.status).toBe(202);
    const body = await retried.json<{
      task: { status: string };
      result: { imported_memos: number };
    }>();
    expect(body.task.status).toBe("succeeded");
    expect(body.result.imported_memos).toBe(1);
    const restored = await env.DB.prepare(
      "SELECT content FROM memos WHERE id = 'memos/retry-import'",
    ).first<{ content: string }>();
    expect(restored?.content).toBe("retry import");
    const remaining = await env.DB.prepare(
      "SELECT count(*) AS n FROM memos WHERE id = 'memos/retry-import'",
    ).first<{ n: number }>();
    expect(remaining?.n).toBe(1);
  });
});
