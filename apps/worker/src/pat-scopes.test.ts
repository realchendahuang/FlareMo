import { authApiKeys, createDb } from "@flaremo/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTestRuntime,
  fetchWorker,
  type TestRuntime,
} from "./test-support/runtime";
import { bootstrapAndSignIn } from "./test-support/sign-in";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("personal access token scopes", () => {
  let runtime: TestRuntime | undefined;

  afterEach(async () => {
    await runtime?.runtime.dispose();
    runtime = undefined;
  });

  async function createToken(
    cookie: string,
    body: Record<string, unknown>,
  ): Promise<{
    id: string;
    token: string;
    scopes: string[];
    expires_at: string;
  }> {
    const response = await fetchWorker(
      new Request(
        "http://flaremo.test/api/app/account/personal-access-tokens",
        {
          method: "POST",
          headers: {
            cookie,
            origin: "http://flaremo.test",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      ),
      runtime!.env,
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      token: string;
      personal_access_token: {
        id: string;
        scopes: string[];
        expires_at: string;
      };
    };
    return {
      id: payload.personal_access_token.id,
      token: payload.token,
      scopes: payload.personal_access_token.scopes,
      expires_at: payload.personal_access_token.expires_at,
    };
  }

  function patRequest(token: string, path: string, init?: RequestInit) {
    return fetchWorker(
      new Request(`http://flaremo.test${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      }),
      runtime!.env,
    );
  }

  it("defaults new tokens to notes scope and 90 days", async () => {
    runtime = await createTestRuntime({ name: "flaremo-pat-scope-default" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const created = await createToken(cookie, { name: "notes-token" });

    expect(created.scopes).toEqual(["notes"]);
    const days = (new Date(created.expires_at).getTime() - Date.now()) / DAY_MS;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);

    // The content API is inside the notes scope.
    const memo = await patRequest(created.token, "/api/v1/memos", {
      method: "POST",
      body: JSON.stringify({ content: "written by a scoped token" }),
    });
    expect(memo.status).toBe(200);

    // The owner-only admin surface is not.
    const admin = await patRequest(
      created.token,
      "/api/app/admin/embeddings/rebuild",
      { method: "POST", body: "{}" },
    );
    expect(admin.status).toBe(403);
  });

  it("lets an admin-scoped token reach the admin surface", async () => {
    runtime = await createTestRuntime({ name: "flaremo-pat-scope-admin" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const created = await createToken(cookie, {
      name: "admin-token",
      scopes: ["admin"],
      expires_in_days: 7,
    });
    expect(created.scopes).toContain("admin");
    const days = (new Date(created.expires_at).getTime() - Date.now()) / DAY_MS;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(8);

    const admin = await patRequest(
      created.token,
      "/api/app/admin/embeddings/rebuild",
      { method: "POST", body: "{}" },
    );
    // Reaching the handler proves the scope gate passed; it then reports the
    // missing append-only/Vectorize configuration.
    expect(admin.status).toBe(400);
  });

  it("keeps legacy tokens without permissions unrestricted", async () => {
    runtime = await createTestRuntime({ name: "flaremo-pat-scope-legacy" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const created = await createToken(cookie, { name: "legacy-token" });

    const db = createDb(runtime.db);
    await db
      .update(authApiKeys)
      .set({ permissions: null })
      .where(eq(authApiKeys.id, created.id));

    const admin = await patRequest(
      created.token,
      "/api/app/admin/embeddings/rebuild",
      { method: "POST", body: "{}" },
    );
    expect(admin.status).toBe(400);
  });
});
