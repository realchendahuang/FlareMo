import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { authOrganizations, users } from "./auth";
import type { MemoPayload } from "./rows";

export const memos = sqliteTable(
  "memos",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The team this memo is published to, or NULL for a personal memo only
    // its author can see. Team memos carry visibility "protected" (team
    // members read) or "public" (everyone reads); "private" always means
    // teamId NULL. See packages/domain/src/team-permissions.ts.
    teamId: text("team_id").references(() => authOrganizations.id, {
      onDelete: "restrict",
    }),
    content: text("content").notNull(),
    visibility: text("visibility", { enum: ["private", "protected", "public"] })
      .notNull()
      .default("private"),
    status: text("status", {
      enum: ["normal", "archived", "trashed", "deleted"],
    })
      .notNull()
      .default("normal"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    source: text("source").notNull().default("web"),
    // A client-generated id makes offline submission retries idempotent. It
    // intentionally stays internal; the compatible resource payload exposes
    // the matching `client_id` value to callers.
    clientId: text("client_id"),
    payload: text("payload", { mode: "json" })
      .$type<MemoPayload>()
      .notNull()
      .default({}),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    // Semantic-search index state. D1 stays the source of truth; the Vectorize
    // index is a rebuildable derived index keyed to embedding_version.
    embeddingStatus: text("embedding_status", {
      enum: ["not_indexed", "pending", "indexed", "error"],
    })
      .notNull()
      .default("not_indexed"),
    embeddingVersion: text("embedding_version"),
    embeddedAt: text("embedded_at"),
    embeddingError: text("embedding_error"),
    // Chunk count recorded at last successful index, for exact vector usage
    // reporting and targeted relocate/delete sweeps. NULL for rows that were
    // last indexed before this column existed (delete then falls back to the
    // bounded 256-chunk window).
    embeddingChunks: integer("embedding_chunks"),
  },
  (table) => [
    index("memos_user_status_pinned_created_id_idx").on(
      table.userId,
      table.status,
      table.pinned,
      table.createdAt,
      table.id,
    ),
    index("memos_user_created_id_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    index("memos_user_updated_id_idx").on(
      table.userId,
      table.updatedAt,
      table.id,
    ),
    uniqueIndex("memos_user_client_id_idx").on(table.userId, table.clientId),
    index("memos_visibility_idx").on(table.visibility),
    index("memos_team_visibility_status_idx").on(
      table.teamId,
      table.visibility,
      table.status,
    ),
    // The daily recycle-bin sweep filters `status = 'trashed' and
    // deleted_at < cutoff`; keep it off a full table scan (mirrors
    // attachments_cleanup_idx).
    index("memos_recycle_sweep_idx")
      .on(table.deletedAt)
      .where(sql`status = 'trashed'`),
    // "On this day" matches a month-day with `substr(created_at, 6, 5)`, which
    // no b-tree can seek into, so the daily cron used to read every normal
    // memo row — content blob included. This covering index lets that scan
    // read only the three small columns it projects.
    index("memos_normal_review_cover_idx")
      .on(table.createdAt, table.id, table.userId)
      .where(sql`status = 'normal'`),
  ],
);

// Per-author, per-UTC-hour memo counters.
//
// Why this exists: the stats endpoint used to answer every number by scanning
// `memos`, so a 4.7k-memo instance burned roughly 20k rows_read per request
// against D1's 5M/day free allowance — a few hundred heatmap tab switches
// exhausted the day. These counters make those reads scale with *when the user
// actually wrote* instead of with their total memo count.
//
// Hour granularity, not day: the heatmap answers a caller-supplied IANA time
// zone, and a UTC day always straddles two local days, so day buckets could
// only ever be approximately re-bucketed. Hour buckets re-bucket exactly for
// every modern zone (all are whole or half hours), and `currentStreak` walks
// the resulting array and breaks on the first zero — an off-by-one-day
// boundary here would silently break a streak.
//
// Each counter counts memos *currently* in that status, so a status
// transition moves one unit between columns instead of moving date buckets.
// The daily recalibration drops rows whose counters are all zero.
//
// This is a derived cache, never a source of truth: `memos` stays
// authoritative and the scheduled recalibration rebuilds it, so drift from a
// missed write self-heals within a day.
export const memoHourlyCounts = sqliteTable(
  "memo_hourly_counts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // `substr(created_at, 1, 13)` — "2026-01-31T09". Always UTC, never a
    // viewer-local value: the requested time zone is applied when reading.
    utcHour: text("utc_hour").notNull(),
    normalCount: integer("normal_count").notNull().default(0),
    archivedCount: integer("archived_count").notNull().default(0),
    trashedCount: integer("trashed_count").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.utcHour] })],
);

