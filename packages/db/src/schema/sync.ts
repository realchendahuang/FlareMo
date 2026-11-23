import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * Native sync change log (migration 0048, docs/native-clients.md §4.3/§4.4).
 *
 * Every write to one of the four sync entities appends one row here through
 * the triggers created in migration 0049. Clients poll with a single
 * monotonic `seq` cursor and then hydrate the bodies they do not have yet, so
 * this table stores references only — never memo/article content.
 *
 * Deliberately NOT foreign-keyed to the resource (and not to `users`): a
 * tombstone must stay replayable after the row it points at is hard-deleted,
 * and a user deletion cascade must not erase another user's cursor history.
 * `user_id` is the owner the row was written for; the sync endpoint always
 * filters on it, and the `(user_id, seq)` index makes both the range scan and
 * the empty-poll case cheap.
 */
export const syncChanges = sqliteTable(
  "sync_changes",
  {
    /** Global monotonic cursor. AUTOINCREMENT so a deleted max is never reused. */
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    /** memo | attachment | article | relation */
    entity: text("entity", {
      enum: ["memo", "attachment", "article", "relation"],
    }).notNull(),
    /**
     * Resource id for memo/attachment/article; for `relation` it is the
     * relation's `memo_id` (the comment's own memo id), because the relation
     * primary key is a triple and clients key hydration by the child memo.
     */
    entityId: text("entity_id").notNull(),
    /** upsert | delete */
    op: text("op", { enum: ["upsert", "delete"] }).notNull(),
    /** Resource version at write time; 0 for relation rows (no version column). */
    version: integer("version").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("sync_changes_user_seq_idx").on(table.userId, table.seq)],
);

/**
 * APNs / FCM device registrations (migration 0048, docs/native-clients.md
 * §4.3/§4.10). Native clients register a push token here so a server-side
 * write can wake them for a pull instead of keeping an SSE connection open.
 *
 * The token is unique per platform: the same physical token re-registered by
 * another account must be reassigned, not duplicated (upsert on the unique
 * index). Revocation is soft (`revoked_at`) so a delivery attempt can tell
 * "unregistered" apart from "never seen".
 */
export const nativePushDevices = sqliteTable(
  "native_push_devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** ios | android | macos | windows */
    platform: text("platform", {
      enum: ["ios", "android", "macos", "windows"],
    }).notNull(),
    token: text("token").notNull(),
    /** APNs only: 'sandbox' | 'production'. FCM ignores it. */
    environment: text("environment").notNull().default("production"),
    revokedAt: text("revoked_at"),
    lastSeenAt: text("last_seen_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("native_push_devices_token_idx").on(
      table.platform,
      table.token,
    ),
    index("native_push_devices_user_idx").on(table.userId),
  ],
);
