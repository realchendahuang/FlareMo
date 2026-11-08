import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/** The JSON selector stored in `memo_insights.input`. */
export type MemoInsightInputJson = {
  /** Bare memo ids (no `memos/` prefix); the executor reads them through the
   * normal memo API. */
  memo_ids?: string[];
  tag?: string;
  query?: string;
};

/**
 * AI insight tasks and their results. See docs/agent-access-design.md §9.
 *
 * FlareMo stores only the contract: a task row says *what* to look at (`kind` +
 * `input`) and an external executor — the DSH plugin, Workers AI, or any other
 * agent — pulls pending rows, does the work, and writes `result` back. No model
 * lives in the Worker.
 *
 * This is derived data: rows are deletable and rebuildable from `memos`, so the
 * table stays out of the restore manifest and the export bundle (see
 * scripts/persistence-manifest.mjs). Timestamps are ISO text like the other
 * domain tables, not epoch integers.
 */
export const memoInsights = sqliteTable(
  "memo_insights",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 'note' | 'digest' | 'map' — the shape of insight to produce. */
    kind: text("kind", { enum: ["note", "digest", "map"] }).notNull(),
    /** JSON selector: memo ids, a tag, or a free-text query. */
    input: text("input", { mode: "json" })
      .$type<MemoInsightInputJson>()
      .notNull()
      .default({}),
    /** 'pending' | 'running' | 'done' | 'failed' — see §9.4. */
    status: text("status", {
      enum: ["pending", "running", "done", "failed"],
    })
      .notNull()
      .default("pending"),
    /** JSON payload written by the executor; NULL until it reports `done`. */
    result: text("result", { mode: "json" }).$type<unknown>(),
    /** Who produced the result: 'dsh', 'workers-ai', 'external', … */
    executor: text("executor"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The executor polls `WHERE user_id = ? AND status = 'pending'` oldest
    // first; the id tail keeps a same-millisecond batch stable.
    index("memo_insights_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt,
      table.id,
    ),
    // The browser's history view (and the eventual delete sweep) lists by
    // author in creation order without touching status.
    index("memo_insights_user_created_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
  ],
);
