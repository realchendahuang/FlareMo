import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDb } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFlareMoAuth } from "./auth";
import type { FlareMoEnv } from "./env";
import app from "./index";

let runtime: Miniflare;
let env: Env;
let db: D1Database;

const TEST_AUTH_SECRET =
  "test-better-auth-secret-that-is-never-used-in-production";
const TEST_BOOTSTRAP_SECRET =
  "test-bootstrap-secret-that-is-never-used-in-production";
const TEST_RECOVERY_SECRET =
  "test-recovery-secret-that-is-never-used-in-production";
const INITIAL_PASSWORD = "test-password-not-for-production-123";
const UPDATED_PASSWORD = "updated-password-not-for-production-456";

describe("FlareMo native authentication", () => {
  beforeEach(async () => {
    ({ runtime, env, db } = await createTestRuntime());
  });

  afterEach(async () => {
    await runtime.dispose();
  });

  it("fails closed, bootstraps one owner, and preserves the existing domain owner", async () => {
    await expectPrivateRoutesToRejectWithoutCredentials();

    const initialStatus = await json<{
      initialized: boolean;
      state: string;
      setup_available: boolean;
    }>(await fetchRaw("/api/auth/flaremo/bootstrap/status"));
    expect(initialStatus).toEqual({
      initialized: false,
      state: "ready",
      setup_available: true,
    });

    const missingSecret = await fetchRaw("/api/auth/flaremo/bootstrap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://flaremo.test",
      },
      body: JSON.stringify(bootstrapInput()),
    });
    expect(missingSecret.status).toBe(403);

    const wrongSecret = await fetchRaw("/api/auth/flaremo/bootstrap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flaremo-bootstrap-secret": "wrong-bootstrap-secret",
        origin: "http://flaremo.test",
      },
      body: JSON.stringify(bootstrapInput()),
    });
    expect(wrongSecret.status).toBe(403);

    const bootstrap = await fetchRaw("/api/auth/flaremo/bootstrap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flaremo-bootstrap-secret": TEST_BOOTSTRAP_SECRET,
        origin: "http://flaremo.test",
      },
      body: JSON.stringify(bootstrapInput()),
    });
    expect(bootstrap.status).toBe(201);
    expect(await json(bootstrap)).toEqual({ ok: true });

    const owner = await db
      .prepare("SELECT id, email, name FROM users WHERE id = ?")
      .bind("users/owner")
      .first<{ id: string; email: string; name: string }>();
    expect(owner).toEqual({
      id: "users/owner",
      email: "owner@example.com",
      name: "Owner",
    });

    const completedStatus = await json<{
      initialized: boolean;
      state: string;
      setup_available: boolean;
    }>(await fetchRaw("/api/auth/flaremo/bootstrap/status"));
    expect(completedStatus).toEqual({
      initialized: true,
      state: "complete",
      setup_available: false,
    });

    const secondBootstrap = await fetchRaw("/api/auth/flaremo/bootstrap", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flaremo-bootstrap-secret": TEST_BOOTSTRAP_SECRET,
        origin: "http://flaremo.test",
      },
      body: JSON.stringify({
        ...bootstrapInput(),
        username: "another_owner",
        email: "another-owner@example.com",
      }),
    });
    expect(secondBootstrap.status).toBe(409);
  });

  it("returns a conflict rather than creating a second owner during concurrent bootstrap", async () => {
    const bootstrapRequest = () =>
      fetchRaw("/api/auth/flaremo/bootstrap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flaremo-bootstrap-secret": TEST_BOOTSTRAP_SECRET,
          origin: "http://flaremo.test",
        },
        body: JSON.stringify(bootstrapInput()),
      });

    const responses = await Promise.all([
      bootstrapRequest(),
      bootstrapRequest(),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);

    const authOwners = await db
      .prepare("SELECT COUNT(*) AS count FROM auth_users")
      .first<{ count: number }>();
    const ownerLinks = await db
      .prepare("SELECT COUNT(*) AS count FROM auth_user_links")
      .first<{ count: number }>();
    expect(authOwners?.count).toBe(1);
    expect(ownerLinks?.count).toBe(1);
  });

  it("does not mistake a partial link for complete and reconciles it in place", async () => {
    await bootstrapOwner();
    await db
      .prepare(
        "UPDATE auth_bootstrap SET state = ?, auth_user_id = NULL, flaremo_user_id = NULL, completed_at = NULL WHERE id = ?",
      )
      .bind("recovery_required", "bootstrap/owner")
      .run();

    const partialStatus = await json<{
      initialized: boolean;
      state: string;
      setup_available: boolean;
    }>(await fetchRaw("/api/auth/flaremo/bootstrap/status"));
    expect(partialStatus).toEqual({
      initialized: false,
      state: "recovery_required",
      setup_available: false,
    });

    const recovery = await fetchRaw("/api/auth/flaremo/recover-bootstrap", {
      method: "POST",
      headers: {
        "x-flaremo-recovery-secret": TEST_RECOVERY_SECRET,
        origin: "http://flaremo.test",
      },
    });
    expect(recovery.status).toBe(200);
    expect(await json(recovery)).toEqual({ ok: true });

    const completedStatus = await json<{
      initialized: boolean;
      state: string;
      setup_available: boolean;
    }>(await fetchRaw("/api/auth/flaremo/bootstrap/status"));
    expect(completedStatus).toEqual({
      initialized: true,
      state: "complete",
      setup_available: false,
    });

    const counts = await Promise.all([
      db
        .prepare("SELECT COUNT(*) AS count FROM auth_users")
        .first<{ count: number }>(),
      db
        .prepare("SELECT COUNT(*) AS count FROM auth_user_links")
        .first<{ count: number }>(),
      db
        .prepare("SELECT COUNT(*) AS count FROM users WHERE id = ?")
        .bind("users/owner")
        .first<{ count: number }>(),
    ]);
    expect(counts[0]?.count).toBe(1);
    expect(counts[1]?.count).toBe(1);
    expect(counts[2]?.count).toBe(1);
  });

  it("fails closed when bootstrap recovery finds multiple identities", async () => {
    await bootstrapOwner();
    const auth = createFlareMoAuth(env as FlareMoEnv, createDb(db), {
      allowBootstrapSignUp: true,
    });
    await auth.api.signUpEmail({
      body: {
        email: "second@example.com",
        name: "Second",
        password: INITIAL_PASSWORD,
        username: "second",
        displayUsername: "second",
      },
    });
    await db
      .prepare(
        "UPDATE auth_bootstrap SET state = ?, auth_user_id = NULL, flaremo_user_id = NULL, completed_at = NULL WHERE id = ?",
      )
      .bind("recovery_required", "bootstrap/owner")
      .run();

    const recovery = await fetchRaw("/api/auth/flaremo/recover-bootstrap", {
      method: "POST",
      headers: {
        "x-flaremo-recovery-secret": TEST_RECOVERY_SECRET,
        origin: "http://flaremo.test",
      },
    });
    expect(recovery.status).toBe(409);

    const counts = await Promise.all([
      db
        .prepare("SELECT COUNT(*) AS count FROM auth_users")
        .first<{ count: number }>(),
      db
        .prepare("SELECT COUNT(*) AS count FROM auth_user_links")
        .first<{ count: number }>(),
    ]);
    expect(counts[0]?.count).toBe(2);
    expect(counts[1]?.count).toBe(1);
  });

  it("requires an exact Origin for cookie auth mutations and keeps Access outside app identity", async () => {
    await bootstrapOwner();

    const missingOrigin = await fetchRaw("/api/auth/sign-in/username", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "owner", password: INITIAL_PASSWORD }),
    });
    expect(missingOrigin.status).toBe(403);

    const untrustedOrigin = await fetchRaw("/api/auth/sign-in/username", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://untrusted.example",
      },
      body: JSON.stringify({ username: "owner", password: INITIAL_PASSWORD }),
    });
    expect(untrustedOrigin.status).toBe(403);

    const trustedOrigin = await signIn("owner", INITIAL_PASSWORD);
    expect(trustedOrigin.response.status).toBe(200);

    const activeSession = await db
      .prepare(
        "SELECT token FROM auth_sessions ORDER BY created_at DESC LIMIT 1",
      )
      .first<{ token: string }>();
    expect(activeSession?.token).toBeTruthy();
    await db
      .prepare("UPDATE auth_sessions SET expires_at = ? WHERE token = ?")
      .bind(Date.now() - 1_000, activeSession?.token)
      .run();
    const expiredSession = await fetchRaw("/api/v1/memos", {
      headers: { authorization: `Bearer ${activeSession?.token}` },
    });
    expect(expiredSession.status).toBe(401);

    const signupAfterBootstrap = await fetchRaw("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://flaremo.test",
      },
      body: JSON.stringify({
        email: "second@example.com",
        name: "Second",
        password: INITIAL_PASSWORD,
        username: "second",
        displayUsername: "second",
      }),
    });
    expect(signupAfterBootstrap.status).toBeGreaterThanOrEqual(400);

    const accessOnly = await fetchRaw("/api/app/memos", {
      headers: {
        "cf-access-client-id": "access-only-id",
        "cf-access-client-secret": "access-only-secret",
      },
    });
    expect(accessOnly.status).toBe(401);
  });

  it("recovers the existing owner through Better Auth and revokes sessions and PATs", async () => {
    await bootstrapOwner();
    const firstSession = await signIn("owner", INITIAL_PASSWORD);
    const secondSession = await signIn("owner", INITIAL_PASSWORD);
    expect(firstSession.response.status).toBe(200);
    expect(secondSession.response.status).toBe(200);

    const createdPat = await fetchRaw(
      "/api/app/account/personal-access-tokens",
      {
        method: "POST",
        headers: authenticatedJsonHeaders(firstSession.cookie),
        body: JSON.stringify({ name: "recovery test", expires_in_days: 30 }),
      },
    );
    expect(createdPat.status).toBe(201);
    expect(createdPat.headers.get("cache-control")).toBe("no-store");
    const pat = await json<{ token: string }>(createdPat);

    const recovery = await fetchRaw("/api/auth/flaremo/recover", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flaremo-recovery-secret": TEST_RECOVERY_SECRET,
        origin: "http://flaremo.test",
      },
      body: JSON.stringify({ new_password: UPDATED_PASSWORD }),
    });
    expect(recovery.status).toBe(200);
    expect(await json(recovery)).toEqual({ ok: true });

    for (const cookie of [firstSession.cookie, secondSession.cookie]) {
      const staleSession = await fetchRaw("/api/app/memos", {
        headers: { cookie },
      });
      expect(staleSession.status).toBe(401);
    }

    const stalePat = await fetchRaw("/api/v1/memos", {
      headers: { authorization: `Bearer ${pat.token}` },
    });
    expect(stalePat.status).toBe(401);

    const oldPassword = await signIn("owner", INITIAL_PASSWORD);
    expect(oldPassword.response.ok).toBe(false);
    const recoveredPassword = await signIn("owner", UPDATED_PASSWORD);
    expect(recoveredPassword.response.status).toBe(200);
  });

  it("uses HttpOnly cookie sessions, supports account changes, and accepts revocable Memos PATs", async () => {
    await bootstrapOwner();
    const initialSignIn = await signIn("owner", INITIAL_PASSWORD);
    expect(initialSignIn.response.status).toBe(200);
    expect(initialSignIn.setCookie).toMatch(/HttpOnly/i);
    expect(initialSignIn.setCookie).toMatch(/SameSite=Lax/i);
    const originalCookie = initialSignIn.cookie;

    const privateMemo = await fetchRaw("/api/v1/memos", {
      method: "POST",
      headers: authenticatedJsonHeaders(originalCookie),
      body: JSON.stringify({ content: "cookie-protected memo" }),
    });
    expect(privateMemo.status).toBe(201);
    const memo = await json<{ name: string; creator: string }>(privateMemo);
    expect(memo.creator).toBe("users/owner");

    const crossOriginMutation = await fetchRaw("/api/app/memos", {
      method: "POST",
      headers: {
        ...authenticatedJsonHeaders(originalCookie),
        origin: "https://untrusted.example",
      },
      body: JSON.stringify({ content: "must not be created" }),
    });
    expect(crossOriginMutation.status).toBe(403);

    const usernameUpdate = await fetchRaw("/api/auth/update-user", {
      method: "POST",
      headers: authenticatedJsonHeaders(originalCookie),
      body: JSON.stringify({ username: "owner_updated" }),
    });
    expect(usernameUpdate.status).toBe(200);

    const passwordChange = await fetchRaw("/api/auth/change-password", {
      method: "POST",
      headers: authenticatedJsonHeaders(originalCookie),
      body: JSON.stringify({
        currentPassword: INITIAL_PASSWORD,
        newPassword: UPDATED_PASSWORD,
        revokeOtherSessions: true,
      }),
    });
    expect(passwordChange.status).toBe(200);
    const currentCookie = extractCookieHeader(passwordChange).cookie;

    const staleSession = await fetchRaw("/api/app/memos", {
      headers: { cookie: originalCookie },
    });
    expect(staleSession.status).toBe(401);

    const oldPassword = await signIn("owner_updated", INITIAL_PASSWORD);
    expect(oldPassword.response.ok).toBe(false);
    const freshSignIn = await signIn("owner_updated", UPDATED_PASSWORD);
    expect(freshSignIn.response.status).toBe(200);

    const createdPat = await fetchRaw(
      "/api/app/account/personal-access-tokens",
      {
        method: "POST",
        headers: authenticatedJsonHeaders(currentCookie),
        body: JSON.stringify({ name: "Memos desktop", expires_in_days: 30 }),
      },
    );
    expect(createdPat.status).toBe(201);
    const pat = await json<{
      token: string;
      personal_access_token: {
        id: string;
        start: string | null;
        enabled: boolean;
      };
    }>(createdPat);
    expect(pat.token).toMatch(/^memos_pat_/);
    expect(pat.personal_access_token.enabled).toBe(true);

    const listedPats = await fetchRaw(
      "/api/app/account/personal-access-tokens",
      {
        headers: { cookie: currentCookie },
      },
    );
    expect(listedPats.status).toBe(200);
    const patList = await json<{
      personal_access_tokens: Array<{ id: string; start: string | null }>;
    }>(listedPats);
    expect(patList.personal_access_tokens).toEqual([
      expect.objectContaining({ id: pat.personal_access_token.id }),
    ]);
    expect(JSON.stringify(patList)).not.toContain(pat.token);

    const patMemo = await fetchRaw("/api/v1/memos", {
      method: "POST",
      headers: {
        authorization: `Bearer ${pat.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: "Memos PAT memo" }),
    });
    expect(patMemo.status).toBe(201);

    const crossOriginPat = await fetchRaw("/api/v1/memos", {
      headers: {
        authorization: `Bearer ${pat.token}`,
        origin: "https://untrusted.example",
      },
    });
    expect(crossOriginPat.status).toBe(403);

    const patMcp = await fetchRaw("/api/v1/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${pat.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(patMcp.status).toBe(200);

    const patManagementAttempt = await fetchRaw(
      "/api/app/account/personal-access-tokens",
      { headers: { authorization: `Bearer ${pat.token}` } },
    );
    expect(patManagementAttempt.status).toBe(401);

    const invalidPat = await fetchRaw("/api/v1/memos", {
      headers: { authorization: "Bearer memos_pat_not_a_real_key" },
    });
    expect(invalidPat.status).toBe(401);

    const revokedPat = await fetchRaw(
      `/api/app/account/personal-access-tokens/${pat.personal_access_token.id}/revoke`,
      {
        method: "POST",
        headers: {
          cookie: currentCookie,
          origin: "http://flaremo.test",
        },
      },
    );
    expect(revokedPat.status).toBe(200);
    expect(
      (
        await json<{
          personal_access_token: { enabled: boolean };
        }>(revokedPat)
      ).personal_access_token.enabled,
    ).toBe(false);

    const revokedPatRequest = await fetchRaw("/api/v1/memos", {
      headers: { authorization: `Bearer ${pat.token}` },
    });
    expect(revokedPatRequest.status).toBe(401);

    const share = await fetchRaw(`/api/v1/${memo.name}/shares`, {
      method: "POST",
      headers: authenticatedJsonHeaders(currentCookie),
      body: JSON.stringify({}),
    });
    expect(share.status).toBe(201);
    const publicShare = await json<{ token: string }>(share);
    const anonymousShare = await fetchRaw(
      `/api/public/shares/${publicShare.token}`,
    );
    expect(anonymousShare.status).toBe(200);

    const signOut = await fetchRaw("/api/auth/sign-out", {
      method: "POST",
      headers: {
        cookie: currentCookie,
        origin: "http://flaremo.test",
      },
    });
    expect(signOut.status).toBe(200);
    const signedOutSession = await fetchRaw("/api/app/memos", {
      headers: { cookie: currentCookie },
    });
    expect(signedOutSession.status).toBe(401);
  });
});

async function expectPrivateRoutesToRejectWithoutCredentials() {
  for (const [path, init] of [
    ["/api/app/memos", undefined],
    ["/api/v1/memos", undefined],
    ["/api/v1/attachments", undefined],
    ["/api/v1/export", undefined],
    ["/api/v1/mcp", { method: "POST", body: "{}" }],
  ] as const) {
    const response = await fetchRaw(path, init);
    expect(response.status).toBe(401);
  }
}

async function bootstrapOwner() {
  const response = await fetchRaw("/api/auth/flaremo/bootstrap", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-flaremo-bootstrap-secret": TEST_BOOTSTRAP_SECRET,
      origin: "http://flaremo.test",
    },
    body: JSON.stringify(bootstrapInput()),
  });
  expect(response.status).toBe(201);
}

function bootstrapInput() {
  return {
    username: "owner",
    name: "Owner",
    email: "owner@example.com",
    password: INITIAL_PASSWORD,
  };
}

async function signIn(username: string, password: string) {
  const response = await fetchRaw("/api/auth/sign-in/username", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://flaremo.test",
    },
    body: JSON.stringify({ username, password }),
  });
  return {
    response,
    ...extractCookieHeader(response),
  };
}

function fetchRaw(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (path.startsWith("/api/v1/") && !headers.has("x-flaremo-wire")) {
    headers.set("x-flaremo-wire", "legacy");
  }
  return app.fetch(
    new Request(`http://flaremo.test${path}`, { ...init, headers }),
    env,
  );
}

function authenticatedJsonHeaders(cookie: string): HeadersInit {
  return {
    cookie,
    "content-type": "application/json",
    origin: "http://flaremo.test",
  };
}

function extractCookieHeader(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headers.getSetCookie?.() ?? [
    response.headers.get("set-cookie"),
  ];
  const values = setCookies.filter((value): value is string => Boolean(value));
  const cookies = values
    .map((value) => value.split(";", 1)[0] ?? "")
    .filter(Boolean);
  return {
    cookie: cookies.join("; "),
    setCookie: values.join(", "),
  };
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function createTestRuntime() {
  const instance = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "flaremo-auth-test" },
    r2Buckets: { ATTACHMENTS: "flaremo-auth-attachments-test" },
  });
  const database = await instance.getD1Database("DB");
  for (const filename of [
    "0000_illegal_inhumans.sql",
    "0001_familiar_morph.sql",
    "0002_wooden_professor_monster.sql",
    "0003_equal_maximus.sql",
    "0004_complex_the_enforcers.sql",
    "0005_confused_masque.sql",
    "0007_flat_phil_sheldon.sql",
    "0008_legal_scarecrow.sql",
    "0009_neat_iron_fist.sql",
  ]) {
    const migration = await readFile(
      resolve(import.meta.dirname, `../../../migrations/${filename}`),
      "utf8",
    );
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((item) => item.trim())
      .filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }

  return {
    runtime: instance,
    db: database,
    env: {
      DB: database,
      ATTACHMENTS: await instance.getR2Bucket("ATTACHMENTS"),
      ASSETS: {
        fetch: async () => new Response("asset", { status: 200 }),
      } as Fetcher,
      FLAREMO_DEPLOY_REPOSITORY: "",
      FLAREMO_SINGLE_USER_EMAIL: "owner@example.com",
      FLAREMO_SINGLE_USER_NAME: "Owner",
      FLAREMO_PUBLIC_URL: "http://flaremo.test",
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      FLAREMO_BOOTSTRAP_SECRET: TEST_BOOTSTRAP_SECRET,
      FLAREMO_RECOVERY_SECRET: TEST_RECOVERY_SECRET,
    } as Env,
  };
}
