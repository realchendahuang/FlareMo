import {
  type ConnectedAppsResponseDto,
  DEVICE_CODE_GRANT_TYPE,
  type DeviceAuthorizationResponseDto,
  type DeviceTokenResponseDto,
  REFRESH_TOKEN_GRANT_TYPE,
} from "@flaremo/contracts";
import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../index";
import { createAppTestHarness } from "../test-support/app";
import { createTestRuntime, TEST_PASSWORD } from "../test-support/runtime";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { bootstrapAndSignIn } = createAppTestHarness(() => ({
  env,
  sessionCookie,
}));

const ORIGIN = "http://flaremo.test";

function jsonRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://flaremo.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

async function startDevice(clientName = "DSH Test Client") {
  const response = await app.fetch(
    jsonRequest("/connect/device", {
      client_name: clientName,
      client_type: "device",
    }),
    env,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as DeviceAuthorizationResponseDto;
}

async function approve(userCode: string) {
  const response = await app.fetch(
    jsonRequest(
      "/api/app/connect/approve",
      { user_code: userCode },
      { cookie: sessionCookie },
    ),
    env,
  );
  expect(response.status).toBe(200);
  return response;
}

async function redeem(deviceCode: string) {
  const response = await app.fetch(
    jsonRequest("/connect/token", {
      grant_type: DEVICE_CODE_GRANT_TYPE,
      device_code: deviceCode,
    }),
    env,
  );
  return { status: response.status, body: await response.json() };
}

describe("device authorization", () => {
  beforeEach(async () => {
    ({ runtime: mf, env } = await createTestRuntime({
      databaseName: "flaremo-device-test",
      attachmentsName: "flaremo-device-attachments-test",
      env: { FLAREMO_DEPLOY_REPOSITORY: "example/flaremo" },
    }));
    sessionCookie = await bootstrapAndSignIn();
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("completes the pairing flow and issues a working access token", async () => {
    const device = await startDevice();
    expect(device.user_code).toMatch(/^[A-Z2-9]{8}$/);
    expect(device.verification_uri).toContain("/connect");

    const pending = await redeem(device.device_code);
    expect(pending.status).toBe(400);
    expect(pending.body.error).toBe("authorization_pending");

    await approve(device.user_code);

    const redeemed = await redeem(device.device_code);
    expect(redeemed.status).toBe(200);
    const token = redeemed.body as DeviceTokenResponseDto;
    expect(token.token_type).toBe("Bearer");
    expect(token.access_token).toMatch(/^memos_pat_/);
    expect(token.refresh_token).toBeTruthy();
    expect(token.scope).toBe("notes");

    // The access token works on the notes API.
    const memos = await app.fetch(
      new Request("http://flaremo.test/api/app/memos?page_size=1", {
        headers: { authorization: `Bearer ${token.access_token}` },
      }),
      env,
    );
    expect(memos.status).toBe(200);

    // The device code is single-use.
    const again = await redeem(device.device_code);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("invalid_grant");
  });

  it("expires an unapproved device code", async () => {
    const device = await startDevice();
    await env.DB.prepare(
      "UPDATE device_authorizations SET expires_at = ? WHERE status = 'pending'",
    )
      .bind("2000-01-01T00:00:00.000Z")
      .run();
    const result = await redeem(device.device_code);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("expired_token");
  });

  it("rotates the refresh token and invalidates the previous access token", async () => {
    const device = await startDevice();
    await approve(device.user_code);
    const first = (await redeem(device.device_code))
      .body as DeviceTokenResponseDto;

    const refreshed = await app.fetch(
      jsonRequest("/connect/token", {
        grant_type: REFRESH_TOKEN_GRANT_TYPE,
        refresh_token: first.refresh_token,
      }),
      env,
    );
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as DeviceTokenResponseDto;
    expect(second.access_token).not.toBe(first.access_token);

    const oldAccess = await app.fetch(
      new Request("http://flaremo.test/api/app/memos?page_size=1", {
        headers: { authorization: `Bearer ${first.access_token}` },
      }),
      env,
    );
    expect(oldAccess.status).toBe(401);

    const newAccess = await app.fetch(
      new Request("http://flaremo.test/api/app/memos?page_size=1", {
        headers: { authorization: `Bearer ${second.access_token}` },
      }),
      env,
    );
    expect(newAccess.status).toBe(200);

    // The old refresh token was rotated away.
    const reuse = await app.fetch(
      jsonRequest("/connect/token", {
        grant_type: REFRESH_TOKEN_GRANT_TYPE,
        refresh_token: first.refresh_token,
      }),
      env,
    );
    expect(reuse.status).toBe(400);
  });

  it("lists the connected app and revokes it", async () => {
    const device = await startDevice("Revoke Me");
    await approve(device.user_code);
    const token = (await redeem(device.device_code))
      .body as DeviceTokenResponseDto;

    const listed = await app.fetch(
      new Request("http://flaremo.test/api/app/connect/apps", {
        headers: { cookie: sessionCookie },
      }),
      env,
    );
    expect(listed.status).toBe(200);
    const apps = (await listed.json()) as ConnectedAppsResponseDto;
    const entry = apps.apps.find((item) => item.name === "Revoke Me");
    expect(entry).toBeTruthy();
    expect(entry?.clientType).toBe("device");
    expect(entry?.status).toBe("active");

    const revoked = await app.fetch(
      new Request(`http://flaremo.test/api/app/connect/apps/${entry?.id}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie, origin: ORIGIN },
      }),
      env,
    );
    expect(revoked.status).toBe(204);

    const denied = await app.fetch(
      new Request("http://flaremo.test/api/app/memos?page_size=1", {
        headers: { authorization: `Bearer ${token.access_token}` },
      }),
      env,
    );
    expect(denied.status).toBe(401);
  });

  it("rejects approval without a browser session", async () => {
    const device = await startDevice();
    const response = await app.fetch(
      jsonRequest("/api/app/connect/approve", { user_code: device.user_code }),
      env,
    );
    expect(response.status).toBe(401);
  });
});
