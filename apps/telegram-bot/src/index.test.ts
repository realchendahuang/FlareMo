import { describe, expect, it, vi } from "vitest";
import { handleTelegramWebhook, type TelegramBotEnv } from "./index";

const env: TelegramBotEnv = {
  FLAREMO_ACCESS_CLIENT_ID: "access-id",
  FLAREMO_ACCESS_CLIENT_SECRET: "access-secret",
  FLAREMO_MEMOS_PAT: "memos_pat_test-only-telegram-credential",
  FLAREMO_URL: "https://flaremo.example.workers.dev/",
  TELEGRAM_ALLOWED_CHAT_IDS: "42, 84",
  TELEGRAM_WEBHOOK_SECRET: "telegram-secret",
};

describe("Telegram ingestion example", () => {
  it("turns an allowed Telegram message into a structured FlareMo memo", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ name: "memos/created" }, { status: 201 }),
    );
    const response = await handleTelegramWebhook(
      telegramRequest({
        update_id: 1001,
        message: {
          message_id: 7,
          chat: { id: 42 },
          text: "A useful link https://example.com/article",
          forward_origin: { type: "channel" },
        },
      }),
      env,
      fetcher,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, memo: "memos/created" });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://flaremo.example.workers.dev/api/v1/memos");
    const headers = new Headers(init?.headers);
    expect(headers.get("CF-Access-Client-Id")).toBe("access-id");
    expect(headers.get("CF-Access-Client-Secret")).toBe("access-secret");
    expect(headers.get("Authorization")).toBe(
      "Bearer memos_pat_test-only-telegram-credential",
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      content: "A useful link https://example.com/article",
      source: "telegram",
      payload: {
        tags: ["telegram"],
        client_id: "telegram:1001",
        telegram: { chat_id: "42", message_id: 7, forwarded: true },
      },
    });
  });

  it("rejects invalid secrets and chats before calling FlareMo", async () => {
    const fetcher = vi.fn();
    const invalidSecret = await handleTelegramWebhook(
      telegramRequest({ update_id: 1 }, "wrong"),
      env,
      fetcher,
    );
    expect(invalidSecret.status).toBe(401);

    const deniedChat = await handleTelegramWebhook(
      telegramRequest({
        update_id: 2,
        message: { chat: { id: 99 }, message_id: 1, text: "denied" },
      }),
      env,
      fetcher,
    );
    expect(deniedChat.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("supports native FlareMo auth without Cloudflare Access headers", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ name: "memos/native" }, { status: 201 }),
    );
    const nativeEnv: TelegramBotEnv = {
      ...env,
      FLAREMO_ACCESS_CLIENT_ID: undefined,
      FLAREMO_ACCESS_CLIENT_SECRET: undefined,
    };
    const response = await handleTelegramWebhook(
      telegramRequest({
        update_id: 1002,
        message: { chat: { id: 42 }, message_id: 8, text: "native auth" },
      }),
      nativeEnv,
      fetcher,
    );

    expect(response.status).toBe(200);
    const [, init] = fetcher.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe(
      "Bearer memos_pat_test-only-telegram-credential",
    );
    expect(headers.get("CF-Access-Client-Id")).toBeNull();
    expect(headers.get("CF-Access-Client-Secret")).toBeNull();
  });

  it("fails closed when the application PAT or Access pair is misconfigured", async () => {
    const fetcher = vi.fn();
    const missingPat = await handleTelegramWebhook(
      telegramRequest({
        update_id: 1003,
        message: { chat: { id: 42 }, message_id: 9, text: "missing pat" },
      }),
      { ...env, FLAREMO_MEMOS_PAT: undefined },
      fetcher,
    );
    expect(missingPat.status).toBe(503);

    const partialAccess = await handleTelegramWebhook(
      telegramRequest({
        update_id: 1004,
        message: { chat: { id: 42 }, message_id: 10, text: "partial access" },
      }),
      { ...env, FLAREMO_ACCESS_CLIENT_SECRET: undefined },
      fetcher,
    );
    expect(partialAccess.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();

    const insecureUrl = await handleTelegramWebhook(
      telegramRequest({
        update_id: 1005,
        message: { chat: { id: 42 }, message_id: 11, text: "insecure url" },
      }),
      { ...env, FLAREMO_URL: "http://flaremo.example.workers.dev" },
      fetcher,
    );
    expect(insecureUrl.status).toBe(503);
  });
});

function telegramRequest(body: unknown, secret = "telegram-secret") {
  return new Request("https://bot.example.workers.dev/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: JSON.stringify(body),
  });
}
