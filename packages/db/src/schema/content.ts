import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { authOrganizations, users } from "./auth";
import { memos } from "./memos";

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memoId: text("memo_id").references(() => memos.id, {
      onDelete: "set null",
    }),
    // Article-bound uploads (article editor). Same lifecycle rule as memoId:
    // an attachment bound to neither is an orphan the cron GC sweeps after
    // the grace period.
    articleId: text("article_id").references(() => articles.id, {
      onDelete: "set null",
    }),
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type"),
    size: integer("size").notNull().default(0),
    // Bytes of the derived preview object stored beside `r2Key`. Kept apart
    // from `size` (the original file) because the public attachment DTO and
    // Memos-compatible clients expect `size` to describe the uploaded file,
    // while the storage quota must count both objects.
    thumbnailSize: integer("thumbnail_size").notNull().default(0),
    state: text("state", {
      enum: ["ready", "deleting", "missing"],
    })
      .notNull()
      .default("ready"),
    // Stable client ids let an offline retry recognize an attachment whose
    // upload completed before the browser lost the response.
    clientId: text("client_id"),
    etag: text("etag"),
    payload: text("payload", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("attachments_user_created_idx").on(table.userId, table.createdAt),
    index("attachments_memo_idx").on(table.memoId),
    // Attachments for one memo are always listed newest-first.
    index("attachments_memo_created_idx").on(table.memoId, table.createdAt),
    index("attachments_article_idx").on(table.articleId),
    uniqueIndex("attachments_user_client_id_idx").on(
      table.userId,
      table.clientId,
    ),
    index("attachments_user_state_created_idx").on(
      table.userId,
      table.state,
      table.createdAt,
    ),
    // `getAttachmentStorageBytes` runs on every upload to check the storage
    // quota, and it only needs `size` for ready rows. Without `size` in the
    // index every quota check table-looks-up the user's whole attachment set.
    index("attachments_user_state_size_idx")
      .on(table.userId, table.size)
      .where(sql`${table.state} = 'ready'`),
    // The cleanup cron scans globally on this predicate (deleting rows or
    // orphaned unbound attachments); keep the sweep off a full table scan.
    index("attachments_cleanup_idx")
      .on(table.createdAt)
      .where(
        sql`(state = 'deleting' or (memo_id is null and article_id is null))`,
      ),
  ],
);

/**
 * Articles: long-form Markdown pieces written for public publishing. Unlike
 * memos (stateless, timestamp-boned), an article carries its own lifecycle
 * (draft → published) and a stable, enumerable public URL. Publishing is
 * deliberately the opposite contract of memo shares: a published slug is
 * enumerable (sitemap/RSS) while share tokens are unenumerable by design.
 * See docs/article-publishing-design.md.
 */
export const articles = sqliteTable(
  "articles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Reserved for team-space integration (P2); first release is personal.
    teamId: text("team_id").references(() => authOrganizations.id, {
      onDelete: "restrict",
    }),
    // Stable public URL identity. Editable while a draft, frozen once
    // published — a canonical change is an SEO incident.
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    // SEO description; SSR falls back to the article's plain text when null.
    description: text("description"),
    content: text("content").notNull(),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    // og:image; SSR falls back to the first body image when null.
    coverAttachmentId: text("cover_attachment_id"),
    // Author-declared content language; SSR falls back to the instance
    // locale when null.
    lang: text("lang"),
    // Set on first publish and kept across unpublish/republish cycles.
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("articles_slug_idx").on(table.slug),
    index("articles_user_status_updated_idx").on(
      table.userId,
      table.status,
      table.updatedAt,
    ),
    index("articles_team_status_idx").on(table.teamId, table.status),
    // Sitemap / RSS ordering.
    index("articles_published_idx").on(table.publishedAt),
    // Recycle-bin TTL sweep (mirrors memos_recycle_sweep_idx); a published
    // article may also be soft-deleted, so the predicate keys on deleted_at.
    index("articles_recycle_sweep_idx")
      .on(table.deletedAt)
      .where(sql`deleted_at is not null`),
  ],
);

export const shares = sqliteTable(
  "shares",
  {
    id: text("id").primaryKey(),
    memoId: text("memo_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("shares_token_idx").on(table.token),
    index("shares_memo_idx").on(table.memoId),
    index("shares_user_memo_revoked_idx").on(
      table.userId,
      table.memoId,
      table.revokedAt,
    ),
  ],
);
