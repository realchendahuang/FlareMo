import {
  ForbiddenError,
  isInstanceOwner,
  reportPlanUsage,
  reportVectorUsage,
} from "@flaremo/domain";
import type { Hono } from "hono";
import {
  fetchCloudflareUsage,
  resolveAnalyticsConfig,
} from "../../cf-analytics";
import { getRequestContext, type HonoBindings } from "../../context";
import { resolveEmbeddingConfig } from "../../embedding";
import { jsonError } from "../../http";

export function registerUsageRoutes(app: Hono<HonoBindings>) {
  app.get("/usage/vector", async (c) => {
    try {
      const { db, user, limits, userLimits } = await getRequestContext(c);
      const config = resolveEmbeddingConfig(c.env);
      const storedLimit = Number.parseInt(
        c.env.FLAREMO_VECTORIZE_STORED_LIMIT?.trim() || "5000000",
        10,
      );
      const queriedLimit = Number.parseInt(
        c.env.FLAREMO_VECTORIZE_QUERIED_LIMIT?.trim() || "30000000",
        10,
      );
      const report = await reportVectorUsage(db, user, {
        provider: config.provider,
        model: config.model,
        dimensions: config.dimensions,
        storedLimit: Number.isFinite(storedLimit) ? storedLimit : 5_000_000,
        queriedLimit: Number.isFinite(queriedLimit) ? queriedLimit : 30_000_000,
      });
      const plan = await reportPlanUsage(db, limits, {
        userId: user.id,
        userLimits,
      });
      return c.json({ ...report, plan });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/usage/cloudflare", async (c) => {
    try {
      const { user } = await getRequestContext(c);
      if (!isInstanceOwner(user))
        throw new ForbiddenError("Owner access is required.");
      const config = resolveAnalyticsConfig(c.env);
      if (!config) return c.json({ available: false });
      const report = await fetchCloudflareUsage(c.env);
      return c.json({ available: true, ...report });
    } catch (error) {
      return jsonError(c, error);
    }
  });
}
