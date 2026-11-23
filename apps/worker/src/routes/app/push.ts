import {
  deletePushSubscription,
  listPushSubscriptions,
  type PushKeys,
  savePushSubscription,
  ValidationError,
} from "@flaremo/domain";
import type { Hono } from "hono";
import { z } from "zod";
import { getRequestContext, type HonoBindings } from "../../context";
import { jsonError } from "../../http";
import { zValidator } from "../../validated";

/** Both VAPID keys must be present for push to be enabled. */
function resolvePushKeys(env: HonoBindings["Bindings"]): PushKeys | null {
  const publicKey = env.FLAREMO_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.FLAREMO_VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey };
}

export function registerPushRoutes(app: Hono<HonoBindings>) {
  // Web Push: expose the VAPID public key and manage the caller's subscriptions.
  app.get("/push/config", async (c) => {
    try {
      const { user } = await getRequestContext(c);
      const keys = resolvePushKeys(c.env);
      return c.json({
        public_key: keys ? keys.publicKey : null,
        subscriptions: (
          await listPushSubscriptions((await getRequestContext(c)).db, user.id)
        ).length,
      });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post(
    "/push/subscribe",
    zValidator(
      "json",
      z.object({
        endpoint: z.string().url().max(1024),
        keys: z.object({
          p256dh: z.string().min(1).max(256),
          auth: z.string().min(1).max(256),
        }),
      }),
    ),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const keys = resolvePushKeys(c.env);
        if (!keys)
          return jsonError(c, new ValidationError("Push not configured"));
        const body = c.req.valid("json");
        await savePushSubscription(db, user, {
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
        });
        return c.json({ ok: true });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.post(
    "/push/unsubscribe",
    zValidator(
      "json",
      z.object({
        endpoint: z.string().url().max(1024),
      }),
    ),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        await deletePushSubscription(db, user, c.req.valid("json").endpoint);
        return c.json({ ok: true });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );
}
