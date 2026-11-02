import {
  calendarViewQuerySchema,
  hourlyActivityQuerySchema,
  semanticMemoSearchQuerySchema,
} from "@flaremo/contracts";
import {
  assertMonthlyQuota,
  canEditMemo,
  canGovernMemo,
  estimateTokenCount,
  getCalendarView,
  getFlaremoUserNames,
  getHourlyActivity,
  getSemanticSearchMemos,
  incrementUsageCounter,
  semanticSearchMemos,
} from "@flaremo/domain";
import { memoToDto } from "@flaremo/memos";
import type { Hono } from "hono";
import { getRequestContext, type HonoBindings } from "../../context";
import {
  createEmbeddingProvider,
  createVectorIndex,
  memoSearchNamespaces,
} from "../../embedding";
import { jsonError } from "../../http";
import { zValidator } from "../../validated";

export function registerTimelineRoutes(app: Hono<HonoBindings>) {
  app.get(
    "/stats/hourly",
    zValidator("query", hourlyActivityQuerySchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        return c.json(await getHourlyActivity(db, user, c.req.valid("query")));
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.get(
    "/calendar",
    zValidator("query", calendarViewQuerySchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        return c.json(await getCalendarView(db, user, c.req.valid("query")));
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.get(
    "/search/semantic",
    zValidator("query", semanticMemoSearchQuerySchema),
    async (c) => {
      try {
        const { db, user, limits, userLimits } = await getRequestContext(c);
        const provider = createEmbeddingProvider(c.env);
        const index = createVectorIndex(c.env, "memo");
        if (!provider || !index) {
          return c.json({ memos: [], degraded: true });
        }
        const query = c.req.valid("query");
        await assertMonthlyQuota(
          db,
          limits.semanticSearchQueriesPerMonth,
          "search_queries",
          "Monthly semantic search quota exceeded",
          { userLimits, userId: user.id },
        );
        const hits = await semanticSearchMemos(
          db,
          user,
          {
            provider,
            index,
            namespaces: memoSearchNamespaces(c.env, user, query.space),
          },
          query.q,
          query.limit,
        );
        c.executionCtx.waitUntil(
          Promise.all([
            incrementUsageCounter(
              db,
              user,
              "queried_dims",
              provider.dimensions,
            ).catch(() => undefined),
            incrementUsageCounter(db, user, "search_queries", 1).catch(
              () => undefined,
            ),
            incrementUsageCounter(
              db,
              user,
              "embedding_tokens",
              estimateTokenCount([query.q]),
            ).catch(() => undefined),
          ]),
        );
        const ordered = await getSemanticSearchMemos(
          db,
          user,
          hits.map((hit) => hit.id),
        );
        const creatorNames = await getFlaremoUserNames(
          db,
          ordered.map((memo) => memo.userId),
        );
        return c.json({
          memos: ordered.map((memo) => ({
            ...memoToDto(memo, user, creatorNames.get(memo.userId)),
            // Same server-derived rule as list responses (canEditMemo), so
            // semantic results keep their manage affordances.
            can_manage: canEditMemo(user, memo),
            can_govern: canGovernMemo(user, memo),
          })),
          degraded: false,
        });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );
}
