import { createDb } from "@flaremo/db";
import { ensureSingleUser, pruneMemosWebhookOutbox } from "@flaremo/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestRuntime, type TestRuntime } from "../test-support/runtime";

describe("webhook outbox pruning", () => {
  let runtime: TestRuntime | undefined;

  beforeEach(async () => {
    runtime = await createTestRuntime({ name: "flaremo-webhook-prune" });
  });

  afterEach(async () => {
    await runtime?.runtime.dispose();
    runtime = undefined;
  });

  it("prunes a full 100-event page without exceeding D1's parameter cap", async () => {
    if (!runtime) throw new Error("runtime not initialized");
    const db = createDb(runtime.env.DB);
    const owner = await ensureSingleUser(db, {
      email: "owner@example.com",
      name: "Owner",
    });
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const insert = runtime.env.DB.prepare(
      "INSERT INTO memos_webhook_events (receiver_id, activity_type, body, created_at, expanded_at) VALUES (?, ?, ?, ?, ?)",
    );
    const statements = Array.from({ length: 100 }, (_, index) =>
      insert.bind(
        owner.id,
        "memos.memo.created",
        JSON.stringify({ sequence: index }),
        old,
        old,
      ),
    );
    for (let offset = 0; offset < statements.length; offset += 25) {
      await runtime.env.DB.batch(statements.slice(offset, offset + 25));
    }

    await pruneMemosWebhookOutbox(db, new Date());

    const row = await runtime.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM memos_webhook_events",
    ).first<{ count: number }>();
    expect(row?.count).toBe(0);
  });
});
