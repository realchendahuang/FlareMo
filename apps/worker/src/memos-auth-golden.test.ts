import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDb } from "@flaremo/db";
import { completeOwnerBootstrap } from "@flaremo/domain";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlareMoAuth } from "./auth";
import type { FlareMoEnv } from "./env";
import {
  issueMemosNativeTokens,
  rotateMemosRefreshToken,
} from "./memos-native-auth";

const TEST_ONLY_EMAIL = "golden-owner@example.test";
const TEST_ONLY_NAME = "Golden Owner";
const TEST_ONLY_USERNAME = "owner";
const FIXTURE_ISSUED_AT = 1_735_689_600;
const FIXTURE_ACCESS_EXPIRES_AT = 1_735_690_500;
const FIXTURE_REFRESH_EXPIRES_AT = 1_738_281_600;
const FIXTURE_FIRST_TOKEN_ID = "00000000-0000-4000-8000-000000000001";
const FIXTURE_SECOND_TOKEN_ID = "00000000-0000-4000-8000-000000000002";

type JwtGoldenFixture = {
  input: {
    issuedAt: number;
    expiresAt: number;
    subject: string;
    tokenId?: string;
  };
  serialization: {
    encodedSegmentSha256: {
      header: string;
      payload: string;
      signature: string;
    };
    tokenSha256: string;
    cookieAttributes?: string;
  };
  rotation?: {
    tokenId: string;
    tokenSha256: string;
    encodedSegmentSha256: {
      header: string;
      payload: string;
      signature: string;
    };
  };
};

let runtime: Miniflare;
let env: Env;
let database: D1Database;

describe("native Memos auth deterministic golden fixture", () => {
  beforeEach(async () => {
    ({ runtime, env, database } = await createTestRuntime());
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await runtime.dispose();
  });

  it("keeps Better Auth-linked access and rotating refresh JWT bytes deterministic", async () => {
    const accessFixture = await readJwtGoldenFixture(
      "v0.29.1-daa71d0.access.json",
    );
    const refreshFixture = await readJwtGoldenFixture(
      "v0.29.1-daa71d0.refresh.json",
    );
    expect(accessFixture.input.issuedAt).toBe(FIXTURE_ISSUED_AT);
    expect(accessFixture.input.expiresAt).toBe(FIXTURE_ACCESS_EXPIRES_AT);
    expect(refreshFixture.input.issuedAt).toBe(FIXTURE_ISSUED_AT);
    expect(refreshFixture.input.expiresAt).toBe(FIXTURE_REFRESH_EXPIRES_AT);
    expect(refreshFixture.input.tokenId).toBe(FIXTURE_FIRST_TOKEN_ID);
    expect(refreshFixture.rotation?.tokenId).toBe(FIXTURE_SECOND_TOKEN_ID);
    const authUser = await createBetterAuthLinkedOwner();
    const request = new Request("http://flaremo.test/api/v1/auth/signin", {
      headers: {
        "cf-connecting-ip": "127.0.0.1",
        "user-agent": "memos-auth-golden-test",
      },
    });

    vi.useFakeTimers({ now: FIXTURE_ISSUED_AT * 1_000, toFake: ["Date"] });
    vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(FIXTURE_FIRST_TOKEN_ID)
      .mockReturnValueOnce(FIXTURE_SECOND_TOKEN_ID);

    const issued = await issueMemosNativeTokens({
      db: createDb(database),
      env: env as FlareMoEnv,
      authUserId: authUser.id,
      user: authUser.user,
      request,
    });

    const expectedAccessToken = await signReferenceJwt(
      {
        alg: "HS256",
        kid: "v1",
        typ: "JWT",
      },
      {
        type: "access",
        role: "ADMIN",
        status: "NORMAL",
        username: "owner",
        iss: "memos",
        sub: "1",
        aud: ["user.access-token"],
        exp: FIXTURE_ACCESS_EXPIRES_AT,
        iat: FIXTURE_ISSUED_AT,
      },
      env.BETTER_AUTH_SECRET,
    );
    const expectedFirstRefreshToken = await signReferenceJwt(
      {
        alg: "HS256",
        kid: "v1",
        typ: "JWT",
      },
      {
        type: "refresh",
        tid: FIXTURE_FIRST_TOKEN_ID,
        iss: "memos",
        sub: "1",
        aud: ["user.refresh-token"],
        exp: FIXTURE_REFRESH_EXPIRES_AT,
        iat: FIXTURE_ISSUED_AT,
      },
      env.BETTER_AUTH_SECRET,
    );

    expect(issued).toMatchObject({
      accessToken: expectedAccessToken,
      accessTokenExpiresAt: new Date(FIXTURE_ACCESS_EXPIRES_AT * 1_000),
      refreshTokenExpiresAt: new Date(FIXTURE_REFRESH_EXPIRES_AT * 1_000),
      subject: 1,
    });
    const accessSegments = issued.accessToken.split(".");
    expect(accessSegments).toHaveLength(3);
    expect(await sha256Hex(issued.accessToken)).toBe(
      accessFixture.serialization.tokenSha256,
    );
    expect(await sha256Hex(accessSegments[0] ?? "")).toBe(
      accessFixture.serialization.encodedSegmentSha256.header,
    );
    expect(await sha256Hex(accessSegments[1] ?? "")).toBe(
      accessFixture.serialization.encodedSegmentSha256.payload,
    );
    expect(await sha256Hex(accessSegments[2] ?? "")).toBe(
      accessFixture.serialization.encodedSegmentSha256.signature,
    );
    const refreshSegments = expectedFirstRefreshToken.split(".");
    expect(refreshSegments).toHaveLength(3);
    expect(await sha256Hex(expectedFirstRefreshToken)).toBe(
      refreshFixture.serialization.tokenSha256,
    );
    expect(await sha256Hex(refreshSegments[0] ?? "")).toBe(
      refreshFixture.serialization.encodedSegmentSha256.header,
    );
    expect(await sha256Hex(refreshSegments[1] ?? "")).toBe(
      refreshFixture.serialization.encodedSegmentSha256.payload,
    );
    expect(await sha256Hex(refreshSegments[2] ?? "")).toBe(
      refreshFixture.serialization.encodedSegmentSha256.signature,
    );
    expect(issued.refreshCookie).toBe(
      `memos_refresh=${expectedFirstRefreshToken}; ${refreshFixture.serialization.cookieAttributes}`,
    );

    const rotated = await rotateMemosRefreshToken({
      db: createDb(database),
      env: env as FlareMoEnv,
      expectedAuthUserId: authUser.id,
      request: new Request("http://flaremo.test/api/v1/auth/refresh", {
        headers: {
          cookie: issued.refreshCookie,
          "user-agent": "memos-auth-golden-test",
        },
      }),
    });

    const expectedSecondRefreshToken = await signReferenceJwt(
      {
        alg: "HS256",
        kid: "v1",
        typ: "JWT",
      },
      {
        type: "refresh",
        tid: FIXTURE_SECOND_TOKEN_ID,
        iss: "memos",
        sub: "1",
        aud: ["user.refresh-token"],
        exp: FIXTURE_REFRESH_EXPIRES_AT,
        iat: FIXTURE_ISSUED_AT,
      },
      env.BETTER_AUTH_SECRET,
    );

    expect(rotated).toMatchObject({
      accessToken: expectedAccessToken,
      accessTokenExpiresAt: new Date(FIXTURE_ACCESS_EXPIRES_AT * 1_000),
      authUserId: authUser.id,
      flaremoUserId: "users/owner",
      subject: 1,
    });
    expect(await sha256Hex(expectedSecondRefreshToken)).toBe(
      refreshFixture.rotation?.tokenSha256,
    );
    const rotatedSegments = expectedSecondRefreshToken.split(".");
    expect(rotatedSegments).toHaveLength(3);
    expect(await sha256Hex(rotatedSegments[0] ?? "")).toBe(
      refreshFixture.rotation?.encodedSegmentSha256.header,
    );
    expect(await sha256Hex(rotatedSegments[1] ?? "")).toBe(
      refreshFixture.rotation?.encodedSegmentSha256.payload,
    );
    expect(await sha256Hex(rotatedSegments[2] ?? "")).toBe(
      refreshFixture.rotation?.encodedSegmentSha256.signature,
    );
    expect(rotated.refreshCookie).toBe(
      `memos_refresh=${expectedSecondRefreshToken}; ${refreshFixture.serialization.cookieAttributes}`,
    );
  });
});

