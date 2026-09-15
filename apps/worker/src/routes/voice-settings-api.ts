import {
  canManageVoiceService,
  ForbiddenError,
  readVoiceService,
  writeVoiceService,
} from "@flaremo/domain";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  configuredVoice,
  openVoiceCredentials,
  resolveVoiceService,
  sealVoiceCredentials,
  voiceCredentialsSchema,
} from "../asr/configuration";
import { getBrowserRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";
import { rateLimitGuard } from "../rate-limit";

export const voiceSettingsApi = new Hono<HonoBindings>();
voiceSettingsApi.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  try {
    const { user } = await getBrowserRequestContext(c);
    if (!canManageVoiceService(user))
      throw new ForbiddenError("Administrator required");
    return await next();
  } catch (error) {
    return jsonError(c, error);
  }
});
voiceSettingsApi.use("*", bodyLimit({ maxSize: 8192 }));
voiceSettingsApi.get("/", async (c) => {
  const { db } = await getBrowserRequestContext(c);
  const row = await readVoiceService(db);
  let credentials = null;
  let unreadable = false;
  if (row?.ciphertext) {
    try {
      credentials = await openVoiceCredentials(
        c.env.FLAREMO_VOICE_CONFIG_KEY,
        row.ciphertext,
      );
    } catch {
      unreadable = true;
    }
  }
  return c.json(
    {
      revision: row?.revision ?? null,
      enabled: Boolean(row?.enabled && credentials),
      source: "database",
      configured: Boolean(credentials),
      provider: credentials?.provider ?? null,
      model: credentials?.model ?? "",
      unreadable,
      canStore: (c.env.FLAREMO_VOICE_CONFIG_KEY?.length ?? 0) >= 32,
    },
    200,
    { "Cache-Control": "no-store" },
  );
});
const inputSchema = z
  .object({
    revision: z.string().nullable(),
    enabled: z.boolean(),
    credentials: voiceCredentialsSchema,
  })
  .strict();
voiceSettingsApi.put("/", async (c) => {
  const parsed = inputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: { message: "Invalid configuration" } }, 400);
  const { db } = await getBrowserRequestContext(c);
  const row = await readVoiceService(db);
  const input = parsed.data;
  if ((row?.revision ?? null) !== input.revision)
    return c.json(
      { error: { message: "Configuration changed. Reload before saving." } },
      409,
    );
  if ((c.env.FLAREMO_VOICE_CONFIG_KEY?.length ?? 0) < 32)
    return c.json(
      {
        error: {
          message:
            "Configure FLAREMO_VOICE_CONFIG_KEY in Worker secrets first.",
        },
      },
      503,
    );
  const value = input.credentials;
  if (row?.ciphertext) {
    try {
      const old = await openVoiceCredentials(
        c.env.FLAREMO_VOICE_CONFIG_KEY,
        row.ciphertext,
      );
      if (old.provider === value.provider) {
        value.apiKey ||= old.apiKey;
        value.appId ||= old.appId;
        value.secretId ||= old.secretId;
        value.secretKey ||= old.secretKey;
      }
    } catch {
      return c.json(
        {
          error: {
            message:
              "Stored credentials unavailable. Delete them before replacing.",
          },
        },
        409,
      );
    }
  }
  if (!configuredVoice(value))
    return c.json(
      { error: { message: "Provider credentials or model incomplete" } },
      400,
    );
  // Do not retain credentials for the inactive provider.
  if (value.provider === "tencent") value.apiKey = "";
  else {
    value.appId = "";
    value.secretId = "";
    value.secretKey = "";
  }
  const ciphertext = await sealVoiceCredentials(
    c.env.FLAREMO_VOICE_CONFIG_KEY,
    value,
  );
  if (
    !(await writeVoiceService(db, input.revision, {
      enabled: input.enabled,
      ciphertext,
    }))
  )
    return c.json({ error: { message: "Configuration changed" } }, 409);
  return c.json({ ok: true }, 200, { "Cache-Control": "no-store" });
});
voiceSettingsApi.delete("/", async (c) => {
  const input = z
    .object({ revision: z.string().nullable() })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!input.success)
    return c.json({ error: { message: "Invalid request" } }, 400);
  const { db } = await getBrowserRequestContext(c);
  if (
    !(await writeVoiceService(db, input.data.revision, {
      enabled: false,
      ciphertext: null,
    }))
  )
    return c.json({ error: { message: "Configuration changed" } }, 409);
  return c.json({ ok: true }); // A disabled tombstone prevents any implicit reactivation after deletion.
});

// Tests the saved configuration only; it never returns upstream error text.
voiceSettingsApi.post("/test", async (c) => {
  const { user } = await getBrowserRequestContext(c);
  const limited = await rateLimitGuard(c, "capture", user.id);
  if (limited) return limited;
  const configured = await resolveVoiceService(c.env);
  if (!configured)
    return c.json({ error: { message: "Voice service unavailable" } }, 503);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const connection = await configured.provider.connect(
      { sampleRate: 16000 },
      () => {},
      () => abort.abort(),
      abort.signal,
    );
    connection.close();
    if (abort.signal.aborted) throw new Error("Connection interrupted");
    return c.json({ ok: true }, 200, { "Cache-Control": "no-store" });
  } catch {
    return c.json(
      {
        error: {
          message:
            "Connection test failed. Check credentials, quota and region.",
        },
      },
      502,
    );
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
});
