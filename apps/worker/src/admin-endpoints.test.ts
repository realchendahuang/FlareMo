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
