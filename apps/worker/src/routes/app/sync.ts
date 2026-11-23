import {
  type ArticleRow,
  type AttachmentRow,
  articles,
  attachments,
  type MemoRow,
  memoRelations,
  memos,
  syncChanges,
} from "@flaremo/db";
import { ValidationError } from "@flaremo/domain";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { getRequestContext, type HonoBindings } from "../../context";
import { jsonError } from "../../http";
import { zValidator } from "../../validated";

/**
 * Native incremental-sync endpoints (docs/native-clients.md §4.4).
 *
 * The contract is a single monotonic cursor over `sync_changes` (written by
 * the 0049 triggers): `GET /sync/changes` returns references only, then
 * `POST /sync/hydrate` fetches the bodies in one round trip. This keeps a
 * sync response from growing with memo length, and a weak connection never
 * has to restart a whole page.
 */

/** `limit` cap from the contract; one page is a bounded index range scan. */
const CHANGES_LIMIT_MAX = 500;
/** Default page size: the doc's example page. */
const CHANGES_LIMIT_DEFAULT = 500;
/** Total ids accepted by one hydrate call (all entity lists together). */
const HYDRATE_IDS_MAX = 200;
/**
 * `memo_relations.updated_at` default from migration 0048. Relations inserted
 * by write paths that predate the column keep it, so the wire contract maps it
 * back to `created_at` (the row's only real write time) instead of exposing a
 * 1970 timestamp to clients.
 */
const RELATION_UPDATED_AT_SENTINEL = "1970-01-01T00:00:00.000Z";
/**
 * D1 caps one statement at 100 bound parameters (not SQLite's 999; Miniflare
 * enforces the same ceiling). A 200-id hydrate therefore cannot be a single
 * `IN (...)` list: 90 ids plus the user scope predicate stays below the cap.
 */
const HYDRATE_IDS_PER_QUERY = 90;

/** Runs `query` once per id chunk and concatenates the results in id order. */
async function selectInChunks<T>(
  ids: string[],
  query: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += HYDRATE_IDS_PER_QUERY) {
    rows.push(
      ...(await query(ids.slice(offset, offset + HYDRATE_IDS_PER_QUERY))),
    );
  }
  return rows;
}

const changesQuerySchema = z.object({
  since: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(CHANGES_LIMIT_MAX).optional(),
});

/**
 * Hydrate takes id lists per entity. Names are snake_case on the wire, which
 * is also what the native clients encode (`convertToSnakeCase`).
 */
const idListSchema = z
  .array(z.string().trim().min(1).max(128))
  .max(HYDRATE_IDS_MAX)
  .optional();

const hydrateBodySchema = z.object({
  memo_ids: idListSchema,
  attachment_ids: idListSchema,
  article_ids: idListSchema,
  relation_ids: idListSchema,
});

function uniqueIds(ids: string[] | undefined): string[] {
  return ids ? [...new Set(ids)] : [];
}

/**
 * `410 Gone` = the client's cursor predates the retained window, so some
 * changes it never saw are already pruned. The client must rebuild from a
 * full sync (§4.4); continuing from this cursor would silently lose data.
 */
function cursorExpired(c: Context<HonoBindings>) {
  return c.json(
    {
      error: {
        message:
          "Sync cursor expired: changes before the retention window were pruned. Rebuild the local store with a full sync.",
      },
    },
    410,
    { "cache-control": "no-store" },
  );
}

/** Row shape of one change reference. Deliberately carries no content. */
function changeToDto(row: typeof syncChanges.$inferSelect) {
  return {
    seq: row.seq,
    entity: row.entity,
    entity_id: row.entityId,
    op: row.op,
    version: row.version,
    updated_at: row.updatedAt,
  };
}

/**
 * The fact-layer row shapes below mirror the local SQLite column names 1:1
 * (§7.7: local tables are a copy of D1), minus the derived `embedding_*`
 * columns — those are rebuilt locally and never synced.
 */
function memoToHydrateDto(row: MemoRow) {
  return {
    id: row.id,
    user_id: row.userId,
    team_id: row.teamId,
    content: row.content,
    visibility: row.visibility,
    status: row.status,
    pinned: row.pinned,
    source: row.source,
    client_id: row.clientId,
    payload: row.payload,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
    version: row.version,
  };
}

function attachmentToHydrateDto(row: AttachmentRow) {
  return {
    id: row.id,
    user_id: row.userId,
    memo_id: row.memoId,
    article_id: row.articleId,
    r2_key: row.r2Key,
    filename: row.filename,
    content_type: row.contentType,
    size: row.size,
    thumbnail_size: row.thumbnailSize,
    state: row.state,
    client_id: row.clientId,
    etag: row.etag,
    payload: row.payload,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
    version: row.version,
  };
}

function articleToHydrateDto(row: ArticleRow) {
  return {
    id: row.id,
    user_id: row.userId,
    team_id: row.teamId,
    slug: row.slug,
    title: row.title,
    description: row.description,
    content: row.content,
    status: row.status,
    cover_attachment_id: row.coverAttachmentId,
    lang: row.lang,
    published_at: row.publishedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
    version: row.version,
  };
}

