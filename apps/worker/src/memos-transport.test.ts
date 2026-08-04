import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "./index";
import { buildMemosRefreshCookie } from "./memos-native-auth";

let mf: Miniflare;
let env: Env;
let accessToken: string;
let sessionCookie: string;
let refreshCookie: string;
let opaqueSessionToken: string;
let refreshSetCookie: string;

const TEST_AUTH_SECRET =
  "transport-test-better-auth-secret-never-used-in-production";
const TEST_BOOTSTRAP_SECRET =
  "transport-test-bootstrap-secret-never-used-in-production";
const TEST_PASSWORD = "transport-test-password-never-production-123";

describe("Memos native auth and transport boundaries", () => {
  beforeEach(async () => {
    ({ mf, env } = await createTestRuntime());
    ({
      accessToken,
      opaqueSessionToken,
      sessionCookie,
      refreshCookie,
      refreshSetCookie,
    } = await signInCurrent());
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("rejects malformed, forged, expired, and wrongly-scoped native JWTs", async () => {
    const validClaims = {
      type: "access",
      role: "ADMIN",
      status: "NORMAL",
      username: "owner",
      iss: "memos",
      sub: "1",
      aud: ["user.access-token"],
      iat: Math.floor(Date.now() / 1_000),
      exp: Math.floor(Date.now() / 1_000) + 900,
    };

    const forged = await signTestJwt(validClaims, "wrong-secret");
    const wrongAudience = await signTestJwt(
      { ...validClaims, aud: ["wrong-audience"] },
      TEST_AUTH_SECRET,
    );
    const wrongKeyId = await signTestJwt(validClaims, TEST_AUTH_SECRET, {
      alg: "HS256",
      kid: "v2",
      typ: "JWT",
    });
    const wrongAlgorithm = await signTestJwt(validClaims, TEST_AUTH_SECRET, {
      alg: "HS512",
      kid: "v1",
      typ: "JWT",
    });
    const expired = await signTestJwt(
      { ...validClaims, exp: validClaims.iat - 1 },
      TEST_AUTH_SECRET,
    );

    for (const token of [
      "not-a-jwt",
      forged,
      wrongAudience,
      wrongKeyId,
      wrongAlgorithm,
      expired,
    ]) {
      const response = await request("/api/v1/auth/me", {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(401);
    }

    const native = await request("/api/v1/auth/me", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(native.status).toBe(200);
    expect(await native.json()).toMatchObject({
      user: { name: "users/owner", username: "owner" },
    });

    const opaqueSession = await request("/api/v1/auth/me", {
      headers: { authorization: `Bearer ${opaqueSessionToken}` },
    });
    expect(opaqueSession.status).toBe(200);
  });

  it("rotates and revokes memos_refresh with secure cookie attributes", async () => {
    expect(refreshSetCookie).toContain("HttpOnly");
    expect(refreshSetCookie).toContain("SameSite=Lax");
    expect(refreshSetCookie).toContain("Path=/");
    expect(refreshSetCookie).not.toContain("Secure");

    const secureCookie = buildMemosRefreshCookie(
      new Request("https://flaremo.test"),
      "fixture-refresh-token",
      new Date("2030-01-01T00:00:00.000Z"),
    );
    expect(secureCookie).toContain("HttpOnly");
    expect(secureCookie).toContain("SameSite=Lax");
    expect(secureCookie).toContain("Secure");

    const rotated = await request("/api/v1/auth/refresh", {
      method: "POST",
      headers: {
        cookie: refreshCookie,
        origin: "http://flaremo.test",
      },
    });
    expect(rotated.status).toBe(200);
    const rotatedCookies = setCookiePairs(rotated);
    const nextRefreshCookie = findCookie(rotatedCookies, "memos_refresh");
    expect(nextRefreshCookie).not.toBe(refreshCookie);
    expect((await rotated.json()) as { accessToken: string }).toMatchObject({
      accessToken: expect.any(String),
    });

    const reused = await request("/api/v1/auth/refresh", {
      method: "POST",
      headers: {
        cookie: refreshCookie,
        origin: "http://flaremo.test",
      },
    });
    expect(reused.status).toBe(401);

    const signedOut = await request("/api/v1/auth/signout", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        cookie: nextRefreshCookie,
        origin: "http://flaremo.test",
      },
    });
    expect(signedOut.status).toBe(200);
    const cleared = findCookie(setCookieValues(signedOut), "memos_refresh");
    expect(cleared).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");

    const afterSignout = await request("/api/v1/auth/refresh", {
      method: "POST",
      headers: {
        cookie: nextRefreshCookie,
        origin: "http://flaremo.test",
      },
    });
    expect(afterSignout.status).toBe(401);
  });

  it("serves the canonical Connect JSON unary subset and authenticated SSE stream", async () => {
    const connectPath = "/memos.api.v1.MemoService/CreateMemo";
    const unsupported = await request(connectPath, {
      method: "POST",
      headers: { "content-type": "application/proto" },
      body: "binary-not-supported",
    });
    expect(unsupported.status).toBe(415);

    const missingOriginCookieMutation = await request(connectPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie,
      },
      body: JSON.stringify({ memo: { content: "must require origin" } }),
    });
    expect(missingOriginCookieMutation.status).toBe(403);

    const created = await connect("CreateMemo", {
      memo: { content: "Connect JSON memo" },
    });
    expect(created).toMatchObject({
      name: expect.stringMatching(/^memos\//),
      content: "Connect JSON memo",
    });

    const listed = await connect("ListMemos", {
      pageSize: 10,
      orderBy: "create_time desc",
    });
    expect(listed.memos).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: created.name })]),
    );

    const fetched = await connect("GetMemo", { name: created.name });
    expect(fetched).toMatchObject({ name: created.name });

    const updated = await connect("UpdateMemo", {
      memo: { name: created.name, pinned: true },
      updateMask: "pinned",
    });
    expect(updated).toMatchObject({ name: created.name, pinned: true });

    const related = await connect("CreateMemo", {
      memo: { content: "Connect related memo" },
    });
    await connect("SetMemoRelations", {
      name: created.name,
      relations: [{ relatedMemo: { name: related.name }, type: "REFERENCE" }],
    });
    const relationList = await connect("ListMemoRelations", {
      name: created.name,
    });
    expect(relationList.relations[0]?.relatedMemo.name).toBe(related.name);
    expect(relationList.relations[0]?.type).toBe("REFERENCE");

    const attachment = await request("/api/v1/attachments", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        attachment: {
          filename: "connect.txt",
          content: "Y29ubmVjdA==",
          type: "text/plain",
          memo: created.name,
        },
      }),
    });
    expect(attachment.status).toBe(200);
    const attachmentBody = (await attachment.json()) as { name: string };
    await connect("SetMemoAttachments", {
      name: created.name,
      attachments: [{ name: attachmentBody.name }],
    });
    const attachmentList = await connect("ListMemoAttachments", {
      name: created.name,
    });
    expect(attachmentList.attachments).toEqual([
      expect.objectContaining({ name: attachmentBody.name }),
    ]);

    const deleted = await connect("DeleteMemo", {
      name: created.name,
      force: true,
    });
    expect(deleted).toEqual({});
    const deletedLookup = await request("/memos.api.v1.MemoService/GetMemo", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: created.name }),
    });
    expect(deletedLookup.status).toBe(404);

    const unauthenticated = await request("/api/v1/sse");
    expect(unauthenticated.status).toBe(401);

    const abortController = new AbortController();
    const sse = await request("/api/v1/sse", {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: abortController.signal,
    });
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const reader = sse.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toContain(": connected");
    abortController.abort();
    await reader?.cancel();
  });
});

