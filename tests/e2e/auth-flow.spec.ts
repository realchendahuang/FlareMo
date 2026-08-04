import { expect, request, test } from "@playwright/test";
import {
  E2E_BASE_URL,
  E2E_BOOTSTRAP_INPUT,
  E2E_BOOTSTRAP_SECRET,
  E2E_INITIAL_PASSWORD,
  E2E_UPDATED_PASSWORD,
  E2E_UPDATED_USERNAME,
  E2E_USERNAME,
  restoreInitialAuthState,
  signIn,
} from "./auth-fixture";

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await restoreInitialAuthState();
});

test("bootstraps one owner and signs in with username/password", async () => {
  const anonymous = await request.newContext({ baseURL: E2E_BASE_URL });
  const session = await request.newContext({ baseURL: E2E_BASE_URL });
  try {
    const statusResponse = await anonymous.get(
      "/api/auth/flaremo/bootstrap/status",
    );
    expect(statusResponse.ok()).toBe(true);
    await expect(statusResponse.json()).resolves.toEqual({
      initialized: true,
      state: "complete",
      setup_available: false,
    });

    const secondBootstrap = await anonymous.post(
      "/api/auth/flaremo/bootstrap",
      {
        headers: {
          "x-flaremo-bootstrap-secret": E2E_BOOTSTRAP_SECRET,
          origin: E2E_BASE_URL,
        },
        data: {
          ...E2E_BOOTSTRAP_INPUT,
          username: "another_e2e_owner",
          email: "another-e2e-owner@example.test",
        },
      },
    );
    expect(secondBootstrap.status()).toBe(409);

    const privateWithoutSession = await anonymous.get(
      "/api/app/memos?page_size=1",
    );
    expect(privateWithoutSession.status()).toBe(401);

    const loginResponse = await signIn(session, {
      username: E2E_USERNAME,
      password: E2E_INITIAL_PASSWORD,
    });
    expect(loginResponse.status()).toBe(200);
    expect(loginResponse.headers()["set-cookie"]).toMatch(/HttpOnly/i);
    expect(loginResponse.headers()["set-cookie"]).toMatch(/SameSite=Lax/i);

    const privateWithSession = await session.get("/api/app/memos?page_size=1");
    expect(privateWithSession.status()).toBe(200);
    const state = await session.storageState();
    expect(
      state.cookies.some(
        (cookie) => cookie.name.startsWith("flaremo") && cookie.httpOnly,
      ),
    ).toBe(true);
  } finally {
    await anonymous.dispose();
    await session.dispose();
  }
});

test("updates username and password and accepts only the new credentials", async () => {
  const session = await request.newContext({ baseURL: E2E_BASE_URL });
  const updatedSession = await request.newContext({ baseURL: E2E_BASE_URL });
  const oldPasswordAttempt = await request.newContext({
    baseURL: E2E_BASE_URL,
  });
  const newPasswordSession = await request.newContext({
    baseURL: E2E_BASE_URL,
  });
  try {
    expect(
      (
        await signIn(session, {
          username: E2E_USERNAME,
          password: E2E_INITIAL_PASSWORD,
        })
      ).status(),
    ).toBe(200);

    const usernameUpdate = await session.post("/api/auth/update-user", {
      headers: { origin: E2E_BASE_URL },
      data: { username: E2E_UPDATED_USERNAME },
    });
    expect(usernameUpdate.status()).toBe(200);

    expect(
      (
        await signIn(updatedSession, {
          username: E2E_UPDATED_USERNAME,
          password: E2E_INITIAL_PASSWORD,
        })
      ).status(),
    ).toBe(200);

    const usernameRestore = await updatedSession.post("/api/auth/update-user", {
      headers: { origin: E2E_BASE_URL },
      data: { username: E2E_USERNAME },
    });
    expect(usernameRestore.status()).toBe(200);

    const passwordChange = await session.post("/api/auth/change-password", {
      headers: { origin: E2E_BASE_URL },
      data: {
        currentPassword: E2E_INITIAL_PASSWORD,
        newPassword: E2E_UPDATED_PASSWORD,
        revokeOtherSessions: true,
      },
    });
    expect(passwordChange.status()).toBe(200);

    const oldPassword = await signIn(oldPasswordAttempt, {
      username: E2E_USERNAME,
      password: E2E_INITIAL_PASSWORD,
    });
    expect(oldPassword.status()).toBe(401);

    const newPassword = await signIn(newPasswordSession, {
      username: E2E_USERNAME,
      password: E2E_UPDATED_PASSWORD,
    });
    expect(newPassword.status()).toBe(200);

    const passwordRestore = await newPasswordSession.post(
      "/api/auth/change-password",
      {
        headers: { origin: E2E_BASE_URL },
        data: {
          currentPassword: E2E_UPDATED_PASSWORD,
          newPassword: E2E_INITIAL_PASSWORD,
          revokeOtherSessions: true,
        },
      },
    );
    expect(passwordRestore.status()).toBe(200);
  } finally {
    await session.dispose();
    await updatedSession.dispose();
    await oldPasswordAttempt.dispose();
    await newPasswordSession.dispose();
  }
});