async function readJwtGoldenFixture(filename: string) {
  const fixture = JSON.parse(
    await readFile(
      resolve(
        import.meta.dirname,
        `../../../tests/fixtures/memos-auth/${filename}`,
      ),
      "utf8",
    ),
  ) as JwtGoldenFixture;
  return fixture;
}

async function createBetterAuthLinkedOwner() {
  const auth = createFlareMoAuth(env as FlareMoEnv, createDb(database), {
    allowBootstrapSignUp: true,
  });
  const result = await auth.api.signUpEmail({
    body: {
      email: TEST_ONLY_EMAIL,
      name: TEST_ONLY_NAME,
      password: `test-${crypto.randomUUID()}`,
      username: TEST_ONLY_USERNAME,
      displayUsername: TEST_ONLY_USERNAME,
    },
  });
  const user = await completeOwnerBootstrap(createDb(database), {
    authUserId: result.user.id,
    singleUser: { email: TEST_ONLY_EMAIL, name: TEST_ONLY_NAME },
  });
  return { id: result.user.id, user };
}

async function createTestRuntime() {
  const instance = new Miniflare({
    script: "export default { fetch() { return new Response('ok') } }",
    modules: true,
    compatibilityDate: "2026-07-10",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: `flaremo-auth-golden-${crypto.randomUUID()}` },
    r2Buckets: {
      ATTACHMENTS: `flaremo-auth-golden-attachments-${crypto.randomUUID()}`,
    },
  });
  const db = await instance.getD1Database("DB");
  for (const filename of [
    "0000_illegal_inhumans.sql",
    "0001_familiar_morph.sql",
    "0002_wooden_professor_monster.sql",
    "0003_equal_maximus.sql",
    "0004_complex_the_enforcers.sql",
    "0005_confused_masque.sql",
    "0006_silent_kylun.sql",
    "0007_flat_phil_sheldon.sql",
    "0008_legal_scarecrow.sql",
    "0009_neat_iron_fist.sql",
    "0010_deep_gateway.sql",
  ]) {
    const migration = await readFile(
      resolve(import.meta.dirname, `../../../migrations/${filename}`),
      "utf8",
    );
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((item) => item.trim())
      .filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }

  return {
    runtime: instance,
    database: db,
    env: {
      DB: db,
      ATTACHMENTS: await instance.getR2Bucket("ATTACHMENTS"),
      ASSETS: {
        fetch: async () => new Response("asset"),
      } as Fetcher,
      FLAREMO_SINGLE_USER_EMAIL: TEST_ONLY_EMAIL,
      FLAREMO_SINGLE_USER_NAME: TEST_ONLY_NAME,
      FLAREMO_PUBLIC_URL: "http://flaremo.test",
      BETTER_AUTH_SECRET: "cross-language-fixture-secret-2026",
    } as Env,
  };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function signReferenceJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret: string,
) {
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
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
