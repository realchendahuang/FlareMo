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
    role: text("role", { enum: ["owner", "admin", "member"] })
      .notNull()
      .default("owner"),
    status: text("status", { enum: ["active", "removed"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    index("users_role_status_idx").on(table.role, table.status),
  ],
);

// Better Auth owns authentication identities. These tables intentionally stay
// separate from the domain `users` table above so existing memo, attachment,
// share, and R2 ownership identifiers remain stable during the auth cutover.
//
// Better Auth hands real Date objects to the Drizzle adapter, so its timestamp
// columns use `timestamp_ms` rather than the domain tables' ISO text dates.
const authTimestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const authUsers = sqliteTable(
  "auth_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    image: text("image"),
    username: text("username"),
    displayUsername: text("display_username"),
    createdAt: authTimestamp("created_at").notNull(),
    updatedAt: authTimestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("auth_users_email_idx").on(table.email),
    uniqueIndex("auth_users_username_idx").on(table.username),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: authTimestamp("expires_at").notNull(),
    token: text("token").notNull(),
    createdAt: authTimestamp("created_at").notNull(),
    updatedAt: authTimestamp("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_idx").on(table.token),
    index("auth_sessions_user_id_idx").on(table.userId),
  ],
);

export const authAccounts = sqliteTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: authTimestamp("access_token_expires_at"),
    refreshTokenExpiresAt: authTimestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: authTimestamp("created_at").notNull(),
    updatedAt: authTimestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("auth_accounts_provider_account_idx").on(
      table.providerId,
      table.accountId,
    ),
    index("auth_accounts_user_id_idx").on(table.userId),
  ],
);

export const authVerifications = sqliteTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: authTimestamp("expires_at").notNull(),
    createdAt: authTimestamp("created_at").notNull(),
    updatedAt: authTimestamp("updated_at").notNull(),
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)],
);

export const authApiKeys = sqliteTable(
  "auth_apikeys",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull().default("memos"),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: authTimestamp("last_refill_at"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    rateLimitEnabled: integer("rate_limit_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").notNull().default(0),
    remaining: integer("remaining"),
    lastRequest: authTimestamp("last_request"),
    expiresAt: authTimestamp("expires_at"),
    permissions: text("permissions"),
    metadata: text("metadata"),
    createdAt: authTimestamp("created_at").notNull(),
    updatedAt: authTimestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("auth_apikeys_key_idx").on(table.key),
    index("auth_apikeys_reference_config_idx").on(
      table.referenceId,
      table.configId,
    ),
    index("auth_apikeys_expires_at_idx").on(table.expiresAt),
  ],
);

// This one-to-one bridge is the only authentication-to-domain ownership
// mapping. A future multi-user feature can add more mapped pairs without
// changing any existing FlareMo resource IDs.
export const authUserLinks = sqliteTable(
  "auth_user_links",
  {
    authUserId: text("auth_user_id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    flaremoUserId: text("flaremo_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: authTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("auth_user_links_flaremo_user_id_idx").on(table.flaremoUserId),
  ],
);

export const authBootstrap = sqliteTable("auth_bootstrap", {
  id: text("id").primaryKey(),
  state: text("state", {
    enum: ["initializing", "complete", "recovery_required"],
  }).notNull(),
  authUserId: text("auth_user_id").references(() => authUsers.id, {
    onDelete: "restrict",
  }),
  flaremoUserId: text("flaremo_user_id").references(() => users.id, {
    onDelete: "restrict",
  }),
  createdAt: authTimestamp("created_at").notNull(),
  completedAt: authTimestamp("completed_at"),
});

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
      enum: ["memo_comment", "memo_mention", "daily_review"],
    }).notNull(),
    status: text("status", { enum: ["unread", "archived"] })
      .notNull()
      .default("unread"),
    // A source event, rather than memo_id alone, is the idempotency boundary.
    // This permits a later re-mention after a user was removed from a memo's
    // content while still collapsing retries of the same mutation.
    sourceEventId: text("source_event_id").notNull(),
    memoId: text("memo_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    relatedMemoId: text("related_memo_id").references(() => memos.id, {
      onDelete: "cascade",
    }),
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

