import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTestRuntime,
  fetchWorker,
  type TestRuntime,
} from "./test-support/runtime";
import { bootstrapAndSignIn } from "./test-support/sign-in";

const registry = {
  specVersion: 1,
  name: "official",
  plugins: [
    {
      id: "demo-pack",
      version: "1.2.0",
      tier: "official",
      name: { "zh-CN": "演示卡组", en: "Demo cards" },
      preview: "demo.png",
      artifact: { url: "demo.zip", sha256: "a".repeat(64), size: 10 },
    },
  ],
};

type StoreBody = {
  sources: Array<{ id: string; error: string | null }>;
  entries: Array<{
    id: string;
    installedVersion: string | null;
    preview: string | null;
  }>;
};

describe("admin plugin store", () => {
  let runtime: TestRuntime | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    await runtime?.runtime.dispose();
    runtime = undefined;
  });

  it("requires an owner session and resolves directory entries", async () => {
    runtime = await createTestRuntime({ name: "flaremo-admin-plugins" });
    const unauth = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/store"),
      runtime.env,
    );
    expect(unauth.status).toBe(401);

    const cookie = await bootstrapAndSignIn(runtime.env);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(registry), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const response = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/store", {
        headers: { cookie },
      }),
      runtime.env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as StoreBody;
    expect(body.entries[0]?.id).toBe("demo-pack");
    expect(body.entries[0]?.installedVersion).toBeNull();
    expect(body.entries[0]?.preview).toBe(
      "https://flaremo.app/plugins/demo.png",
    );
    expect(body.sources[0]?.error).toBeNull();
  });

  it("blocks custom directory sources that target private hosts", async () => {
    runtime = await createTestRuntime({ name: "flaremo-admin-plugins" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(registry), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const update = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/sources", {
        method: "PUT",
        headers: {
          cookie,
          origin: "http://flaremo.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sources: [
            {
              id: "private-host",
              name: "Private host",
              url: "https://127.0.0.1/registry.json",
            },
          ],
        }),
      }),
      runtime.env,
    );
    expect(update.status).toBe(200);

    const response = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/store", {
        headers: { cookie },
      }),
      runtime.env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as StoreBody;
    expect(
      body.sources.find((source) => source.id === "private-host"),
    ).toMatchObject({
      error: "directory unreachable",
    });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://flaremo.app/plugins/registry.json",
    ]);
  });

  it("blocks plugin artifacts outside the HTTPS contract", async () => {
    runtime = await createTestRuntime({ name: "flaremo-admin-plugins" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const firstPlugin = registry.plugins[0];
    if (!firstPlugin) throw new Error("registry fixture must contain a plugin");
    const unsafeRegistry = {
      ...registry,
      plugins: [
        {
          ...firstPlugin,
          artifact: {
            ...firstPlugin.artifact,
            url: "http://example.com/demo.zip",
          },
        },
      ],
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(unsafeRegistry), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const update = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/sources", {
        method: "PUT",
        headers: {
          cookie,
          origin: "http://flaremo.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sources: [
            {
              id: "custom",
              name: "Custom",
              url: "https://example.com/registry.json",
            },
          ],
        }),
      }),
      runtime.env,
    );
    expect(update.status).toBe(200);

    const install = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/install", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://flaremo.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: "demo-pack", sourceId: "custom" }),
      }),
      runtime.env,
    );
    expect(install.status).toBe(400);
    const body = (await install.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Package download failed");
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://example.com/registry.json",
    ]);
  });

  it("reports an unreachable directory without failing the whole request", async () => {
    runtime = await createTestRuntime({ name: "flaremo-admin-plugins" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    const response = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/store", {
        headers: { cookie },
      }),
      runtime.env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as StoreBody;
    expect(body.entries).toEqual([]);
    expect(body.sources[0]?.error).toContain("503");
  });
});

describe("admin maintenance endpoints", () => {
  let runtime: TestRuntime | undefined;

  afterEach(async () => {
    await runtime?.runtime.dispose();
    runtime = undefined;
  });

  it("guards the embedding rebuild endpoint and reports missing configuration", async () => {
    runtime = await createTestRuntime({ name: "flaremo-admin-maintenance" });
    const path = "http://flaremo.test/api/app/admin/embeddings/rebuild";
    const unauth = await fetchWorker(
      new Request(path, { method: "POST" }),
      runtime.env,
    );
    expect(unauth.status).toBe(401);

    const cookie = await bootstrapAndSignIn(runtime.env);
    const rebuild = await fetchWorker(
      new Request(path, {
        method: "POST",
        headers: { cookie, origin: "http://flaremo.test" },
      }),
      runtime.env,
    );
    expect(rebuild.status).toBe(400);
    const body = (await rebuild.json()) as { error: { message: string } };
    expect(body.error.message).toContain("not configured");
  });
});