async function connect(method: string, body: Record<string, unknown>) {
  const response = await request(`/memos.api.v1.MemoService/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

function request(path: string, init: RequestInit = {}) {
  return app.fetch(new Request(`http://flaremo.test${path}`, init), env);
}

async function signInCurrent() {
  const setup = await request("/api/auth/flaremo/bootstrap", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://flaremo.test",
      "x-flaremo-bootstrap-secret": TEST_BOOTSTRAP_SECRET,
    },
    body: JSON.stringify({
      username: "owner",
      name: "Owner",
      email: "owner@example.com",
      password: TEST_PASSWORD,
    }),
  });
  expect(setup.status).toBe(201);

  const response = await request("/api/v1/auth/signin", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://flaremo.test",
    },
    body: JSON.stringify({
      passwordCredentials: {
        username: "owner",
        password: TEST_PASSWORD,
      },
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { accessToken: string };
  const rawSetCookies = setCookieValues(response);
  const cookies = rawSetCookies.map((value) => value.split(";", 1)[0] ?? "");
  const nativeRefreshCookie = findCookie(cookies, "memos_refresh");
  const nativeRefreshSetCookie = findCookie(rawSetCookies, "memos_refresh");
  const browserCookies = cookies.filter(
    (cookie) => !cookie.startsWith("memos_refresh="),
  );
  expect(browserCookies.length).toBeGreaterThan(0);

  const opaqueResponse = await request("/api/auth/sign-in/username", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://flaremo.test",
    },
    body: JSON.stringify({ username: "owner", password: TEST_PASSWORD }),
  });
  expect(opaqueResponse.status).toBe(200);
  const opaqueBody = (await opaqueResponse.json()) as { token: string };
  return {
    accessToken: body.accessToken,
    opaqueSessionToken: opaqueBody.token,
    sessionCookie: browserCookies.join("; "),
    refreshCookie: nativeRefreshCookie,
    refreshSetCookie: nativeRefreshSetCookie,
  };
}