// Agent Memory keeps AI-contributed long-term knowledge separate from the
// user's memo timeline. Each memory is an atomic conclusion (see
// docs/product-requirements.md and the Agent Memory design); long-form content
// belongs in a memo, and a memory's `content` only stores the conclusion.
// D1 remains the single source of truth: FTS and any future embedding index
// are derived and rebuildable from these rows.
export const memoryItems = sqliteTable(
  "memory_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    type: text("type", {
      enum: ["semantic", "episodic", "procedural"],
    })
      .notNull()
      .default("semantic"),
    kind: text("kind", {
      enum: [
        "preference",
        "fact",
        "decision",
        "constraint",
        "entity",
        "event",
        "outcome",
        "lesson",
        "procedure",
      ],
    })
      .notNull()
      .default("fact"),
    scopeType: text("scope_type", {
      enum: ["global", "workspace", "project", "agent"],
    })
      .notNull()
      .default("global"),
    scopeKey: text("scope_key"),
    tier: text("tier", { enum: ["core", "normal"] })
      .notNull()
      .default("normal"),
    verification: text("verification", {
      enum: ["inferred", "observed", "confirmed", "locked"],
    })
      .notNull()
      .default("observed"),
    status: text("status", {
      enum: ["active", "superseded", "disputed", "archived", "deleted"],
    })
      .notNull()
      .default("active"),
    importance: integer("importance").notNull().default(50),
    confidence: integer("confidence").notNull().default(50),
    needsReview: integer("needs_review", { mode: "boolean" })
      .notNull()
      .default(false),
    reviewReason: text("review_reason"),
    createdByType: text("created_by_type", { enum: ["user", "agent"] })
      .notNull()
      .default("agent"),
    sourceAgent: text("source_agent"),
    sourceSession: text("source_session"),
    sourceRef: text("source_ref"),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    // Normalized content + type + kind + scope hash, used to reject exact
    // duplicates without an embedding index.
    fingerprint: text("fingerprint").notNull(),
    accessCount: integer("access_count").notNull().default(0),
    lastAccessedAt: text("last_accessed_at"),
    // Reserved for the optional P1 embedding layer. P0 keeps these at
    // `not_indexed` and never touches a vector binding.
    embeddingStatus: text("embedding_status", {
      enum: ["not_indexed", "pending", "indexed", "error"],
    })
      .notNull()
      .default("not_indexed"),
    embeddingVersion: text("embedding_version"),
    embeddedAt: text("embedded_at"),
    embeddingError: text("embedding_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("memory_items_user_scope_status_idx").on(
      table.userId,
      table.scopeType,
      table.scopeKey,
      table.status,
    ),
    index("memory_items_user_type_kind_idx").on(
      table.userId,
      table.type,
      table.kind,
    ),
    index("memory_items_user_tier_idx").on(table.userId, table.tier),
    uniqueIndex("memory_items_user_fingerprint_idx").on(
      table.userId,
      table.fingerprint,
    ),
  ],
);