test("creates, uses, and revokes a Memos PAT while shares stay public", async () => {
  const session = await request.newContext({ baseURL: E2E_BASE_URL });
  const patClient = await request.newContext({ baseURL: E2E_BASE_URL });
  const anonymous = await request.newContext({ baseURL: E2E_BASE_URL });
  try {
    expect(
      (
        await signIn(session, {
          username: E2E_USERNAME,
          password: E2E_INITIAL_PASSWORD,
        })
      ).status(),
    ).toBe(200);

    const createdTokenResponse = await session.post(
      "/api/app/account/personal-access-tokens",
      {
        headers: { origin: E2E_BASE_URL },
        data: { name: "E2E Memos client", expires_in_days: 30 },
      },
    );
    expect(createdTokenResponse.status()).toBe(201);
    const createdToken = (await createdTokenResponse.json()) as {
      token: string;
      personal_access_token: { id: string; enabled: boolean };
    };
    expect(createdToken.token).toMatch(/^memos_pat_/);
    expect(createdToken.personal_access_token.enabled).toBe(true);

    const listedTokensResponse = await session.get(
      "/api/app/account/personal-access-tokens",
    );
    expect(listedTokensResponse.status()).toBe(200);
    const listedTokens = await listedTokensResponse.text();
    expect(listedTokens).toContain(createdToken.personal_access_token.id);
    expect(listedTokens).not.toContain(createdToken.token);

    const patMemoResponse = await patClient.post("/api/v1/memos", {
      headers: {
        authorization: `Bearer ${createdToken.token}`,
        "x-flaremo-wire": "legacy",
      },
      data: { content: "E2E PAT memo" },
    });
    expect(patMemoResponse.status()).toBe(201);

    const patManagementResponse = await patClient.get(
      "/api/app/account/personal-access-tokens",
      { headers: { authorization: `Bearer ${createdToken.token}` } },
    );
    expect(patManagementResponse.status()).toBe(401);

    const memoResponse = await session.post("/api/v1/memos", {
      headers: { origin: E2E_BASE_URL, "x-flaremo-wire": "legacy" },
      data: { content: "E2E public share memo" },
    });
    expect(memoResponse.status()).toBe(201);
    const memo = (await memoResponse.json()) as { name: string };
    const shareResponse = await session.post(`/api/v1/${memo.name}/shares`, {
      headers: { origin: E2E_BASE_URL, "x-flaremo-wire": "legacy" },
      data: {},
    });
    expect(shareResponse.status()).toBe(201);
    const share = (await shareResponse.json()) as { token: string };

    const anonymousShare = await anonymous.get(
      `/api/public/shares/${share.token}`,
    );
    expect(anonymousShare.status()).toBe(200);
    const anonymousPrivate = await anonymous.get("/api/v1/memos", {
      headers: { "x-flaremo-wire": "legacy" },
    });
    expect(anonymousPrivate.status()).toBe(401);

    const revokeResponse = await session.post(
      `/api/app/account/personal-access-tokens/${createdToken.personal_access_token.id}/revoke`,
      { headers: { origin: E2E_BASE_URL } },
    );
    expect(revokeResponse.status()).toBe(200);

    const revokedPatResponse = await patClient.post("/api/v1/memos", {
      headers: {
        authorization: `Bearer ${createdToken.token}`,
        "x-flaremo-wire": "legacy",
      },
      data: { content: "should be rejected" },
    });
    expect(revokedPatResponse.status()).toBe(401);

    const logoutResponse = await session.post("/api/auth/sign-out", {
      headers: { origin: E2E_BASE_URL },
      data: {},
    });
    expect(logoutResponse.status()).toBe(200);
    expect((await session.get("/api/app/memos?page_size=1")).status()).toBe(
      401,
    );
  } finally {
    await session.dispose();
    await patClient.dispose();
    await anonymous.dispose();
  }
});