export function registerSyncRoutes(app: Hono<HonoBindings>) {
  /**
   * GET /api/app/sync/changes?since=<seq>&limit=<n>
   *
   * Cheap by construction: the cursor scan is `(user_id, seq)` index-only and
   * an empty poll reads zero rows. The retention probe is `min(seq)` on an
   * INTEGER PRIMARY KEY rowid, which SQLite answers without a table scan.
   * Never returns bodies, so page size is independent of memo length.
   */
  app.get(
    "/sync/changes",
    zValidator("query", changesQuerySchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const query = c.req.valid("query");
        const since = query.since ?? 0;
        const limit = query.limit ?? CHANGES_LIMIT_DEFAULT;

        // Retention watermark. `seq` is AUTOINCREMENT and the 0049 backfill
        // seeds every pre-existing row, so a cursor at or after `min(seq) - 1`
        // is contiguous. `min(seq) - 1` rather than `min(seq)`: a client that
        // consumed exactly the last pruned row is still complete.
        const [oldest] = await db
          .select({ seq: sql<number | null>`min(${syncChanges.seq})` })
          .from(syncChanges);
        if (
          oldest?.seq !== null &&
          oldest?.seq !== undefined &&
          since < oldest.seq - 1
        ) {
          return cursorExpired(c);
        }

        // Fetch one extra row to answer `has_more` without a COUNT.
        const rows = await db
          .select()
          .from(syncChanges)
          .where(
            and(eq(syncChanges.userId, user.id), gt(syncChanges.seq, since)),
          )
          .orderBy(asc(syncChanges.seq))
          .limit(limit + 1);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page[page.length - 1];
        return c.json(
          {
            changes: page.map(changeToDto),
            next_seq: last ? last.seq : since,
            has_more: hasMore,
          },
          200,
          { "cache-control": "no-store" },
        );
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  /**
   * POST /api/app/sync/hydrate
   *
   * Batch body fetch for ids returned by `/sync/changes` (≤200 total). All
   * queries are scoped to the caller's own rows, matching the ownership rule
   * of the change log itself. Soft-deleted rows are returned too — a tombstone
   * is body-shaped data the client mirrors (`deleted_at` + `version`), and
   * omitting it would leave a stale local row behind. Unknown or foreign ids
   * are simply absent from the response.
   */
  app.post(
    "/sync/hydrate",
    zValidator("json", hydrateBodySchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const body = c.req.valid("json");
        const memoIds = uniqueIds(body.memo_ids);
        const attachmentIds = uniqueIds(body.attachment_ids);
        const articleIds = uniqueIds(body.article_ids);
        const relationIds = uniqueIds(body.relation_ids);
        const total =
          memoIds.length +
          attachmentIds.length +
          articleIds.length +
          relationIds.length;
        if (total > HYDRATE_IDS_MAX) {
          throw new ValidationError(
            `Hydrate accepts at most ${HYDRATE_IDS_MAX} ids per call.`,
          );
        }

        const [memoRows, attachmentRows, articleRows, relationRows] =
          await Promise.all([
            selectInChunks(memoIds, (chunk) =>
              db
                .select()
                .from(memos)
                .where(and(eq(memos.userId, user.id), inArray(memos.id, chunk)))
                .orderBy(asc(memos.id)),
            ),
            selectInChunks(attachmentIds, (chunk) =>
              db
                .select()
                .from(attachments)
                .where(
                  and(
                    eq(attachments.userId, user.id),
                    inArray(attachments.id, chunk),
                  ),
                )
                .orderBy(asc(attachments.id)),
            ),
            selectInChunks(articleIds, (chunk) =>
              db
                .select()
                .from(articles)
                .where(
                  and(
                    eq(articles.userId, user.id),
                    inArray(articles.id, chunk),
                  ),
                )
                .orderBy(asc(articles.id)),
            ),
            selectInChunks(relationIds, (chunk) =>
              db
                .select({
                  memoId: memoRelations.memoId,
                  relatedMemoId: memoRelations.relatedMemoId,
                  type: memoRelations.type,
                  createdAt: memoRelations.createdAt,
                  updatedAt: memoRelations.updatedAt,
                })
                .from(memoRelations)
                .innerJoin(memos, eq(memos.id, memoRelations.memoId))
                .where(
                  and(
                    eq(memos.userId, user.id),
                    inArray(memoRelations.memoId, chunk),
                  ),
                )
                .orderBy(
                  asc(memoRelations.memoId),
                  asc(memoRelations.relatedMemoId),
                ),
            ),
          ]);

        return c.json(
          {
            memos: memoRows.map(memoToHydrateDto),
            attachments: attachmentRows.map(attachmentToHydrateDto),
            articles: articleRows.map(articleToHydrateDto),
            // Relations have no version column: the sync log stores 0 for
            // them, and `id` is the relation's sync entity id (the child
            // memo id), so clients can key the row exactly like a change.
            relations: relationRows.map((row) => ({
              id: row.memoId,
              memo_id: row.memoId,
              related_memo_id: row.relatedMemoId,
              type: row.type,
              created_at: row.createdAt,
              updated_at:
                row.updatedAt === RELATION_UPDATED_AT_SENTINEL
                  ? row.createdAt
                  : row.updatedAt,
              version: 0,
            })),
          },
          200,
          { "cache-control": "no-store" },
        );
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );
}
