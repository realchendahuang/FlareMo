import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    role: text("role", { enum: ["owner", "member"] })
      .notNull()
      .default("owner"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

export const memos = sqliteTable(
  "memos",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
  },
  (table) => [
    index("memos_user_status_pinned_created_id_idx").on(
      table.userId,
      table.status,
      table.pinned,
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
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type"),
    size: integer("size").notNull().default(0),
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
    uniqueIndex("attachments_user_client_id_idx").on(
      table.userId,
      table.clientId,
    ),
    index("attachments_user_state_created_idx").on(
      table.userId,
      table.state,
      table.createdAt,
    ),
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

export const settings = sqliteTable(
  "settings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }).$type<unknown>().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);

export type MemoPayload = {
  tags?: string[];
  property?: {
    title?: string;
    has_link?: boolean;
    has_task_list?: boolean;
    has_code?: boolean;
    has_incomplete_tasks?: boolean;
  };
  location?: unknown;
  client_id?: string;
  [key: string]: unknown;
};

export type UserRow = typeof users.$inferSelect;
export type MemoRow = typeof memos.$inferSelect;
export type NewMemoRow = typeof memos.$inferInsert;
export type MemoTagRow = typeof memoTags.$inferSelect;
export type MemoRevisionRow = typeof memoRevisions.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type ShareRow = typeof shares.$inferSelect;
