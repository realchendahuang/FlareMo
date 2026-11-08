import type { MemoInsightDto } from "@flaremo/contracts";
import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppTestHarness } from "../test-support/app";
import { createTestRuntime } from "../test-support/runtime";

/**
 * AI insight contract (docs/agent-access-design.md §9): a browser creates a
 * task, an executor with a PAT pulls it and writes the result back, and the
 * browser reads or deletes the derived row. The Worker owns no model, so these
 * tests only drive the contract and its state machine.
 */

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { fetchApp, bootstrapAndSignIn, createActivatedMember } =
  createAppTestHarness(() => ({ env, sessionCookie }));

const BASE = "http://flaremo.test";
const ORIGIN = BASE;

type InsightBody = { insight: MemoInsightDto };
type InsightListBody = { insights: MemoInsightDto[] };

function insightPath(id: string) {
  return `/api/app/insights/${encodeURIComponent(id)}`;
}

/** Browser-session request: the harness adds the cookie and the Origin. */
function browserRequest(path: string, init: RequestInit = {}) {
  return fetchApp(`${BASE}${path}`, init);
}

/**
 * Create a PAT for a given session. The executor surface only accepts PATs, so
 * every write-back test starts here instead of reusing the browser cookie.
 */
async function createPat(cookie: string): Promise<string> {
  const response = await fetchApp(
    `${BASE}/api/app/account/personal-access-tokens`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: ORIGIN,
      },
      body: JSON.stringify({ name: "insight executor", expires_in_days: 30 }),
    },
    { authenticated: false },
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { token: string };
  return body.token;
}

/** PAT request: no cookie, no Origin (both are optional for bearer calls). */
function patRequest(token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return fetchApp(
    `${BASE}${path}`,
    { ...init, headers },
    { authenticated: false },
  );
}

