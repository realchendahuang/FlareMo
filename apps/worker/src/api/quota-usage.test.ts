import { SELF_HOST_UNLIMITED } from "@flaremo/domain";
import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFlareMoApp } from "../index";
import { createAppTestHarness, json } from "../test-support/app";
import { createTestRuntime } from "../test-support/runtime";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { fetchApp, bootstrapAndSignIn } = createAppTestHarness(() => ({
  env,
  sessionCookie,
}));

describe("FlareMo quota and usage API", () => {
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

  it("reports the plan usage section on the vector usage endpoint", async () => {
    const report = await json<{
      plan?: {
        limits: Record<string, number | null>;
        usage: Record<string, number>;
      };
    }>(await fetchApp("http://flaremo.test/api/app/usage/vector"));
    // The kernel default is SELF_HOST_UNLIMITED: all limits null, counters at 0.
    expect(report.plan).toBeDefined();
    expect(report.plan?.limits).toEqual({
      attachmentStorageBytes: null,
      aiEmbeddingTokensPerMonth: null,
      semanticSearchQueriesPerMonth: null,
      maxMembersPerDeployment: null,
    });
    expect(report.plan?.usage.maxMembersPerDeployment).toBe(1);
  });

  it("hides the Cloudflare usage section until analytics secrets are set", async () => {
    const report = await json<{ available: boolean }>(
      await fetchApp("http://flaremo.test/api/app/usage/cloudflare"),
    );
    // Owner session, but FLAREMO_CF_* secrets absent -> feature off.
    expect(report.available).toBe(false);
  });

  it("rejects an attachment upload over the storage quota with 429", async () => {
    const quotaApp = createFlareMoApp({
      resolvePlanLimits: () => ({
        ...SELF_HOST_UNLIMITED,
        attachmentStorageBytes: 10,
      }),
    });

    const formData = new FormData();
    formData.set(
      "file",
      new File(["inline attachment"], "inline.txt", { type: "text/plain" }),
    );
    const response = await quotaApp.fetch(
      new Request("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        headers: {
          cookie: sessionCookie,
          "x-flaremo-wire": "legacy",
          origin: "http://flaremo.test",
        },
        body: formData,
      }),
      env,
    );
    expect(response.status).toBe(429);
    const body = await response.json<{ error: { message: string } }>();
    expect(body.error.message).toContain("storage quota");
  });

  it("applies per-user limits independently of the deployment limits", async () => {
    const userLimitsApp = createFlareMoApp({
      resolveUserPlanLimits: (_env, userId) =>
        userId === "users/owner" // the bootstrap owner only
          ? {
              attachmentStorageBytes: 10,
              aiEmbeddingTokensPerMonth: null,
              semanticSearchQueriesPerMonth: null,
            }
          : null,
      resolvePlanLimits: () => SELF_HOST_UNLIMITED,
    });

    const formData = new FormData();
    formData.set(
      "file",
      new File(["inline attachment"], "inline.txt", { type: "text/plain" }),
    );
    const response = await userLimitsApp.fetch(
      new Request("http://flaremo.test/api/v1/attachments", {
        method: "POST",
        headers: {
          cookie: sessionCookie,
          "x-flaremo-wire": "legacy",
          origin: "http://flaremo.test",
        },
        body: formData,
      }),
      env,
    );
    expect(response.status).toBe(429);
  });

  it("rejects memo creation over the per-user count cap with 429", async () => {
    const cappedApp = createFlareMoApp({
      resolveUserPlanLimits: (_env, userId) =>
        userId === "users/owner"
          ? {
              attachmentStorageBytes: null,
              aiEmbeddingTokensPerMonth: null,
              semanticSearchQueriesPerMonth: null,
              maxMemosPerUser: 1,
            }
          : null,
    });

    const createMemoRequest = () =>
      cappedApp.fetch(
        new Request("http://flaremo.test/api/v1/memos", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: sessionCookie,
            "x-flaremo-wire": "legacy",
            origin: "http://flaremo.test",
          },
          body: JSON.stringify({ content: "count cap probe" }),
        }),
        env,
      );

    const first = await createMemoRequest();
    expect(first.status).toBe(201);
    // The owner is now at the 1-memo cap; the next write must 429.
    const second = await createMemoRequest();
    expect(second.status).toBe(429);
    const body = (await second.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Memo count quota");
  });

  it("reports the per-user section on the usage endpoint when configured", async () => {
    const userLimitsApp = createFlareMoApp({
      resolveUserPlanLimits: () => ({
        attachmentStorageBytes: 1024,
        aiEmbeddingTokensPerMonth: 200_000,
        semanticSearchQueriesPerMonth: null,
      }),
    });
    const response = await userLimitsApp.fetch(
      new Request("http://flaremo.test/api/app/usage/vector", {
        headers: { cookie: sessionCookie },
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      plan?: {
        user?: {
          limits: Record<string, number | null>;
          usage: Record<string, number>;
        };
      };
    };
    expect(body.plan?.user?.limits).toEqual({
      attachmentStorageBytes: 1024,
      aiEmbeddingTokensPerMonth: 200_000,
      semanticSearchQueriesPerMonth: null,
    });
    expect(body.plan?.user?.usage.attachmentStorageBytes).toBe(0);
  });
});
