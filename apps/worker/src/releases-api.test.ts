import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTestRuntime,
  fetchWorker,
  type TestRuntime,
} from "./test-support/runtime";
import { bootstrapAndSignIn } from "./test-support/sign-in";

/**
 * The update check runs through the Worker so browsers that cannot reach
 * api.github.com (and shared IPs limited to 60 requests/hour) still see the
 * in-app "System update" entry.
 */
describe("release check proxy", () => {
  let runtime: TestRuntime | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    await runtime?.runtime.dispose();
    runtime = undefined;
  });

  it("returns the latest stable release through the Github proxy", async () => {
    runtime = await createTestRuntime({ name: "flaremo-releases" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const githubFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tag_name: "v0.29.0",
            name: "FlareMo v0.29.0",
            published_at: "2026-11-01T00:00:00Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", githubFetch);

    const response = await fetchWorker(
      new Request("http://flaremo.test/api/app/releases/latest", {
        headers: { cookie },
      }),
      runtime.env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: "0.29.0",
      name: "FlareMo v0.29.0",
      published_at: "2026-11-01T00:00:00Z",
      url: "https://github.com/realchendahuang/FlareMo/releases/tag/v0.29.0",
    });
    expect(String(githubFetch.mock.calls[0]?.[0])).toContain(
      "api.github.com/repos/realchendahuang/FlareMo/releases/latest",
    );
  });

  it("rejects a malformed repository override", async () => {
    runtime = await createTestRuntime({ name: "flaremo-releases" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const response = await fetchWorker(
      new Request(
        "http://flaremo.test/api/app/releases/latest?repository=not-a-repo",
        { headers: { cookie } },
      ),
      runtime.env,
    );
    expect(response.status).toBe(400);
  });

  it("maps an upstream failure to 502 without leaking the body", async () => {
    runtime = await createTestRuntime({ name: "flaremo-releases" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 403 })),
    );
    const response = await fetchWorker(
      new Request("http://flaremo.test/api/app/releases/latest", {
        headers: { cookie },
      }),
      runtime.env,
    );
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("403");
    expect(body.error.message).not.toContain("rate limited");
  });
});
