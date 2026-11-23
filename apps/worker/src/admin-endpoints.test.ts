import { sha256Hex, zipPluginFiles } from "@flaremo/plugins/package";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppTestHarness } from "./test-support/app";
import {
  createTestRuntime,
  fetchWorker,
  type TestRuntime,
} from "./test-support/runtime";
import { bootstrapAndSignIn } from "./test-support/sign-in";

const encoder = new TextEncoder();

const validCardDocument = {
  specVersion: 1,
  root: {
    type: "column",
    style: {
      height: "100%",
      padding: 24,
      background: "#fbf8f1",
      color: "#2a241c",
    },
    children: [{ type: "text", text: "{body}", style: { flex: 1 } }],
  },
};

function buildManifest(overrides: Record<string, unknown> = {}) {
  return {
    specVersion: 1,
    id: "demo-pack",
    version: "1.2.0",
    name: { "zh-CN": "演示卡组", "en-US": "Demo cards" },
    contributes: {
      shareCardTemplates: [
        {
          id: "demo-card",
          kind: "document",
          name: { "zh-CN": "演示卡", en: "Demo" },
          document: "cards/demo.json",
        },
      ],
    },
    ...overrides,
  };
}

async function buildDemoPluginZip(
  manifestOverrides: Record<string, unknown> = {},
) {
  const bytes = await zipPluginFiles({
    "demo-pack/plugin.json": encoder.encode(
      JSON.stringify(buildManifest(manifestOverrides)),
    ),
    "demo-pack/cards/demo.json": encoder.encode(
      JSON.stringify(validCardDocument),
    ),
  });
  const sha256 = await sha256Hex(bytes);
  return { bytes, sha256 };
}

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

  it("installs a valid zip with SHA-256 verification, serves its assets, and cleans up on uninstall", async () => {
    runtime = await createTestRuntime({ name: "flaremo-admin-plugins-e2e" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const { bytes, sha256 } = await buildDemoPluginZip();
    const liveRegistry = {
      ...registry,
      plugins: [
        {
          ...registry.plugins[0],
          artifact: {
            url: "demo.zip",
            sha256,
            size: bytes.byteLength,
          },
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url === "https://flaremo.app/plugins/registry.json") {
          return new Response(JSON.stringify(liveRegistry), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "https://flaremo.app/plugins/demo.zip") {
          return new Response(bytes as unknown as BodyInit, {
            status: 200,
            headers: { "content-type": "application/zip" },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const install = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/install", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://flaremo.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: "demo-pack" }),
      }),
      runtime.env,
    );
    expect(install.status).toBe(200);
    const installedBody = (await install.json()) as {
      installed: { id: string; version: string; source: string };
    };
    expect(installedBody.installed).toMatchObject({
      id: "demo-pack",
      version: "1.2.0",
      source: "official",
    });

    // Enable the plugin so uninstall must also prune enabledPlugins/disabledPlugins.
    const enable = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins", {
        method: "PUT",
        headers: {
          cookie,
          origin: "http://flaremo.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabledPlugins: ["demo-pack"] }),
      }),
      runtime.env,
    );
    expect(enable.status).toBe(200);

    const storeAfterInstall = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/store", {
        headers: { cookie },
      }),
      runtime.env,
    );
    expect(
      ((await storeAfterInstall.json()) as StoreBody).entries[0]
        ?.installedVersion,
    ).toBe("1.2.0");

    const asset = await fetchWorker(
      new Request(
        "http://flaremo.test/api/app/plugins/assets/demo-pack/1.2.0/cards/demo.json",
      ),
      runtime.env,
    );
    expect(asset.status).toBe(200);
    expect(await asset.json()).toEqual(validCardDocument);

    const r2Before = await runtime.env.ATTACHMENTS.list({
      prefix: "plugins/demo-pack/1.2.0/",
    });
    expect(r2Before.objects.map((obj) => obj.key).sort()).toEqual([
      "plugins/demo-pack/1.2.0/cards/demo.json",
      "plugins/demo-pack/1.2.0/plugin.json",
    ]);

    const uninstall = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/demo-pack", {
        method: "DELETE",
        headers: {
          cookie,
          origin: "http://flaremo.test",
        },
      }),
      runtime.env,
    );
    expect(uninstall.status).toBe(200);
    await expect(uninstall.json()).resolves.toEqual({
      removed: true,
      id: "demo-pack",
      installed: [],
    });

    const r2After = await runtime.env.ATTACHMENTS.list({
      prefix: "plugins/demo-pack/",
    });
    expect(r2After.objects).toHaveLength(0);

    const publicSettings = await fetchWorker(
      new Request("http://flaremo.test/api/app/plugins"),
      runtime.env,
    );
    expect(await publicSettings.json()).toMatchObject({
      installed: [],
      enabledPlugins: [],
      disabledPlugins: [],
    });

    const assetAfterUninstall = await fetchWorker(
      new Request(
        "http://flaremo.test/api/app/plugins/assets/demo-pack/1.2.0/cards/demo.json",
      ),
      runtime.env,
    );
    expect(assetAfterUninstall.status).toBe(404);

    // Repeating uninstall on a removed plugin fails cleanly with 400.
    const repeatUninstall = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/demo-pack", {
        method: "DELETE",
        headers: {
          cookie,
          origin: "http://flaremo.test",
        },
      }),
      runtime.env,
    );
    expect(repeatUninstall.status).toBe(400);
  });

  it("rejects tampered SHA-256 checksums and invalid plugin manifests without writing to R2", async () => {
    runtime = await createTestRuntime({
      name: "flaremo-admin-plugins-invalid",
    });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const { bytes: validZip } = await buildDemoPluginZip();
    const { bytes: badManifestZip, sha256: badManifestSha } =
      await buildDemoPluginZip({ specVersion: 99 });

    let serveBadManifest = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = String(input);
        if (url === "https://flaremo.app/plugins/registry.json") {
          return new Response(
            JSON.stringify({
              ...registry,
              plugins: [
                {
                  ...registry.plugins[0],
                  artifact: serveBadManifest
                    ? {
                        url: "demo.zip",
                        sha256: badManifestSha,
                        size: badManifestZip.byteLength,
                      }
                    : {
                        url: "demo.zip",
                        sha256: "b".repeat(64),
                        size: validZip.byteLength,
                      },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          (serveBadManifest ? badManifestZip : validZip) as unknown as BodyInit,
          { status: 200, headers: { "content-type": "application/zip" } },
        );
      }),
    );

    // 1. Tampered SHA-256 digest is rejected before unpacking.
    const checksumMismatch = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/install", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://flaremo.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: "demo-pack" }),
      }),
      runtime.env,
    );
    expect(checksumMismatch.status).toBe(400);
    expect(
      ((await checksumMismatch.json()) as { error: { message: string } }).error
        .message,
    ).toContain("checksum does not match");

    // 2. Valid SHA-256 but invalid manifest inside the archive returns 400 (never 500).
    serveBadManifest = true;
    const badManifestInstall = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/install", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://flaremo.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: "demo-pack" }),
      }),
      runtime.env,
    );
    expect(badManifestInstall.status).toBe(400);
    expect(
      ((await badManifestInstall.json()) as { error: { message: string } })
        .error.message,
    ).toContain("specVersion");

    // 3. Direct upload with an invalid manifest also returns 400.
    const badUpload = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/upload", {
        method: "POST",
        headers: {
          cookie,
          origin: "http://flaremo.test",
          "content-type": "application/zip",
        },
        body: badManifestZip as unknown as BodyInit,
      }),
      runtime.env,
    );
    expect(badUpload.status).toBe(400);

    const listed = await runtime.env.ATTACHMENTS.list({ prefix: "plugins/" });
    expect(listed.objects).toHaveLength(0);
  });

  it("enforces owner-only and admin-PAT guards on plugin install and uninstall", async () => {
    runtime = await createTestRuntime({ name: "flaremo-admin-plugins-guards" });
    const currentRuntime = runtime;
    const ownerCookie = await bootstrapAndSignIn(currentRuntime.env);
    const { createActivatedMember } = createAppTestHarness(() => ({
      env: currentRuntime.env,
      sessionCookie: ownerCookie,
    }));

    const member = await createActivatedMember(
      "member@example.com",
      "Regular Member",
    );
    const teamAdmin = await createActivatedMember(
      "admin@example.com",
      "Team Admin",
    );
    const promote = await fetchWorker(
      new Request(
        `http://flaremo.test/api/app/admin/users/${encodeURIComponent(teamAdmin.id)}/role`,
        {
          method: "PATCH",
          headers: {
            cookie: ownerCookie,
            origin: "http://flaremo.test",
            "content-type": "application/json",
          },
          body: JSON.stringify({ role: "admin" }),
        },
      ),
      currentRuntime.env,
    );
    expect(promote.status).toBe(200);

    // Unauthenticated callers get 401.
    for (const [method, path] of [
      ["POST", "/api/app/admin/plugins/install"],
      ["DELETE", "/api/app/admin/plugins/demo-pack"],
    ] as const) {
      const response = await fetchWorker(
        new Request(`http://flaremo.test${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: method === "POST" ? JSON.stringify({ id: "demo-pack" }) : null,
        }),
        currentRuntime.env,
      );
      expect(response.status).toBe(401);
    }

    // Both a regular member and a non-owner team admin are rejected with 403.
    for (const actorCookie of [member.cookie, teamAdmin.cookie]) {
      const installAttempt = await fetchWorker(
        new Request("http://flaremo.test/api/app/admin/plugins/install", {
          method: "POST",
          headers: {
            cookie: actorCookie,
            origin: "http://flaremo.test",
            "content-type": "application/json",
          },
          body: JSON.stringify({ id: "demo-pack" }),
        }),
        currentRuntime.env,
      );
      expect(installAttempt.status).toBe(403);

      const uninstallAttempt = await fetchWorker(
        new Request("http://flaremo.test/api/app/admin/plugins/demo-pack", {
          method: "DELETE",
          headers: {
            cookie: actorCookie,
            origin: "http://flaremo.test",
          },
        }),
        currentRuntime.env,
      );
      expect(uninstallAttempt.status).toBe(403);
    }

    // Owner PAT with default `notes` scope gets 403; owner PAT with `admin` scope succeeds.
    const mintPat = async (scopes?: string[]) => {
      const res = await fetchWorker(
        new Request(
          "http://flaremo.test/api/app/account/personal-access-tokens",
          {
            method: "POST",
            headers: {
              cookie: ownerCookie,
              origin: "http://flaremo.test",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              name: scopes ? "admin-pat" : "notes-pat",
              ...(scopes ? { scopes } : {}),
            }),
          },
        ),
        currentRuntime.env,
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as { token: string }).token;
    };

    const notesPat = await mintPat();
    const adminPat = await mintPat(["admin"]);
    const { bytes, sha256 } = await buildDemoPluginZip();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        if (String(input) === "https://flaremo.app/plugins/registry.json") {
          return new Response(
            JSON.stringify({
              ...registry,
              plugins: [
                {
                  ...registry.plugins[0],
                  artifact: {
                    url: "demo.zip",
                    sha256,
                    size: bytes.byteLength,
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(bytes as unknown as BodyInit, {
          status: 200,
          headers: { "content-type": "application/zip" },
        });
      }),
    );

    const notesInstall = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/install", {
        method: "POST",
        headers: {
          authorization: `Bearer ${notesPat}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: "demo-pack" }),
      }),
      currentRuntime.env,
    );
    expect(notesInstall.status).toBe(403);

    const adminInstall = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/install", {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminPat}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: "demo-pack" }),
      }),
      currentRuntime.env,
    );
    expect(adminInstall.status).toBe(200);

    const adminUninstall = await fetchWorker(
      new Request("http://flaremo.test/api/app/admin/plugins/demo-pack", {
        method: "DELETE",
        headers: { authorization: `Bearer ${adminPat}` },
      }),
      currentRuntime.env,
    );
    expect(adminUninstall.status).toBe(200);
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
