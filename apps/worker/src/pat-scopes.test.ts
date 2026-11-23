import { applyFlaremoMigrations, authApiKeys, createDb } from "@flaremo/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTestRuntime,
  fetchWorker,
  type TestRuntime,
} from "./test-support/runtime";
import { bootstrapAndSignIn } from "./test-support/sign-in";

const DAY_MS = 24 * 60 * 60 * 1000;

function expiresInDays(value: string | null): number {
  if (!value) throw new Error("expected a finite token expiry");
  return (new Date(value).getTime() - Date.now()) / DAY_MS;
}

describe("personal access token scopes", () => {
  let runtime: TestRuntime | undefined;

  afterEach(async () => {
    await runtime?.runtime.dispose();
    runtime = undefined;
  });

  function requireRuntime(): TestRuntime {
    if (!runtime) throw new Error("test runtime was not initialized");
    return runtime;
  }

  async function createToken(
    cookie: string,
    body: Record<string, unknown>,
  ): Promise<{
    id: string;
    token: string;
    scopes: string[];
    expires_at: string | null;
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
      requireRuntime().env,
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      token: string;
      personal_access_token: {
        id: string;
        scopes: string[];
        expires_at: string | null;
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
      requireRuntime().env,
    );
  }

  it("defaults new tokens to notes scope and 365 days", async () => {
    runtime = await createTestRuntime({ name: "flaremo-pat-scope-default" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const created = await createToken(cookie, { name: "notes-token" });

    expect(created.scopes).toEqual(["notes"]);
    const days = expiresInDays(created.expires_at);
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(366);

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

  it("lets a notes-only token opt into a permanent lifetime", async () => {
    runtime = await createTestRuntime({ name: "flaremo-pat-scope-permanent" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const created = await createToken(cookie, {
      name: "permanent-notes-token",
      expires_in_days: 0,
    });

    expect(created.scopes).toEqual(["notes"]);
    expect(created.expires_at).toBeNull();

    const memo = await patRequest(created.token, "/api/v1/memos", {
      method: "POST",
      body: JSON.stringify({ content: "written by a permanent notes token" }),
    });
    expect(memo.status).toBe(200);
  });

  it("refuses a permanent lifetime for admin-scoped tokens", async () => {
    runtime = await createTestRuntime({
      name: "flaremo-pat-scope-admin-expiry",
    });
    const cookie = await bootstrapAndSignIn(runtime.env);
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
          body: JSON.stringify({
            name: "bad-admin-token",
            expires_in_days: 0,
            scopes: ["admin"],
          }),
        },
      ),
      requireRuntime().env,
    );
    expect(response.status).toBe(400);
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
    const days = expiresInDays(created.expires_at);
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

  it("keeps an un-migrated token without permissions unrestricted", async () => {
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

  it("backfills empty legacy permissions to the notes scope", async () => {
    runtime = await createTestRuntime({ name: "flaremo-pat-scope-backfill" });
    const cookie = await bootstrapAndSignIn(runtime.env);
    const created = await createToken(cookie, { name: "legacy-token" });

    const db = createDb(runtime.db);
    await db
      .update(authApiKeys)
      .set({ permissions: null })
      .where(eq(authApiKeys.id, created.id));

    await applyFlaremoMigrations(runtime.db, {
      fromTag: "0050_pat_scope_backfill",
    });

    const [row] = await db
      .select({ permissions: authApiKeys.permissions })
      .from(authApiKeys)
      .where(eq(authApiKeys.id, created.id));
    expect(row?.permissions).toBe('{"memos":["read","write"]}');

    const admin = await patRequest(
      created.token,
      "/api/app/admin/embeddings/rebuild",
      { method: "POST", body: "{}" },
    );
    expect(admin.status).toBe(403);
  });
});
