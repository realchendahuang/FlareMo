import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

// The semantic-search outbox. A row is enqueued atomically alongside the D1
// write that needs indexing; a scheduled sweep claims, embeds, and upserts or
// deletes the matching Vectorize vectors. Mirrors the webhook outbox's
// lease/claim/backoff shape so a crash mid-sweep can be reclaimed safely.
export const embeddingTasks = sqliteTable(
  "embedding_tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceType: text("resource_type", { enum: ["memo"] }).notNull(),
    resourceId: text("resource_id").notNull(),
    operation: text("operation", {
      enum: ["index", "reindex", "relocate", "delete"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "running", "succeeded", "dead"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at"),
    leaseUntil: text("lease_until"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("embedding_tasks_status_next_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("embedding_tasks_resource_idx").on(
      table.resourceType,
      table.resourceId,
    ),
  ],
);

// A month-bucketed usage counter for semantic search. Stored dimensions come
// from the Vectorize index `describe()`; this table tracks what we actively
// consume (query dimensions, embedding calls, and embedded tokens).
export const usageCounters = sqliteTable(
  "usage_counters",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    metric: text("metric", {
      enum: [
        "queried_dims",
        "embedding_tokens",
        "embedding_calls",
        "search_queries",
        "asr_seconds",
      ],
    }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("usage_counters_user_month_metric_idx").on(
      table.userId,
      table.month,
      table.metric,
    ),
  ],
);
