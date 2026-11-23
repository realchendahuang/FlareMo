import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../index";
import { createAppTestHarness } from "../test-support/app";
import { createTestRuntime, TEST_PASSWORD } from "../test-support/runtime";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { extractCookieHeader, bootstrapAndSignIn } = createAppTestHarness(
  () => ({
    env,
    sessionCookie,
  }),
);

describe("FlareMo capture and voice API", () => {
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

  it("stores owner-saved credentials without an encryption key, never echoes them, and lets only the owner manage settings", async () => {
    const request = (
      method: string,
      body?: unknown,
      cookie = sessionCookie,
      origin = "http://flaremo.test",
    ) =>
      app.fetch(
        new Request("http://flaremo.test/api/app/voice-settings", {
          method,
          headers: { cookie, origin, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env,
      );
    expect((await request("GET", undefined, "")).status).toBe(401);
    expect(
      (
        await request("PUT", {
          revision: null,
          enabled: true,
          credentials: { provider: "tencent" },
        })
      ).status,
    ).toBe(400);
    const input = {
      revision: null,
      enabled: true,
      credentials: { provider: "dashscope", apiKey: "test-database-secret" },
    };
    expect(
      (await request("PUT", input, sessionCookie, "https://evil.test")).status,
    ).toBe(403);
    expect((await request("PUT", input)).status).toBe(200);
    const text = await (await request("GET")).text();
    expect(text).not.toContain("test-database-secret");
    const state = JSON.parse(text) as {
      revision: string;
      source: string;
      previews: { apiKey: string };
      encrypted: boolean;
      canEncrypt: boolean;
    };
    expect(state.source).toBe("database");
    expect(state.encrypted).toBe(false);
    expect(state.canEncrypt).toBe(false);
    expect(state.previews.apiKey).toBe("****cret");
    // Without an encryption key the credentials persist as a v0 envelope.
    const stored = await env.DB.prepare(
      "SELECT ciphertext FROM voice_service_config",
    ).first<{ ciphertext: string }>();
    const { openVoiceCredentials } = await import("../asr/configuration");
    expect(
      (await openVoiceCredentials(undefined, stored?.ciphertext ?? "")).apiKey,
    ).toBe("test-database-secret");
    expect((await request("PUT", input)).status).toBe(409);
    expect(
      (
        await request("PUT", {
          ...input,
          revision: state.revision,
          credentials: { provider: "dashscope", apiKey: "" },
        })
      ).status,
    ).toBe(200);
    const status = await app.fetch(
      new Request("http://flaremo.test/api/app/capture/status", {
        headers: { cookie: sessionCookie },
      }),
      env,
    );
    expect(await status.json()).toEqual({
      available: true,
      provider: "dashscope",
      streaming: true,
      kind: "streaming",
    });
    const latest = (await (await request("GET")).json()) as {
      revision: string;
    };
    expect(
      (await request("DELETE", { revision: latest.revision })).status,
    ).toBe(200);
    const disabled = await app.fetch(
      new Request("http://flaremo.test/api/app/capture/status", {
        headers: { cookie: sessionCookie },
      }),
      env,
    );
    expect(await disabled.json()).toEqual({
      available: false,
      provider: null,
      streaming: false,
      kind: null,
    });

    // A registered non-owner can use the deployment but never manage the
    // billing-level voice credentials.
    const open = await app.fetch(
      new Request("http://flaremo.test/api/app/admin/settings", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
          origin: "http://flaremo.test",
        },
        body: JSON.stringify({ registration_open: true }),
      }),
      env,
    );
    expect(open.status).toBe(200);
    const register = await app.fetch(
      new Request("http://flaremo.test/api/auth/flaremo/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://flaremo.test",
        },
        body: JSON.stringify({
          name: "Member",
          email: "member@example.com",
          password: TEST_PASSWORD,
        }),
      }),
      env,
    );
    expect(register.status).toBe(201);
    const memberSignIn = await app.fetch(
      new Request("http://flaremo.test/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://flaremo.test",
        },
        body: JSON.stringify({
          email: "member@example.com",
          password: TEST_PASSWORD,
        }),
      }),
      env,
    );
    expect(memberSignIn.status).toBe(200);
    const memberCookie = extractCookieHeader(memberSignIn);
    expect(
      (
        await request(
          "PUT",
          {
            revision: null,
            enabled: true,
            credentials: input.credentials,
          },
          memberCookie,
        )
      ).status,
    ).toBe(403);
  });

  it("encrypts credentials with the key and lets environment credentials take precedence", async () => {
    Object.assign(env, {
      FLAREMO_VOICE_CONFIG_KEY: "test-only-voice-encryption-key-long-enough",
      FLAREMO_ASR_DASHSCOPE_API_KEY: "environment-test-key",
    });
    const request = (
      method: string,
      body?: unknown,
      origin = "http://flaremo.test",
    ) =>
      app.fetch(
        new Request("http://flaremo.test/api/app/voice-settings", {
          method,
          headers: {
            cookie: sessionCookie,
            origin,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env,
      );
    const state = (await (await request("GET")).json()) as {
      source: string;
      configured: boolean;
      provider: string | null;
    };
    expect(state).toMatchObject({
      source: "environment",
      configured: true,
      provider: "dashscope",
    });
    // The owner can still persist a database copy; it stays dormant while the
    // environment layer resolves.
    const input = {
      revision: null,
      enabled: true,
      credentials: {
        provider: "tencent",
        appId: "1234567890",
        secretId: "test-tencent-id",
        secretKey: "test-tencent-key",
      },
    };
    expect((await request("PUT", input)).status).toBe(200);
    const text = await (await request("GET")).text();
    expect(text).not.toContain("test-tencent-key");
    const after = JSON.parse(text) as {
      encrypted: boolean;
      previews: { secretKey: string; appId: string };
      unreadable: boolean;
    };
    expect(after.encrypted).toBe(true);
    expect(after.previews.secretKey).toBe("****-key");
    expect(after.previews.appId).toBe("1234567890");
    const status = await app.fetch(
      new Request("http://flaremo.test/api/app/capture/status", {
        headers: { cookie: sessionCookie },
      }),
      env,
    );
    expect(await status.json()).toEqual({
      available: true,
      provider: "dashscope",
      streaming: true,
      kind: "streaming",
    });

    // A v1 envelope becomes unreadable fail-closed when the key rotates.
    Object.assign(env, {
      FLAREMO_VOICE_CONFIG_KEY: "another-voice-encryption-key-long-enough-xyz",
    });
    const unreadableState = (await (await request("GET")).json()) as {
      unreadable: boolean;
    };
    expect(unreadableState.unreadable).toBe(true);

    // Deleting the dormant database copy does not take down the
    // environment-managed service.
    Object.assign(env, {
      FLAREMO_VOICE_CONFIG_KEY: "test-only-voice-encryption-key-long-enough",
    });
    const latest = (await (await request("GET")).json()) as {
      revision: string;
    };
    expect(
      (await request("DELETE", { revision: latest.revision })).status,
    ).toBe(200);
    const stillEnv = await app.fetch(
      new Request("http://flaremo.test/api/app/capture/status", {
        headers: { cookie: sessionCookie },
      }),
      env,
    );
    expect(await stillEnv.json()).toEqual({
      available: true,
      provider: "dashscope",
      streaming: true,
      kind: "streaming",
    });
  });

  it("protects capture capability and WebSocket with browser auth and exact Origin", async () => {
    const base = "http://flaremo.test/api/app/capture";
    const raw = (path: string, headers: Record<string, string> = {}) =>
      app.fetch(new Request(base + path, { headers }), env);
    const rateLimitKeys: string[] = [];
    Object.assign(env, {
      RATE_LIMITER: {
        limit: async (input: { key: string }) => {
          rateLimitKeys.push(input.key);
          return { success: false };
        },
      },
    });
    expect((await raw("/status")).status).toBe(401);
    expect(
      (
        await raw("/ws", {
          origin: "http://flaremo.test",
          upgrade: "websocket",
        })
      ).status,
    ).toBe(401);
    const authenticated = { cookie: sessionCookie };
    const unavailable = await raw("/status", authenticated);
    expect(await unavailable.json()).toEqual({
      available: false,
      provider: null,
      streaming: false,
      kind: null,
    });
    expect(
      (
        await raw("/ws", {
          ...authenticated,
          origin: "http://flaremo.test",
          upgrade: "websocket",
        })
      ).status,
    ).toBe(503);
    Object.assign(env, {
      FLAREMO_ASR_DASHSCOPE_API_KEY: "test-only-asr-secret",
      FLAREMO_VOICE_CONFIG_KEY: "test-only-voice-encryption-key-long-enough",
    });
    const configured = await app.fetch(
      new Request("http://flaremo.test/api/app/voice-settings", {
        method: "PUT",
        headers: {
          cookie: sessionCookie,
          origin: "http://flaremo.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: null,
          enabled: true,
          credentials: {
            provider: "dashscope",
            apiKey: "test-only-asr-secret",
          },
        }),
      }),
      env,
    );
    expect(configured.status).toBe(200);
    const available = await raw("/status", authenticated);
    expect(available.headers.get("cache-control")).toBe("no-store");
    const body = await available.text();
    expect(JSON.parse(body)).toEqual({
      available: true,
      provider: "dashscope",
      streaming: true,
      kind: "streaming",
    });
    expect(body).not.toContain("test-only-asr-secret");
    for (const origin of [
      "https://evil.test",
      "http://flaremo.test.evil.test",
      "null",
      "",
    ]) {
      expect(
        (await raw("/ws", { ...authenticated, origin, upgrade: "websocket" }))
          .status,
      ).toBe(403);
    }
    expect(
      (await raw("/ws", { ...authenticated, origin: "http://flaremo.test" }))
        .status,
    ).toBe(426);
    expect(rateLimitKeys).toEqual([]);
    expect(
      (
        await raw("/ws", {
          ...authenticated,
          origin: "http://flaremo.test",
          upgrade: "websocket",
          "cf-connecting-ip": "203.0.113.8",
        })
      ).status,
    ).toBe(429);
    expect(rateLimitKeys).toHaveLength(1);
    expect(rateLimitKeys[0]).toMatch(/^capture:[^:]+$/);
    expect(rateLimitKeys[0]).not.toContain("203.0.113.8");
    expect(
      (
        await raw("/status", {
          ...authenticated,
          authorization: "Bearer memos_pat_test",
        })
      ).status,
    ).toBe(401);
    expect(rateLimitKeys).toHaveLength(1);
  });

  it("exposes Tencent capability only when complete, with the same browser and Origin guards", async () => {
    Object.assign(env, {
      FLAREMO_ASR_PROVIDER: "tencent",
      FLAREMO_ASR_TENCENT_SECRET_ID: "test-tencent-secret-id",
      FLAREMO_ASR_TENCENT_SECRET_KEY: "test-tencent-secret-key",
    });
    const base = "http://flaremo.test/api/app/capture";
    const raw = (path: string, headers: Record<string, string> = {}) =>
      app.fetch(new Request(base + path, { headers }), env);
    const headers = { cookie: sessionCookie, origin: "http://flaremo.test" };
    expect(await (await raw("/status", headers)).json()).toEqual({
      available: false,
      provider: null,
      streaming: false,
      kind: null,
    });
    expect(
      (await raw("/ws", { ...headers, upgrade: "websocket" })).status,
    ).toBe(503);
    Object.assign(env, {
      FLAREMO_ASR_TENCENT_APP_ID: "1234567890",
      FLAREMO_VOICE_CONFIG_KEY: "test-only-voice-encryption-key-long-enough",
    });
    const configured = await app.fetch(
      new Request("http://flaremo.test/api/app/voice-settings", {
        method: "PUT",
        headers: {
          cookie: sessionCookie,
          origin: "http://flaremo.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: null,
          enabled: true,
          credentials: {
            provider: "tencent",
            appId: "1234567890",
            secretId: "test-tencent-secret-id",
            secretKey: "test-tencent-secret-key",
          },
        }),
      }),
      env,
    );
    expect(configured.status).toBe(200);
    const response = await raw("/status", headers);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      available: true,
      provider: "tencent",
      streaming: true,
      kind: "streaming",
    });
    expect((await raw("/status")).status).toBe(401);
    expect(
      (
        await raw("/status", {
          ...headers,
          authorization: "Bearer memos_pat_test",
        })
      ).status,
    ).toBe(401);
    // A real `notes` PAT reads the capability probe: an embedded client (the
    // DSH panel) runs the web app inside a frame with no session cookie, and it
    // needs to know whether a mic button belongs on screen. Writes below stay
    // browser-only.
    const patResponse = await app.fetch(
      new Request(
        "http://flaremo.test/api/app/account/personal-access-tokens",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: sessionCookie,
            origin: "http://flaremo.test",
          },
          body: JSON.stringify({ name: "embed", expires_in_days: 30 }),
        },
      ),
      env,
    );
    expect(patResponse.status).toBe(201);
    const { token: notesPat } = (await patResponse.json()) as { token: string };
    const patStatus = await raw("/status", {
      authorization: `Bearer ${notesPat}`,
    });
    expect(patStatus.status).toBe(200);
    expect(await patStatus.json()).toEqual({
      available: true,
      provider: "tencent",
      streaming: true,
      kind: "streaming",
    });
    // The paid transcription call must still refuse a PAT.
    expect(
      (
        await app.fetch(
          new Request("http://flaremo.test/api/app/capture/transcribe", {
            method: "POST",
            headers: { authorization: `Bearer ${notesPat}` },
          }),
          env,
        )
      ).status,
    ).toBe(401);
    expect(
      (await raw("/ws", { origin: headers.origin, upgrade: "websocket" }))
        .status,
    ).toBe(401);
    expect(
      (
        await raw("/ws", {
          ...headers,
          origin: "https://evil.test",
          upgrade: "websocket",
        })
      ).status,
    ).toBe(403);
    expect((await raw("/ws", headers)).status).toBe(426);
  });
});