// D1 is shared by independent Worker isolates, so the Memos SSE stream needs
// a durable event cursor rather than an in-memory broadcaster. Event rows are
// deliberately not foreign-keyed to a memo: delete events must remain
// replayable after the resource itself has been removed.
export const memosSseEvents = sqliteTable(
  "memos_sse_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    name: text("name").notNull(),
    parent: text("parent"),
    visibility: text("visibility", {
      enum: ["private", "protected", "public"],
    }).notNull(),
    // Owning organization for protected events: delivery is restricted to
    // members of this team so event metadata cannot leak across orgs.
    teamId: text("team_id"),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("memos_sse_events_created_id_idx").on(table.createdAt, table.id),
    index("memos_sse_events_creator_id_idx").on(table.creatorId, table.id),
  ],
);

export const memoTags = sqliteTable(
  "memo_tags",
  {
    memoId: text("memo_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.memoId, table.tag] }),
    index("memo_tags_user_tag_memo_idx").on(
      table.userId,
      table.tag,
      table.memoId,
    ),
  ],
);

export const memoRevisions = sqliteTable(
  "memo_revisions",
  {
    id: text("id").primaryKey(),
    memoId: text("memo_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    visibility: text("visibility", {
      enum: ["private", "protected", "public"],
    }).notNull(),
    payload: text("payload", { mode: "json" })
      .$type<MemoPayload>()
      .notNull()
      .default({}),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("memo_revisions_memo_created_idx").on(table.memoId, table.createdAt),
    index("memo_revisions_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const memoRelations = sqliteTable(
  "memo_relations",
  {
    memoId: text("memo_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    relatedMemoId: text("related_memo_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["reference", "comment"] })
      .notNull()
      .default("reference"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.memoId, table.relatedMemoId, table.type] }),
    index("memo_relations_related_type_memo_idx").on(
      table.relatedMemoId,
      table.type,
      table.memoId,
    ),
  ],
);

// What the daily review remembers about one memo for its reader: the local
// day it was last read in the review (so the same note does not come back the
// next morning, and today's progress survives a reload or another device) and
// whether the reader asked never to see it there again. Purely derived reader
// state: losing a row only means a note may resurface sooner.
export const memoReviewMarks = sqliteTable(
  "memo_review_marks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memoId: text("memo_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    /** Viewer-local `YYYY-MM-DD` of the last review read, or NULL. */
    lastReviewedOn: text("last_reviewed_on"),
    muted: integer("muted", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.memoId] }),
    index("memo_review_marks_memo_idx").on(table.memoId),
  ],
);

// Memos reactions are first-class resources. `content_id` stores the memo
// resource name (`memos/...`) so the compatibility layer can reconstruct the
// upstream reaction resource name without introducing a second memo model.
export const reactions = sqliteTable(
  "reactions",
  {
    id: text("id").primaryKey(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: text("content_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    reactionType: text("reaction_type").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("reactions_creator_content_type_idx").on(
      table.creatorId,
      table.contentId,
      table.reactionType,
    ),
    index("reactions_content_created_id_idx").on(
      table.contentId,
      table.createdAt,
      table.id,
    ),
    index("reactions_creator_idx").on(table.creatorId),
  ],
);

// Shortcuts are stored as rows rather than encoded in the generic settings
// JSON. This preserves stable resource names and gives future multi-user
// deployments an ownership boundary that is independent of auth storage.
export const shortcuts = sqliteTable(
  "shortcuts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    filter: text("filter").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("shortcuts_user_created_id_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
  ],
);
