import {
  getUserRegistrationAllowed,
  setUserRegistrationAllowed,
} from "@flaremo/domain";
import type { Hono } from "hono";
import type { HonoBindings } from "../../context";
import { jsonError } from "../../http";
import { zValidator } from "../../validated";
import { ownerContext, updateSettingsSchema } from "./context";

export function registerSettingsRoutes(app: Hono<HonoBindings>) {
  // Kept as a compatibility endpoint for existing deployments and clients. The
  // team-management UI does not expose this switch; adding members is the normal
  // team-mode path and registration remains closed by default.
  app.get("/settings", async (c) => {
    try {
      const { db } = await ownerContext(c);
      return c.json({
        registration_open: await getUserRegistrationAllowed(db),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.patch(
    "/settings",
    zValidator("json", updateSettingsSchema),
    async (c) => {
      try {
        const { db } = await ownerContext(c);
        await setUserRegistrationAllowed(
          db,
          c.req.valid("json").registration_open,
        );
        return c.json({
          registration_open: await getUserRegistrationAllowed(db),
        });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );
}