function setCookieValues(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  return (headers.getSetCookie?.() ?? [response.headers.get("set-cookie")])
    .filter((value): value is string => Boolean(value))
    .filter(Boolean);
}

function setCookiePairs(response: Response) {
  return setCookieValues(response).map((value) => value.split(";", 1)[0] ?? "");
}

function findCookie(cookies: string[], name: string) {
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`test cookie ${name} missing`);
  return cookie;
}

async function createTestRuntime() {
  const runtime = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: `flaremo-transport-${crypto.randomUUID()}` },
    r2Buckets: {
      ATTACHMENTS: `flaremo-transport-attachments-${crypto.randomUUID()}`,
    },
  });
  const db = await runtime.getD1Database("DB");
  for (const filename of [
    "0000_illegal_inhumans.sql",
    "0001_familiar_morph.sql",
    "0002_wooden_professor_monster.sql",
    "0003_equal_maximus.sql",
    "0004_complex_the_enforcers.sql",
    "0005_confused_masque.sql",
    "0006_silent_kylun.sql",
  ]) {
    const sql = await readFile(
      resolve(import.meta.dirname, `../../../migrations/${filename}`),
      "utf8",
    );
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  mf = runtime;
  env = {
    DB: db,
    ATTACHMENTS: await runtime.getR2Bucket("ATTACHMENTS"),
    ASSETS: {
      fetch: async () => new Response("asset", { status: 200 }),
    } as Fetcher,
    FLAREMO_SINGLE_USER_EMAIL: "owner@example.com",
    FLAREMO_SINGLE_USER_NAME: "Owner",
    FLAREMO_PUBLIC_URL: "http://flaremo.test",
    BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
    FLAREMO_BOOTSTRAP_SECRET: TEST_BOOTSTRAP_SECRET,
  } as Env;
  return { mf, env };
}

async function signTestJwt(
  payload: Record<string, unknown>,
  secret: string,
  header = { alg: "HS256", kid: "v1", typ: "JWT" },
) {
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function encodeBase64Url(value: string | Uint8Array) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}
