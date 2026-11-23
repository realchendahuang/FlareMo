import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { memos } from "./memos";

// Webhooks are first-class resources rather than a JSON setting. The secret
// is deliberately kept out of every public DTO; only the dedicated signing
// secret RPC may reveal it.
export const memosWebhooks = sqliteTable(
  "memos_webhooks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    displayName: text("display_name").notNull().default(""),
    signingSecret: text("signing_secret").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("memos_webhooks_user_created_id_idx").on(
      table.userId,
      table.createdAt,
      table.id,
    ),
  ],
);

// Webhook events are durable outbox rows. The body is a memo snapshot so
// delete events remain deliverable after the source memo is removed. Secrets
// and destination URLs stay in the webhook/delivery tables, never in the
// event payload.
export const memosWebhookEvents = sqliteTable(
  "memos_webhook_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    receiverId: text("receiver_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityType: text("activity_type").notNull(),
    body: text("body", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: text("created_at").notNull(),
    expandedAt: text("expanded_at"),
  },
  (table) => [
    index("memos_webhook_events_receiver_created_idx").on(
      table.receiverId,
      table.createdAt,
    ),
    index("memos_webhook_events_expanded_created_idx").on(
      table.expandedAt,
      table.createdAt,
    ),
    index("memos_webhook_events_created_expanded_idx").on(
      table.createdAt,
      table.expandedAt,
    ),
  ],
);

// One delivery row per event/webhook makes retries independent. `sending`
// rows carry a lease so a crashed Worker isolate can be reclaimed later.
export const memosWebhookDeliveries = sqliteTable(
  "memos_webhook_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id")
      .notNull()
      .references(() => memosWebhookEvents.id, { onDelete: "cascade" }),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => memosWebhooks.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "sending", "delivered", "dead"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull(),
    leaseUntil: text("lease_until"),
    deliveredAt: text("delivered_at"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("memos_webhook_deliveries_event_webhook_idx").on(
      table.eventId,
      table.webhookId,
    ),
    index("memos_webhook_deliveries_claim_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseUntil,
    ),
    index("memos_webhook_deliveries_event_idx").on(table.eventId),
  ],
);

// Notifications are inbox rows, not a denormalized user setting. Keeping the
// memo references and snippets here lets list/update/delete stay bounded and
// makes a comment notification idempotent for a given recipient/type pair.
// Web Push subscriptions for proactive reminders (daily review, overdue
// tasks). Endpoints are browser-scoped and unique; keys are base64url.
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
    index("push_subscriptions_user_idx").on(table.userId),
  ],
);

export const memosNotifications = sqliteTable(
  "memos_notifications",
  {
    // Upstream resource names use the inbox row's numeric ID. Keeping that
    // stable shape avoids clients treating the final path segment as opaque.
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    receiverId: text("receiver_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "memo_comment",
        "memo_mention",
        "daily_review",
        "task_overdue",
        "task_due",
      ],
    }).notNull(),
    status: text("status", { enum: ["unread", "archived"] })
      .notNull()
      .default("unread"),
    // A source event, rather than memo_id alone, is the idempotency boundary.
    // This permits a later re-mention after a user was removed from a memo's
    // content while still collapsing retries of the same mutation.
    sourceEventId: text("source_event_id").notNull(),
    // Task-overdue rows carry no memo anchor; the task title travels in the
    // snippet instead.
    memoId: text("memo_id").references(() => memos.id, { onDelete: "cascade" }),
    relatedMemoId: text("related_memo_id").references(() => memos.id, {
      onDelete: "cascade",
    }),
    // Task-overdue rows carry the task title here instead of a memo anchor.
    snippet: text("snippet"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("memos_notifications_receiver_source_type_idx").on(
      table.receiverId,
      table.sourceEventId,
      table.type,
    ),
    index("memos_notifications_receiver_created_id_idx").on(
      table.receiverId,
      table.createdAt,
      table.id,
    ),
    index("memos_notifications_receiver_status_created_idx").on(
      table.receiverId,
      table.status,
      table.createdAt,
    ),
  ],
);
