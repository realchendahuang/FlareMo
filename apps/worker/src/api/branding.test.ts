import { FLAREMO_API_VERSION } from "@flaremo/contracts";
import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runScheduledMaintenance } from "../index";
import { createAppTestHarness, json } from "../test-support/app";
import { createTestRuntime } from "../test-support/runtime";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { fetchApp, bootstrapAndSignIn } = createAppTestHarness(() => ({
  env,
  sessionCookie,
}));

describe("FlareMo branding API", () => {
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

  it("exposes release, repository, and scheduler heartbeat metadata on /api/app/health", async () => {
    const beforeRun = await json<{ scheduler: unknown }>(
      await fetchApp("http://flaremo.test/api/app/health"),
    );

    expect(beforeRun).toMatchObject({
      ok: true,
      product: "FlareMo",
      version: FLAREMO_API_VERSION,
      update_repository: "example/flaremo",
      update_workflow_url:
        "https://github.com/example/flaremo/actions/workflows/flaremo-update.yml",
      releases_url: "https://github.com/realchendahuang/FlareMo/releases",
      scheduler: null,
    });

    const scheduledTime = Date.parse("2026-11-18T03:17:00.000Z");
    await runScheduledMaintenance(env, scheduledTime);

    const afterRun = await json<{
      scheduler: {
        ok: boolean;
        lastRunAt: string;
        scheduledAt: string;
        durationMs: number;
        totalSteps: number;
        failedSteps: number;
      } | null;
    }>(await fetchApp("http://flaremo.test/api/app/health"));

    expect(afterRun.scheduler).toMatchObject({
      ok: true,
      scheduledAt: "2026-11-18T03:17:00.000Z",
      failedSteps: 0,
    });
    expect(afterRun.scheduler?.durationMs).toBeGreaterThanOrEqual(0);
    expect(afterRun.scheduler?.totalSteps).toBeGreaterThan(0);
  });

  it("serves default branding to anonymous visitors", async () => {
    const response = await fetchApp(
      "http://flaremo.test/api/app/branding",
      { method: "GET" },
      { authenticated: false },
    );
    expect(response.status).toBe(200);
    const body = await json<{ product: string; mark_light_url: string | null }>(
      response,
    );
    expect(body.product).toBe("FlareMo");
    expect(body.mark_light_url).toBeNull();
  });

  it("reflects a custom product name in public branding and health", async () => {
    const put = await fetchApp("http://flaremo.test/api/app/admin/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_name: "KOS Notes" }),
    });
    expect(put.status).toBe(200);
    const anonymous = await fetchApp(
      "http://flaremo.test/api/app/branding",
      { method: "GET" },
      { authenticated: false },
    );
    expect((await json<{ product: string }>(anonymous)).product).toBe(
      "KOS Notes",
    );
    const health = await json(
      await fetchApp("http://flaremo.test/api/app/health"),
    );
    expect(health.product).toBe("KOS Notes");
  });

  it("stores, publishes, and resets an accent preset", async () => {
    const rejected = await fetchApp(
      "http://flaremo.test/api/app/admin/branding",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accent: "neon-magenta" }),
      },
    );
    expect(rejected.status).toBe(400);

    const put = await fetchApp("http://flaremo.test/api/app/admin/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accent: "iris" }),
    });
    expect(put.status).toBe(200);
    expect((await json<{ accent: string }>(put)).accent).toBe("iris");

    const anonymous = await fetchApp(
      "http://flaremo.test/api/app/branding",
      { method: "GET" },
      { authenticated: false },
    );
    expect((await json<{ accent: string }>(anonymous)).accent).toBe("iris");

    const reset = await fetchApp("http://flaremo.test/api/app/admin/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accent: null }),
    });
    expect((await json<{ accent: string }>(reset)).accent).toBe("flame");
  });

  it("stores a custom seed accent and enforces the hex contract", async () => {
    const withoutHex = await fetchApp(
      "http://flaremo.test/api/app/admin/branding",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accent: "custom" }),
      },
    );
    expect(withoutHex.status).toBe(400);

    const hexOnly = await fetchApp(
      "http://flaremo.test/api/app/admin/branding",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accent_hex: "#7c3aed" }),
      },
    );
    // Hex without the custom accent is a no-op, not an error.
    expect(hexOnly.status).toBe(200);
    expect((await json<{ accent: string }>(hexOnly)).accent).toBe("flame");

    const put = await fetchApp("http://flaremo.test/api/app/admin/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accent: "custom", accent_hex: "#7C3AED" }),
    });
    expect(put.status).toBe(200);
    const saved = await json<{ accent: string; accent_hex: string }>(put);
    expect(saved.accent).toBe("custom");
    expect(saved.accent_hex).toBe("#7c3aed");

    const anonymous = await fetchApp(
      "http://flaremo.test/api/app/branding",
      { method: "GET" },
      { authenticated: false },
    );
    const published = await json<{
      accent: string;
      accent_hex: string | null;
    }>(anonymous);
    expect(published.accent).toBe("custom");
    expect(published.accent_hex).toBe("#7c3aed");

    const reseed = await fetchApp(
      "http://flaremo.test/api/app/admin/branding",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accent_hex: "#0ea5e9" }),
      },
    );
    expect((await json<{ accent_hex: string }>(reseed)).accent_hex).toBe(
      "#0ea5e9",
    );

    const reset = await fetchApp("http://flaremo.test/api/app/admin/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accent: "flame", accent_hex: null }),
    });
    expect(
      await json<{ accent: string; accent_hex: string | null }>(reset),
    ).toMatchObject({ accent: "flame", accent_hex: null });
  });

  it("uploads, serves, and removes a custom logo mark", async () => {
    // Minimal 1x1 PNG.
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (char) => char.charCodeAt(0),
    );
    const upload = await fetchApp(
      "http://flaremo.test/api/app/admin/branding/marks/light",
      {
        body: png,
        headers: { "content-type": "image/png" },
        method: "PUT",
      },
    );
    expect(upload.status).toBe(200);

    const anonymous = await fetchApp(
      "http://flaremo.test/api/app/branding",
      { method: "GET" },
      { authenticated: false },
    );
    const branding = await json<{ mark_light_url: string | null }>(anonymous);
    expect(branding.mark_light_url).toContain("/api/app/branding/marks/light");

    const mark = await fetchApp(
      `http://flaremo.test${branding.mark_light_url}`,
      { method: "GET" },
      { authenticated: false },
    );
    expect(mark.status).toBe(200);
    expect(mark.headers.get("content-type")).toBe("image/png");

    const remove = await fetchApp(
      "http://flaremo.test/api/app/admin/branding/marks/light",
      { method: "DELETE" },
    );
    expect(remove.status).toBe(200);
    const after = await fetchApp(
      "http://flaremo.test/api/app/branding",
      { method: "GET" },
      { authenticated: false },
    );
    expect(
      (await json<{ mark_light_url: string | null }>(after)).mark_light_url,
    ).toBeNull();
  });

  it("rejects unsupported logo content types", async () => {
    const response = await fetchApp(
      "http://flaremo.test/api/app/admin/branding/marks/light",
      {
        body: "<svg></svg>",
        headers: { "content-type": "text/html" },
        method: "PUT",
      },
    );
    expect(response.status).toBe(400);
  });

  it("does not create an update link from an invalid repository value", async () => {
    env.FLAREMO_DEPLOY_REPOSITORY = "https://github.com/example/flaremo";
    const health = await json(
      await fetchApp("http://flaremo.test/api/app/health"),
    );

    expect(health).toMatchObject({
      update_repository: null,
      update_workflow_url: null,
    });
  });

  it("returns JSON authentication errors for protected metadata endpoints", async () => {
    const health = await fetchApp(
      "http://flaremo.test/api/app/health",
      undefined,
      { authenticated: false },
    );
    expect(health.status).toBe(401);
    expect(health.headers.get("content-type")).toContain("application/json");
    expect(await health.json()).toEqual({
      error: { message: "Authentication required" },
    });

    const openapi = await fetchApp(
      "http://flaremo.test/api/v1/openapi.json",
      undefined,
      { authenticated: false },
    );
    expect(openapi.status).toBe(401);
    expect(openapi.headers.get("content-type")).toContain("application/json");
    expect(await openapi.json()).toEqual({
      error: { message: "Authentication required" },
    });
  });
});
