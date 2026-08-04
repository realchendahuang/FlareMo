export type TelegramBotEnv = {
  FLAREMO_ACCESS_CLIENT_ID?: string;
  FLAREMO_ACCESS_CLIENT_SECRET?: string;
  FLAREMO_MEMOS_PAT?: string;
  FLAREMO_URL: string;
  TELEGRAM_ALLOWED_CHAT_IDS: string;
  TELEGRAM_WEBHOOK_SECRET: string;
};

type TelegramMessage = {
  caption?: string;
  chat?: { id?: number };
  forward_origin?: unknown;
  message_id?: number;
  text?: string;
};

type TelegramUpdate = {
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  edited_message?: TelegramMessage;
  message?: TelegramMessage;
  update_id?: number;
};

export default {
  fetch(request: Request, env: TelegramBotEnv): Promise<Response> {
    return handleTelegramWebhook(request, env);
  },
};

export async function handleTelegramWebhook(
  request: Request,
  env: TelegramBotEnv,
  fetcher: typeof fetch = fetch,
) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (
    request.headers.get("x-telegram-bot-api-secret-token") !==
    env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return json({ error: "Invalid Telegram webhook secret" }, 401);
  }

  const memosPat = env.FLAREMO_MEMOS_PAT?.trim();
  if (!memosPat?.startsWith("memos_pat_")) {
    return json(
      { error: "FlareMo application credential is not configured" },
      503,
    );
  }
  const accessClientId = env.FLAREMO_ACCESS_CLIENT_ID?.trim();
  const accessClientSecret = env.FLAREMO_ACCESS_CLIENT_SECRET?.trim();
  if (Boolean(accessClientId) !== Boolean(accessClientSecret)) {
    return json({ error: "Cloudflare Access credentials are incomplete" }, 503);
  }
  const flaremoUrl = getFlaremoUrl(env.FLAREMO_URL);
  if (!flaremoUrl) {
    return json({ error: "FlareMo URL must be an HTTPS origin" }, 503);
  }

  const update = (await request.json()) as TelegramUpdate;
  const message =
    update.message ??
    update.edited_message ??
    update.channel_post ??
    update.edited_channel_post;
  const chatId = message?.chat?.id;
  if (!message || typeof chatId !== "number") {
    return json({ ok: true, skipped: "unsupported_update" });
  }
  const allowedChatIds = new Set(
    env.TELEGRAM_ALLOWED_CHAT_IDS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!allowedChatIds.has(String(chatId))) {
    return json({ error: "Telegram chat is not allowed" }, 403);
  }

  const content = (message.text ?? message.caption ?? "").trim();
  if (!content) {
    return json({ ok: true, skipped: "empty_message" });
  }

  const response = await fetcher(`${flaremoUrl}/api/v1/memos`, {
    method: "POST",
    headers: flaremoHeaders({
      memosPat,
      accessClientId,
      accessClientSecret,
    }),
    body: JSON.stringify({
      content,
      visibility: "private",
      source: "telegram",
      payload: {
        tags: ["telegram"],
        client_id: `telegram:${update.update_id ?? message.message_id ?? "unknown"}`,
        telegram: {
          chat_id: String(chatId),
          message_id: message.message_id,
          forwarded: message.forward_origin !== undefined,
        },
      },
    }),
  });
  if (!response.ok) {
    return json(
      {
        error: "FlareMo rejected the memo",
        status: response.status,
      },
      502,
    );
  }
  const memo = (await response.json()) as { name?: string };
  return json({ ok: true, memo: memo.name ?? null });
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function flaremoHeaders(input: {
  memosPat: string;
  accessClientId?: string;
  accessClientSecret?: string;
}) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.memosPat}`,
    "content-type": "application/json",
  };
  if (input.accessClientId && input.accessClientSecret) {
    headers["CF-Access-Client-Id"] = input.accessClientId;
    headers["CF-Access-Client-Secret"] = input.accessClientSecret;
  }
  return headers;
}

function getFlaremoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