export const memoryRevisions = sqliteTable(
  "memory_revisions",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    metadataSnapshot: text("metadata_snapshot", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdByType: text("created_by_type", {
      enum: ["user", "agent"],
    }).notNull(),
    createdByAgent: text("created_by_agent"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("memory_revisions_memory_created_idx").on(
      table.memoryId,
      table.createdAt,
    ),
    index("memory_revisions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const memoryRelations = sqliteTable(
  "memory_relations",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    relatedMemoryId: text("related_memory_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "related_to",
        "supports",
        "contradicts",
        "supersedes",
        "depends_on",
        "part_of",
      ],
    })
      .notNull()
      .default("related_to"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("memory_relations_memory_related_type_idx").on(
      table.memoryId,
      table.relatedMemoryId,
      table.type,
    ),
    index("memory_relations_related_idx").on(table.relatedMemoryId, table.type),
  ],
);

export const memoryResourceLinks = sqliteTable(
  "memory_resource_links",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceType: text("resource_type", {
      enum: ["memo", "session", "github", "url", "document", "other"],
    }).notNull(),
    resourceRef: text("resource_ref").notNull(),
    relationType: text("relation_type", {
      enum: ["derived_from", "evidence", "references", "promoted_to"],
    })
      .notNull()
      .default("derived_from"),
    metadata: text("metadata", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("memory_resource_links_memory_idx").on(table.memoryId),
    index("memory_resource_links_resource_idx").on(
      table.resourceType,
      table.resourceRef,
    ),
  ],
);

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
    resourceType: text("resource_type", { enum: ["memo", "memory"] }).notNull(),
    resourceId: text("resource_id").notNull(),
    operation: text("operation", {
      enum: ["index", "reindex", "delete"],
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

// Projects group tasks. They are first-class domain resources (not memo tags)
// so agents and scripts can read a stable "what projects do I have, how many
// tasks in each" through the app API without re-parsing memo markdown.
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("projects_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt,
    ),
  ],
);

// Tasks are thin, ordered work items under a project. `status` and `sort_order`
// are columns (not a JSON payload) so list/board grouping stays indexable.
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    status: text("status", { enum: ["todo", "in_progress", "done"] })
      .notNull()
      .default("todo"),
    priority: text("priority", { enum: ["none", "low", "medium", "high"] })
      .notNull()
      .default("none"),
    dueAt: text("due_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("tasks_user_project_status_sort_idx").on(
      table.userId,
      table.projectId,
      table.status,
      table.sortOrder,
    ),
    index("tasks_user_due_idx").on(table.userId, table.dueAt),
  ],
);

// An append-only audit trail per task mutation. Agents get full write access,
// so observability (who changed what, when) is what makes that trustable and
// reversible rather than gating the agent's permissions. `task_id` is null for
// project-scoped events (e.g. reorders) that do not target a single task.
export const taskActivity = sqliteTable(
  "task_activity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorType: text("actor_type", { enum: ["user", "agent"] }).notNull(),
    actorName: text("actor_name"),
    action: text("action", {
      enum: ["created", "updated", "status_changed", "deleted", "reordered"],
    }).notNull(),
    changes: text("changes", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("task_activity_task_created_idx").on(table.taskId, table.createdAt),
    index("task_activity_user_created_idx").on(table.userId, table.createdAt),
  ],
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
export type AuthUserRow = typeof authUsers.$inferSelect;
export type AuthApiKeyRow = typeof authApiKeys.$inferSelect;
export type AuthBootstrapRow = typeof authBootstrap.$inferSelect;
export type MemoRow = typeof memos.$inferSelect;
export type NewMemoRow = typeof memos.$inferInsert;
export type MemosSseEventRow = typeof memosSseEvents.$inferSelect;
export type MemoTagRow = typeof memoTags.$inferSelect;
export type MemoRevisionRow = typeof memoRevisions.$inferSelect;
export type ReactionRow = typeof reactions.$inferSelect;
export type ShortcutRow = typeof shortcuts.$inferSelect;
export type MemosWebhookRow = typeof memosWebhooks.$inferSelect;
export type MemosWebhookEventRow = typeof memosWebhookEvents.$inferSelect;
export type MemosWebhookDeliveryRow =
  typeof memosWebhookDeliveries.$inferSelect;
export type MemosNotificationRow = typeof memosNotifications.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type ShareRow = typeof shares.$inferSelect;
export type DataTaskRow = typeof dataTasks.$inferSelect;
export type NewDataTaskRow = typeof dataTasks.$inferInsert;
export type MemoryItemRow = typeof memoryItems.$inferSelect;
export type NewMemoryItemRow = typeof memoryItems.$inferInsert;
export type MemoryRevisionRow = typeof memoryRevisions.$inferSelect;
export type MemoryRelationRow = typeof memoryRelations.$inferSelect;
export type MemoryResourceLinkRow = typeof memoryResourceLinks.$inferSelect;
export type EmbeddingTaskRow = typeof embeddingTasks.$inferSelect;
export type NewEmbeddingTaskRow = typeof embeddingTasks.$inferInsert;
export type UsageCounterRow = typeof usageCounters.$inferSelect;
export type NewUsageCounterRow = typeof usageCounters.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type TaskActivityRow = typeof taskActivity.$inferSelect;
export type NewTaskActivityRow = typeof taskActivity.$inferInsert;
