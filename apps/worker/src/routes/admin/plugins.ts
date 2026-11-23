import {
  getPluginSettings,
  PLUGIN_LIST_LIMIT,
  setPluginSettings,
} from "@flaremo/domain";
import type { Hono } from "hono";
import { z } from "zod";
import type { HonoBindings } from "../../context";
import { jsonError } from "../../http";
import { invalidatePluginSettingsCache } from "../../settings-cache";
import { zValidator } from "../../validated";
import { ownerContext } from "./context";

const pluginIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const pluginIdListSchema = z.array(pluginIdSchema).max(PLUGIN_LIST_LIMIT);
const optionKeySchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);
const cardOptionsSchema = z.record(
  pluginIdSchema,
  z.record(optionKeySchema, z.union([z.string(), z.number(), z.boolean()])),
);
const updatePluginsSchema = z.object({
  enabledPlugins: pluginIdListSchema.optional(),
  disabledPlugins: pluginIdListSchema.optional(),
  cards: z
    .object({
      order: pluginIdListSchema.optional(),
      hidden: pluginIdListSchema.optional(),
      default: pluginIdSchema.nullable().optional(),
      options: cardOptionsSchema.optional(),
    })
    .optional(),
});

export function registerPluginsRoutes(app: Hono<HonoBindings>) {
  app.get("/plugins", async (c) => {
    try {
      const { db } = await ownerContext(c);
      return c.json(await getPluginSettings(db));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.put("/plugins", zValidator("json", updatePluginsSchema), async (c) => {
    try {
      const { db } = await ownerContext(c);
      const settings = await setPluginSettings(db, c.req.valid("json"));
      invalidatePluginSettingsCache(db);
      return c.json(settings);
    } catch (error) {
      return jsonError(c, error);
    }
  });
}
