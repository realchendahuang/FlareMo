import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

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

/**
 * Async data-transfer tasks for large import/export operations that exceed
 * the inline bundle limits. The task row is the durable execution record:
 * cron reclaims stale `running` tasks via `lease_until`, and the R2 artifact
 * referenced by `manifestKey` expires independently of the row.
 */
export const dataTasks = sqliteTable(
  "data_tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["export", "import"] }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "expired"],
    })
      .notNull()
      .default("queued"),
    phase: text("phase").notNull().default("created"),
    attempts: integer("attempts").notNull().default(0),
    manifestKey: text("manifest_key"),
    // Options that must survive a retry: the import conflict strategy cannot
    // be recovered from the bundle itself.
    options: text("options", { mode: "json" }).$type<{
      conflict?: "skip" | "duplicate" | "overwrite";
    }>(),
    progressDone: integer("progress_done").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    leaseUntil: text("lease_until"),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("data_tasks_user_created_idx").on(table.userId, table.createdAt),
    index("data_tasks_status_lease_idx").on(table.status, table.leaseUntil),
    index("data_tasks_expires_idx").on(table.expiresAt),
  ],
);

/**
 * Checkpoint ledger for an import task: one row per top-level record the task
 * inserted. A failure — or a retry after an interrupted Worker — rolls these
 * back before the import runs again, so a partial bundle never stays visible
 * and a retry cannot duplicate rows.
 *
 * Child rows (memo tags/relations, memory revisions/evidence/events) are
 * deliberately omitted: their foreign keys cascade from the audited parent.
 * Attachments are listed because deleting a memo only nulls their `memo_id`.
 */
export const importTaskRows = sqliteTable(
  "import_task_rows",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => dataTasks.id, { onDelete: "cascade" }),
    tableName: text("table_name", {
      enum: [
        "memos",
        "attachments",
        "shares",
        "memory_items",
        "projects",
        "tasks",
      ],
    }).notNull(),
    rowId: text("row_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.tableName, table.rowId] }),
    index("import_task_rows_task_idx").on(table.taskId),
  ],
);

/** Durable administrator-owned member removal workflow records. */
export const memberRemovalJobs = sqliteTable(
  "member_removal_jobs",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull(),
    requestedBy: text("requested_by").notNull(),
    status: text("status", {
      enum: ["queued", "removing", "failed", "completed"],
    })
      .notNull()
      .default("queued"),
    phase: text("phase").notNull().default("created"),
    attempts: integer("attempts").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("member_removal_jobs_member_idx").on(table.memberId, table.createdAt),
    index("member_removal_jobs_status_idx").on(table.status, table.updatedAt),
  ],
);