async function createTask(
  body: Record<string, unknown>,
): Promise<MemoInsightDto> {
  const response = await browserRequest("/api/app/insights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as InsightBody).insight;
}

async function readInsight(
  request: Response | Promise<Response>,
): Promise<MemoInsightDto> {
  const response = await request;
  expect(response.status).toBe(200);
  return ((await response.json()) as InsightBody).insight;
}

describe("AI insight contract", () => {
  beforeEach(async () => {
    ({ runtime: mf, env } = await createTestRuntime({
      databaseName: "flaremo-insight-test",
      attachmentsName: "flaremo-insight-attachments-test",
      env: { FLAREMO_DEPLOY_REPOSITORY: "example/flaremo" },
    }));
    sessionCookie = await bootstrapAndSignIn();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("creates a task, an executor claims and completes it, and the browser reads it", async () => {
    const token = await createPat(sessionCookie);
    const task = await createTask({
      kind: "digest",
      query: "本周做了什么",
    });

    expect(task.id).toMatch(/^insights\//);
    expect(task.status).toBe("pending");
    expect(task.input).toEqual({ query: "本周做了什么" });
    expect(task.result).toBeNull();
    expect(task.executor).toBeNull();
    expect(task.created_at).toBe(task.updated_at);
    expect(task.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );

    // The executor pulls the pending queue.
    const pending = await patRequest(token, "/api/app/insights?status=pending");
    expect(pending.status).toBe(200);
    const pendingBody = (await pending.json()) as InsightListBody;
    expect(pendingBody.insights.map((item) => item.id)).toContain(task.id);

    // Claim it, then write the result back.
    const claimed = await readInsight(
      patRequest(token, insightPath(task.id), {
        method: "PUT",
        body: JSON.stringify({ status: "running", executor: "dsh" }),
      }),
    );
    expect(claimed.status).toBe("running");
    expect(claimed.executor).toBe("dsh");

    const completed = await readInsight(
      patRequest(token, insightPath(task.id), {
        method: "PUT",
        body: JSON.stringify({
          status: "done",
          executor: "dsh",
          result: { summary: "本周完成了洞察契约后端", highlights: ["schema"] },
        }),
      }),
    );
    expect(completed.status).toBe("done");
    expect(completed.result).toEqual({
      summary: "本周完成了洞察契约后端",
      highlights: ["schema"],
    });
    expect(completed.updated_at >= task.updated_at).toBe(true);

    // The browser session reads the same derived row.
    expect(await readInsight(browserRequest(insightPath(task.id)))).toEqual(
      completed,
    );

    // The web history view lists finished insights through the same endpoint.
    const history = await browserRequest("/api/app/insights?status=done");
    expect(history.status).toBe(200);
    expect(((await history.json()) as InsightListBody).insights).toEqual([
      completed,
    ]);

    // The drained task no longer shows up in the pending pull.
    const drained = await patRequest(token, "/api/app/insights");
    expect(
      ((await drained.json()) as InsightListBody).insights.map(
        (item) => item.id,
      ),
    ).not.toContain(task.id);
  });

  it("requires credentials and keeps the executor surface on PATs", async () => {
    const anonymous = (path: string, init: RequestInit = {}) =>
      fetchApp(`${BASE}${path}`, init, { authenticated: false });

    expect((await anonymous("/api/app/insights")).status).toBe(401);

    const task = await createTask({ kind: "note", tag: "阅读" });
    expect((await anonymous(insightPath(task.id))).status).toBe(401);
    expect(
      (
        await anonymous(insightPath(task.id), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "done", result: { ok: true } }),
        })
      ).status,
    ).toBe(401);

    // The browser reads its own queue (the web history view)...
    const browserList = await browserRequest(
      "/api/app/insights?status=pending",
    );
    expect(browserList.status).toBe(200);
    expect(
      ((await browserList.json()) as InsightListBody).insights.map(
        (item) => item.id,
      ),
    ).toEqual([task.id]);

    // ...but a browser session must not write results back.
    expect(
      (
        await browserRequest(insightPath(task.id), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "failed", error: "not an executor" }),
        })
      ).status,
    ).toBe(403);

    // ...and a PAT may not delete the browser-owned derived row.
    const token = await createPat(sessionCookie);
    expect(
      (await patRequest(token, insightPath(task.id), { method: "DELETE" }))
        .status,
    ).toBe(401);
  });

  it("rejects a task without a selector and an unknown kind", async () => {
    const noSelector = await browserRequest("/api/app/insights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "digest" }),
    });
    expect(noSelector.status).toBe(400);

    const badKind = await browserRequest("/api/app/insights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "summary", query: "x" }),
    });
    expect(badKind.status).toBe(400);
  });

  it("normalizes memo ids and accepts a retried write-back idempotently", async () => {
    const token = await createPat(sessionCookie);
    const task = await createTask({
      kind: "map",
      memo_ids: ["memo-1", "memos/memo-2", "memo-1"],
    });
    // Bare ids, deduplicated, so the executor can feed them to the memo API.
    expect(task.input).toEqual({ memo_ids: ["memo-1", "memo-2"] });

    const first = await readInsight(
      patRequest(token, insightPath(task.id), {
        method: "PUT",
        body: JSON.stringify({
          status: "done",
          executor: "workers-ai",
          result: { clusters: ["a"] },
        }),
      }),
    );
    expect(first.status).toBe("done");

    // A lost response is retried with the same body: no rewrite, same row.
    const retry = await readInsight(
      patRequest(token, insightPath(task.id), {
        method: "PUT",
        body: JSON.stringify({
          status: "done",
          executor: "workers-ai",
          result: { clusters: ["a"] },
        }),
      }),
    );
    expect(retry).toEqual(first);

    // A stale failure report cannot regress a finished result either.
    const lateFailure = await readInsight(
      patRequest(token, insightPath(task.id), {
        method: "PUT",
        body: JSON.stringify({ status: "failed", error: "model timeout" }),
      }),
    );
    expect(lateFailure.status).toBe("done");
    expect(lateFailure.result).toEqual({ clusters: ["a"] });

    // Writing `done` without a result is a client mistake, not a task.
    const missingResult = await patRequest(token, insightPath(task.id), {
      method: "PUT",
      body: JSON.stringify({ status: "done" }),
    });
    expect(missingResult.status).toBe(400);
  });

  it("retries a failed task after an explicit reset to pending", async () => {
    const token = await createPat(sessionCookie);
    const task = await createTask({ kind: "note", memo_ids: ["memo-1"] });

    const failed = await readInsight(
      patRequest(token, insightPath(task.id), {
        method: "PUT",
        body: JSON.stringify({
          status: "failed",
          executor: "dsh",
          error: "model timeout",
        }),
      }),
    );
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("model timeout");

    // §9.4: a failed task may be reset to pending instead of recreated.
    const reset = await readInsight(
      patRequest(token, insightPath(task.id), {
        method: "PUT",
        body: JSON.stringify({ status: "pending" }),
      }),
    );
    expect(reset.status).toBe("pending");
    expect(reset.error).toBeNull();
    expect(reset.executor).toBeNull();
    expect(reset.result).toBeNull();

    const completed = await readInsight(
      patRequest(token, insightPath(task.id), {
        method: "PUT",
        body: JSON.stringify({ status: "done", result: { text: "ok" } }),
      }),
    );
    expect(completed.status).toBe("done");
    expect(completed.result).toEqual({ text: "ok" });
  });

  it("deletes a derived result from the browser only", async () => {
    const task = await createTask({ kind: "note", query: "临时洞察" });

    expect(
      (await browserRequest(insightPath(task.id), { method: "DELETE" })).status,
    ).toBe(204);
    expect((await browserRequest(insightPath(task.id))).status).toBe(404);
    expect(
      (await browserRequest(insightPath(task.id), { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("keeps one user's insights invisible to another user", async () => {
    const ownerTask = await createTask({ kind: "note", tag: "owner-only" });
    const ownerToken = await createPat(sessionCookie);

    const member = await createActivatedMember(
      "insight-member@example.com",
      "Insight Member",
    );
    const memberToken = await createPat(member.cookie);

    // The member's own pending queue never contains the owner's task...
    const memberList = await patRequest(memberToken, "/api/app/insights");
    expect(memberList.status).toBe(200);
    expect(((await memberList.json()) as InsightListBody).insights).toEqual([]);

    // ...and neither id lookup nor a direct write-back can reach it.
    expect(
      (await patRequest(memberToken, insightPath(ownerTask.id))).status,
    ).toBe(404);
    expect(
      (
        await patRequest(memberToken, insightPath(ownerTask.id), {
          method: "PUT",
          body: JSON.stringify({ status: "done", result: { stolen: true } }),
        })
      ).status,
    ).toBe(404);

    // The owner still sees an untouched pending task.
    expect(
      (await patRequest(ownerToken, insightPath(ownerTask.id))).status,
    ).toBe(200);
    const stillPending = await readInsight(
      patRequest(ownerToken, insightPath(ownerTask.id)),
    );
    expect(stillPending.status).toBe("pending");
  });
});
