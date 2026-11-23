import {
  createArticleSchema,
  listArticlesQuerySchema,
  publishArticleSchema,
  updateArticleSchema,
} from "@flaremo/contracts";
import {
  createArticle,
  deleteArticle,
  getArticle,
  listArticles,
  parseResourceName,
  publishArticle,
  restoreArticle,
  unpublishArticle,
  updateArticle,
  ValidationError,
} from "@flaremo/domain";
import { Hono } from "hono";
import { getRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";
import { rateLimitGuard } from "../rate-limit";
import { zValidator } from "../validated";

export const articlesApi = new Hono<HonoBindings>();

// `/api/app/*` routes take a bare resource id in the URL path; the shared
// helper prepends the namespaced prefix (and passes namespaced names through).
function parseArticleId(value: string) {
  return parseResourceName(value, "articles");
}

/**
 * Publish works with an empty body (server derives everything), so a missing
 * or unparsable body is fine. A *present* body that fails validation is not:
 * silently dropping a malformed slug would publish under a URL the author
 * never chose.
 */
async function optionalPublishInput(c: { req: { raw: Request } }) {
  const text = await c.req.raw.text().catch(() => "");
  if (!text.trim()) return {};
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ValidationError("Publish body must be JSON.");
  }
  const parsed = publishArticleSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid publish payload.",
    );
  }
  return parsed.data;
}

articlesApi.get(
  "/",
  zValidator("query", listArticlesQuerySchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const query = c.req.valid("query");
      return c.json({
        articles: await listArticles(db, user, {
          status: query.status,
          includeDeleted: query.include_deleted,
        }),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

articlesApi.post("/", zValidator("json", createArticleSchema), async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "articles", user.id);
    if (throttled) return throttled;
    return c.json(
      { article: await createArticle(db, user, c.req.valid("json")) },
      201,
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

articlesApi.get("/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    return c.json({
      article: await getArticle(db, user, parseArticleId(c.req.param("id"))),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

articlesApi.patch(
  "/:id",
  zValidator("json", updateArticleSchema),
  async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const throttled = await rateLimitGuard(c, "articles", user.id);
      if (throttled) return throttled;
      return c.json({
        article: await updateArticle(
          db,
          user,
          parseArticleId(c.req.param("id")),
          c.req.valid("json"),
        ),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

articlesApi.post("/:id/publish", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "articles", user.id);
    if (throttled) return throttled;
    const input = await optionalPublishInput(c);
    return c.json({
      article: await publishArticle(
        db,
        user,
        parseArticleId(c.req.param("id")),
        input,
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

articlesApi.post("/:id/unpublish", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const throttled = await rateLimitGuard(c, "articles", user.id);
    if (throttled) return throttled;
    return c.json({
      article: await unpublishArticle(
        db,
        user,
        parseArticleId(c.req.param("id")),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

// DELETE is a soft delete; this pulls a binned article back out of the
// recycle bin.
articlesApi.post("/:id/restore", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    return c.json({
      article: await restoreArticle(
        db,
        user,
        parseArticleId(c.req.param("id")),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

articlesApi.delete("/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const article = await deleteArticle(
      db,
      user,
      parseArticleId(c.req.param("id")),
    );
    return c.json({ article });
  } catch (error) {
    return jsonError(c, error);
  }
});
