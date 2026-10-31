import {
  dailyReviewQuerySchema,
  randomMemoQuerySchema,
  relatedMemosQuerySchema,
  reviewMarkSchema,
  reviewSettingsUpdateSchema,
  walkNextQuerySchema,
} from "@flaremo/contracts";
import {
  buildTodayReview,
  getRandomMemo,
  getReviewSettings,
  getWalkNextMemo,
  listDailyReviewMemos,
  listRelatedMemos,
  markReviewMemo,
  type ReviewSettings,
  updateReviewSettings,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { getRequestContext, type HonoBindings } from "../../context";
import { jsonError } from "../../http";
import { parseExcludeParam, serializeMemosWithAttachments } from "./helpers";

function serializeSettings(settings: ReviewSettings) {
  return {
    excluded_tags: settings.excludedTags,
    muted_count: settings.mutedCount,
  };
}

export function registerReviewRoutes(app: Hono<HonoBindings>) {
  app.get(
    "/review/today",
    zValidator("query", dailyReviewQuerySchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const query = c.req.valid("query");
        const entries = await buildTodayReview(db, user, query);
        const serialized = await serializeMemosWithAttachments(
          db,
          user,
          entries.map((entry) => entry.memo),
        );
        const byName = new Map(serialized.map((memo) => [memo.name, memo]));
        return c.json({
          date: query.date,
          items: entries.flatMap((entry) => {
            const memo = byName.get(entry.memo.id);
            return memo
              ? [{ memo, reason: entry.reason, reviewed: entry.reviewed }]
              : [];
          }),
        });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.post("/review/marks", zValidator("json", reviewMarkSchema), async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      await markReviewMemo(db, user, c.req.valid("json"));
      return c.json({ ok: true });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/review/settings", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      return c.json(serializeSettings(await getReviewSettings(db, user)));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.patch(
    "/review/settings",
    zValidator("json", reviewSettingsUpdateSchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        return c.json(
          serializeSettings(
            await updateReviewSettings(db, user, c.req.valid("json")),
          ),
        );
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.get(
    "/review/daily",
    zValidator("query", dailyReviewQuerySchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const rows = await listDailyReviewMemos(db, user, c.req.valid("query"));
        return c.json({
          memos: await serializeMemosWithAttachments(db, user, rows),
        });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.get(
    "/review/random",
    zValidator("query", randomMemoQuerySchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const memo = await getRandomMemo(
          db,
          user,
          parseExcludeParam(c.req.valid("query").exclude),
        );
        const [serialized] = memo
          ? await serializeMemosWithAttachments(db, user, [memo])
          : [null];
        return c.json({ memo: serialized ?? null });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.get(
    "/review/walk",
    zValidator("query", walkNextQuerySchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const query = c.req.valid("query");
        const { memo, via } = await getWalkNextMemo(
          db,
          user,
          query.memoId,
          parseExcludeParam(query.exclude),
        );
        const [serialized] = memo
          ? await serializeMemosWithAttachments(db, user, [memo])
          : [null];
        return c.json({ memo: serialized ?? null, via: memo ? via : null });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.get(
    "/memos/:id/related",
    zValidator("query", relatedMemosQuerySchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const related = await listRelatedMemos(
          db,
          user,
          `memos/${c.req.param("id")}`,
          c.req.valid("query"),
        );
        const serialized = await serializeMemosWithAttachments(
          db,
          user,
          related.map((entry) => entry.memo),
        );
        const byId = new Map(serialized.map((memo) => [memo.name, memo]));
        return c.json({
          memos: related.flatMap((entry) => {
            const memo = byId.get(entry.memo.id);
            return memo
              ? [
                  {
                    ...memo,
                    shared_tags: entry.sharedTags,
                    via_relation: entry.viaRelation,
                  },
                ]
              : [];
          }),
        });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );
}
