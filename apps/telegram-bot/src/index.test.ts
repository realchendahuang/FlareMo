import { describe, expect, it, vi } from "vitest";
import { handleTelegramWebhook, type TelegramBotEnv } from "./index";

const env: TelegramBotEnv = {
  FLAREMO_ACCESS_CLIENT_ID: "access-id",
  FLAREMO_ACCESS_CLIENT_SECRET: "access-secret",
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
