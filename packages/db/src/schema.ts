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
    payload: text("payload", { mode: "json" })
      .$type<MemoPayload>()
      .notNull()
      .default({}),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("memos_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt,
    ),
    index("memos_user_updated_idx").on(table.userId, table.updatedAt),
    index("memos_visibility_idx").on(table.visibility),
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
  },
  (table) => [
    uniqueIndex("shares_token_idx").on(table.token),
    index("shares_memo_idx").on(table.memoId),
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
export type AttachmentRow = typeof attachments.$inferSelect;
export type ShareRow = typeof shares.$inferSelect;
