import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { authApiKeys, authUsers } from "./auth";

// Third-party client identities and device-authorization state. See
// docs/agent-access-design.md. These are FlareMo-owned domain tables (ISO text
// timestamps like the other domain tables), separate from Better Auth's
// `auth_*` tables; only the issued access tokens live in `auth_apikeys` so the
// existing PAT verification path keeps working unchanged.

/** A third-party client that may be authorized against this instance. */
export const appClients = sqliteTable(
  "app_clients",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** 'device' | 'web' | 'script' — see AppClientType in @flaremo/contracts. */
    clientType: text("client_type").notNull(),
    redirectUri: text("redirect_uri"),
    createdByAuthUserId: text("created_by_auth_user_id").references(
      () => authUsers.id,
      { onDelete: "set null" },
    ),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at"),
  },
  (table) => [
    index("app_clients_created_by_idx").on(table.createdByAuthUserId),
  ],
);

/** One in-flight device authorization. The user code is approved in a browser
 * session, then exchanged for a token by the client. */
export const deviceAuthorizations = sqliteTable(
  "device_authorizations",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => appClients.id, { onDelete: "cascade" }),
    /** Null until a signed-in user approves the code in the browser. */
    authUserId: text("auth_user_id").references(() => authUsers.id, {
      onDelete: "cascade",
    }),
    /** SHA-256 of the normalized user code; the plaintext is shown once. */
    userCodeHash: text("user_code_hash").notNull(),
    /** SHA-256 of the device code. */
    deviceCodeHash: text("device_code_hash").notNull(),
    /** JSON array of PAT scopes granted by the user. */
    scopes: text("scopes").notNull(),
    /** 'pending' | 'approved' | 'redeemed' | 'expired' */
    status: text("status").notNull().default("pending"),
    expiresAt: text("expires_at").notNull(),
    approvedAt: text("approved_at"),
    redeemedAt: text("redeemed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("device_authorizations_user_code_idx").on(table.userCodeHash),
    uniqueIndex("device_authorizations_device_code_idx").on(
      table.deviceCodeHash,
    ),
    index("device_authorizations_expires_at_idx").on(table.expiresAt),
  ],
);

/** A rotating refresh token issued to a device client. The current access
 * token is the `auth_apikeys` row referenced by `accessKeyId`. */
export const deviceRefreshTokens = sqliteTable(
  "device_refresh_tokens",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => appClients.id, { onDelete: "cascade" }),
    authUserId: text("auth_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /** SHA-256 of the refresh token; the plaintext is returned once. */
    tokenHash: text("token_hash").notNull(),
    /** `auth_apikeys.id` of the access token this refresh token currently mints. */
    accessKeyId: text("access_key_id").references(() => authApiKeys.id, {
      onDelete: "set null",
    }),
    /** JSON array of PAT scopes. */
    scopes: text("scopes").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("device_refresh_tokens_hash_idx").on(table.tokenHash),
    index("device_refresh_tokens_user_idx").on(table.authUserId),
    index("device_refresh_tokens_client_idx").on(table.clientId),
    index("device_refresh_tokens_expires_at_idx").on(table.expiresAt),
  ],
);
