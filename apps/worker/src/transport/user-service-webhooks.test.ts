import {
  createDb,
  memosNotifications,
  memosWebhookDeliveries,
} from "@flaremo/db";
import { dispatchMemosWebhookOutbox } from "@flaremo/domain";
import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemosTransportHarness,
  createMemosTransportRuntime,
  signInMemosNative,
} from "../test-support/memos-transport";

let mf: Miniflare;
let env: Env;
let accessToken: string;

const { connect, connectService, request } = createMemosTransportHarness(
  () => ({
    env,
    accessToken,
  }),
);

describe("UserService webhooks and the durable outbox", () => {
  beforeEach(async () => {
    ({ runtime: mf, env } = await createMemosTransportRuntime());
    ({ accessToken } = await signInMemosNative(env));
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("serves UserService webhook and notification lifecycle over Connect JSON", async () => {
    for (const url of [
      "http://127.0.0.1/hook",
      "http://localhost/hook",
      "http://service.local/hook",
      "ftp://example.com/hook",
      "https://user:password@example.com/hook",
      "https://example.com/hook#fragment",
    ]) {
      const invalid = await request(
        "/memos.api.v1.UserService/CreateUserWebhook",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            parent: "users/owner",
            webhook: { url },
          }),
        },
      );
      expect(invalid.status).toBe(400);
    }
    const invalidSecret = await request(
      "/memos.api.v1.UserService/CreateUserWebhook",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          parent: "users/owner",
          webhook: {
            url: "https://example.com/invalid-secret",
            signingSecret: "whsec_not-base64",
          },
        }),
      },
    );
    expect(invalidSecret.status).toBe(400);

    const webhook = await connectService("UserService", "CreateUserWebhook", {
      parent: "users/owner",
      webhook: {
        url: "https://example.com/flaremo-hook",
        displayName: "Compatibility hook",
      },
    });
    expect(webhook).toMatchObject({
      name: expect.stringMatching(/^users\/owner\/webhooks\/[0-9a-f-]+$/),
      url: "https://example.com/flaremo-hook",
      displayName: "Compatibility hook",
      signingSecretSet: true,
    });
    expect(webhook.signingSecret).toBeUndefined();

    const pat = await connectService(
      "UserService",
      "CreatePersonalAccessToken",
      { parent: "users/owner", description: "transport lifecycle test" },
    );
    expect(pat.token).toEqual(expect.any(String));
    const patExpiresAt = Date.parse(
      String(
        (pat.personalAccessToken as { expiresAt?: string } | undefined)
          ?.expiresAt ?? "invalid",
      ),
    );
    expect(patExpiresAt).toBeGreaterThan(Date.now() + 89 * 24 * 60 * 60 * 1000);
    expect(patExpiresAt).toBeLessThan(Date.now() + 91 * 24 * 60 * 60 * 1000);
    const adminAttempt = await request("/api/app/admin/settings", {
      headers: { authorization: `Bearer ${String(pat.token)}` },
    });
    expect(adminAttempt.status).toBe(403);
    const patMutation = await request(
      "/memos.api.v1.UserService/CreateUserWebhook",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${String(pat.token)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          parent: "users/owner",
          webhook: { url: "https://example.com/pat-mutation" },
        }),
      },
    );
    expect(patMutation.status).toBe(403);

    const listedWebhooks = await connectService(
      "UserService",
      "ListUserWebhooks",
      { parent: "users/owner" },
    );
    expect(listedWebhooks.webhooks).toEqual([webhook]);

    const webhookName = String(webhook.name);
    const secret = await connectService(
      "UserService",
      "GetUserWebhookSigningSecret",
      { name: webhookName },
    );
    expect(secret.signingSecret).toMatch(/^whsec_[A-Za-z0-9+/]+=*$/);

    const updatedWebhook = await connectService(
      "UserService",
      "UpdateUserWebhook",
      {
        webhook: { name: webhookName, url: "https://example.com/updated" },
        updateMask: "url",
      },
    );
    expect(updatedWebhook).toMatchObject({
      name: webhookName,
      url: "https://example.com/updated",
      signingSecretSet: true,
    });

    const memo = await connect("CreateMemo", {
      memo: { content: "notification source memo" },
    });
    const now = new Date().toISOString();
    await createDb(env.DB)
      .insert(memosNotifications)
      .values({
        receiverId: "users/owner",
        senderId: "users/owner",
        type: "memo_comment",
        status: "unread",
        sourceEventId: "notification-fixture",
        memoId: String(memo.name),
        relatedMemoId: String(memo.name),
        createdAt: now,
        updatedAt: now,
      });
    // FlareMo-only inbox kinds must stay invisible to compatible clients:
    // upstream Memos has no daily_review type to map onto.
    await createDb(env.DB)
      .insert(memosNotifications)
      .values({
        receiverId: "users/owner",
        senderId: "users/owner",
        type: "daily_review",
        status: "unread",
        sourceEventId: "daily-review-fixture",
        memoId: String(memo.name),
        relatedMemoId: null,
        createdAt: now,
        updatedAt: now,
      });

    const listedNotifications = await connectService(
      "UserService",
      "ListUserNotifications",
      { parent: "users/owner", pageSize: 10 },
    );
    expect(listedNotifications.notifications).toHaveLength(1);
    const notification = (
      listedNotifications.notifications as Array<Record<string, unknown>>
    )[0];
    expect(notification).toMatchObject({
      name: expect.stringMatching(/^users\/owner\/notifications\/\d+$/),
      sender: "users/owner",
      status: "UNREAD",
      type: "MEMO_COMMENT",
      senderUser: { name: "users/owner", username: "owner" },
      memoComment: {
        memo: memo.name,
        relatedMemo: memo.name,
        memoSnippet: "notification source memo",
      },
    });

    const archived = await connectService(
      "UserService",
      "UpdateUserNotification",
      {
        notification: { name: notification.name, status: "ARCHIVED" },
        updateMask: "status",
      },
    );
    expect(archived).toMatchObject({
      name: notification.name,
      status: "ARCHIVED",
    });

    await connectService("UserService", "DeleteUserNotification", {
      name: notification.name,
    });
    await connectService("UserService", "DeleteUserWebhook", {
      name: webhookName,
    });
    expect(
      (
        await connectService("UserService", "ListUserWebhooks", {
          parent: "users/owner",
        })
      ).webhooks,
    ).toEqual([]);
  });

  it("delivers memo webhooks from the durable outbox with Standard Webhooks headers", async () => {
    const webhook = await connectService("UserService", "CreateUserWebhook", {
      parent: "users/owner",
      webhook: {
        url: "https://example.com/outbox-hook",
        displayName: "Outbox hook",
        signingSecret: "transport-webhook-signing-secret",
      },
    });
    const memo = await connect("CreateMemo", {
      memo: { content: "outbox delivery memo" },
    });
    const requests: Request[] = [];
    const fetchMock = vi
      .fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ code: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
      .mockImplementationOnce(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(new Request(input, init));
          return new Response("retry later", { status: 503 });
        },
      );
    vi.stubGlobal("fetch", fetchMock);
    const attemptStart = new Date();
    try {
      await dispatchMemosWebhookOutbox(createDb(env.DB), attemptStart);
      const retrying = await createDb(env.DB)
        .select()
        .from(memosWebhookDeliveries)
        .all();
      expect(retrying).toMatchObject([
        { status: "pending", attempts: 1, lastError: "http_503" },
      ]);
      await dispatchMemosWebhookOutbox(
        createDb(env.DB),
        new Date(attemptStart.getTime() + 3_000),
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = requests[1];
    expect(request).toBeDefined();
    expect(request.url).toBe("https://example.com/outbox-hook");
    expect(request.headers.get("webhook-id")).toMatch(/^msg_\d+_\d+$/u);
    expect(request.headers.get("webhook-timestamp")).toMatch(/^\d+$/u);
    expect(request.headers.get("webhook-signature")).toMatch(
      /^v1,[A-Za-z0-9+/]+=*$/u,
    );
    const body = (await request.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      url: "https://example.com/outbox-hook",
      activityType: "memos.memo.created",
      creator: "users/owner",
      memo: { name: memo.name, content: "outbox delivery memo" },
    });
    expect(JSON.stringify(body)).not.toContain(
      "transport-webhook-signing-secret",
    );

    const deliveries = await createDb(env.DB)
      .select()
      .from(memosWebhookDeliveries)
      .all();
    expect(deliveries).toMatchObject([
      { status: "delivered", attempts: 2, deliveredAt: expect.any(String) },
    ]);
    expect(webhook.signingSecret).toBeUndefined();
  });

  it("rejects webhook delivery redirects that leave the public internet", async () => {
    await connectService("UserService", "CreateUserWebhook", {
      parent: "users/owner",
      webhook: {
        url: "https://example.com/redirect-hook",
        displayName: "Redirect hook",
      },
    });
    await connect("CreateMemo", {
      memo: { content: "redirect delivery memo" },
    });
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requested.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        });
      }),
    );
    try {
      await dispatchMemosWebhookOutbox(createDb(env.DB));
    } finally {
      vi.unstubAllGlobals();
    }

    expect(requested).toEqual(["https://example.com/redirect-hook"]);
    expect(
      await createDb(env.DB).select().from(memosWebhookDeliveries).all(),
    ).toMatchObject([
      {
        status: "pending",
        attempts: 1,
        lastError: "outbound_blocked_host",
      },
    ]);
  });
});
