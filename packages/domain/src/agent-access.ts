import {
  ACCESS_TOKEN_TTL_DAYS,
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  MAX_APP_CLIENTS,
  REFRESH_TOKEN_TTL_DAYS,
  USER_CODE_ALPHABET,
  USER_CODE_LENGTH,
  type AppClientType,
  type ConnectErrorCode,
  type ConnectedAppDto,
  type MemosPatScope,
  normalizeMemosPatScopes,
  memosPatScopesFromPermissions,
  normalizeUserCode,
} from "@flaremo/contracts";
import type { FlareMoDb } from "@flaremo/db";
import {
  appClients,
  authApiKeys,
  deviceAuthorizations,
  deviceRefreshTokens,
} from "@flaremo/db";
import { and, asc, desc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { NotFoundError, ValidationError } from "./errors";

/**
 * Device-authorization (RFC 8628) and connected-app storage services.
 *
 * Token minting and revocation stay in the Worker layer (`auth.api.*`), because
 * they need the Better Auth instance; everything here is pure D1/Drizzle state.
 * See docs/agent-access-design.md.
 */

/** A failure the device endpoint must translate into an RFC 8628 `error` code. */
export class DeviceFlowError extends Error {
  readonly code: ConnectErrorCode;
  constructor(code: ConnectErrorCode, message: string) {
    super(message);
    this.name = "DeviceFlowError";
    this.code = code;
  }
}

const encoder = new TextEncoder();

/** Hex SHA-256 of a secret. Pairing codes and opaque tokens are stored hashed. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 8 characters from an unambiguous alphabet. */
export function generateUserCode(): string {
  let code = "";
  for (let index = 0; index < USER_CODE_LENGTH; index += 1) {
    const byte = randomBytes(1)[0] ?? 0;
    code += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
  }
  return code;
}

/** `ABCD1234` → `ABCD-1234` for display and typing. */
export function formatUserCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/** 32 random bytes, base64url — the device code and refresh token shape. */
export function generateOpaqueToken(): string {
  return base64Url(randomBytes(32));
}

function nowIso(): string {
  return new Date().toISOString();
}

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function createId(): string {
  return crypto.randomUUID();
}

/** Device authorizations need no signed-in user; the browser approval binds one. */
export type CreateDeviceAuthorizationInput = {
  clientName: string;
  clientType: AppClientType;
  scopes?: readonly MemosPatScope[] | null;
};

export type CreateDeviceAuthorizationResult = {
  id: string;
  userCode: string;
  deviceCode: string;
  expiresAt: string;
  intervalSeconds: number;
  scopes: MemosPatScope[];
};

async function findOrCreateClient(
  db: FlareMoDb,
  input: { clientName: string; clientType: AppClientType },
): Promise<string> {
  const [existing] = await db
    .select({ id: appClients.id })
    .from(appClients)
    .where(
      and(
        eq(appClients.name, input.clientName),
        eq(appClients.clientType, input.clientType),
      ),
    )
    .limit(1);
  if (existing !== undefined) {
    await db
      .update(appClients)
      .set({ lastSeenAt: nowIso() })
      .where(eq(appClients.id, existing.id));
    return existing.id;
  }
  const rows = await db.select({ id: appClients.id }).from(appClients);
  if (rows.length >= MAX_APP_CLIENTS) {
    throw new ValidationError(
      `This instance already has ${MAX_APP_CLIENTS} registered apps. Remove one before connecting another.`,
    );
  }
  const id = createId();
  await db.insert(appClients).values({
    id,
    name: input.clientName,
    clientType: input.clientType,
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
  });
  return id;
}

/** Start a device authorization and return the codes the client needs. */
export async function createDeviceAuthorization(
  db: FlareMoDb,
  input: CreateDeviceAuthorizationInput,
): Promise<CreateDeviceAuthorizationResult> {
  const name = input.clientName.trim().slice(0, 80);
  if (!name) throw new ValidationError("client_name is required.");
  const clientId = await findOrCreateClient(db, {
    clientName: name,
    clientType: input.clientType,
  });
  const scopes = normalizeMemosPatScopes(input.scopes);

  let userCode = generateUserCode();
  let userIdHash = await sha256Hex(userCode);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const taken = await db
      .select({ id: deviceAuthorizations.id })
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.userCodeHash, userIdHash))
      .limit(1);
    if (taken.length === 0) break;
    userCode = generateUserCode();
    userIdHash = await sha256Hex(userCode);
  }

  const deviceCode = generateOpaqueToken();
  const expiresAt = new Date(
    Date.now() + DEVICE_CODE_TTL_SECONDS * 1000,
  ).toISOString();
  await db.insert(deviceAuthorizations).values({
    id: createId(),
    clientId,
    authUserId: null,
    userCodeHash: userIdHash,
    deviceCodeHash: await sha256Hex(deviceCode),
    scopes: JSON.stringify(scopes),
    status: "pending",
    expiresAt,
    createdAt: nowIso(),
  });
  return {
    id: clientId,
    userCode,
    deviceCode,
    expiresAt,
    intervalSeconds: DEVICE_POLL_INTERVAL_SECONDS,
    scopes,
  };
}

function parseScopes(raw: string): MemosPatScope[] {
  try {
    const value = JSON.parse(raw);
    return normalizeMemosPatScopes(Array.isArray(value) ? value : []);
  } catch {
    return ["notes"];
  }
}

export type ApproveDeviceAuthorizationResult = {
  clientName: string;
  scopes: MemosPatScope[];
};

/** Bind a signed-in user to a pending pairing code. */
export async function approveDeviceAuthorization(
  db: FlareMoDb,
  input: {
    userCode: string;
    authUserId: string;
    scopes?: readonly MemosPatScope[] | null;
  },
): Promise<ApproveDeviceAuthorizationResult> {
  const normalized = normalizeUserCode(input.userCode);
  if (normalized.length !== USER_CODE_LENGTH) {
    throw new ValidationError("The pairing code is not complete.");
  }
  const rows = await db
    .select()
    .from(deviceAuthorizations)
    .where(eq(deviceAuthorizations.userCodeHash, await sha256Hex(normalized)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("That pairing code does not exist.");
  if (row.status === "redeemed") {
    throw new ValidationError("That pairing code was already used.");
  }
  if (row.status === "expired" || row.expiresAt <= nowIso()) {
    throw new ValidationError("That pairing code has expired.");
  }
  const scopes = normalizeMemosPatScopes(
    input.scopes && input.scopes.length > 0
      ? input.scopes
      : parseScopes(row.scopes),
  );
  await db
    .update(deviceAuthorizations)
    .set({
      authUserId: input.authUserId,
      scopes: JSON.stringify(scopes),
      status: "approved",
      approvedAt: nowIso(),
    })
    .where(eq(deviceAuthorizations.id, row.id));

  const [client] = await db
    .select({ name: appClients.name })
    .from(appClients)
    .where(eq(appClients.id, row.clientId))
    .limit(1);
  return { clientName: client?.name ?? "Unknown app", scopes };
}

export type RedeemDeviceAuthorizationResult = {
  authorizationId: string;
  clientId: string;
  clientName: string;
  authUserId: string;
  scopes: MemosPatScope[];
};

/** Claim an approved device authorization exactly once. */
export async function redeemDeviceAuthorization(
  db: FlareMoDb,
  deviceCode: string,
): Promise<RedeemDeviceAuthorizationResult> {
  const rows = await db
    .select()
    .from(deviceAuthorizations)
    .where(eq(deviceAuthorizations.deviceCodeHash, await sha256Hex(deviceCode)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new DeviceFlowError("invalid_grant", "Unknown device code.");
  }
  if (row.status === "redeemed") {
    throw new DeviceFlowError("invalid_grant", "This device code was used.");
  }
  if (row.status === "expired" || row.expiresAt <= nowIso()) {
    throw new DeviceFlowError("expired_token", "This device code expired.");
  }
  if (row.status !== "approved" || row.authUserId === null) {
    throw new DeviceFlowError(
      "authorization_pending",
      "The user has not approved this device yet.",
    );
  }
  await db
    .update(deviceAuthorizations)
    .set({ status: "redeemed", redeemedAt: nowIso() })
    .where(eq(deviceAuthorizations.id, row.id));
  const [client] = await db
    .select({ name: appClients.name })
    .from(appClients)
    .where(eq(appClients.id, row.clientId))
    .limit(1);
  return {
    authorizationId: row.id,
    clientId: row.clientId,
    clientName: client?.name ?? "Unknown app",
    authUserId: row.authUserId,
    scopes: parseScopes(row.scopes),
  };
}

/** Store a refresh token (plaintext stays only in the response). */
export async function createRefreshToken(
  db: FlareMoDb,
  input: {
    clientId: string;
    authUserId: string;
    accessKeyId: string | null;
    scopes: readonly MemosPatScope[];
  },
): Promise<{ token: string; id: string }> {
  const token = generateOpaqueToken();
  const id = createId();
  await db.insert(deviceRefreshTokens).values({
    id,
    clientId: input.clientId,
    authUserId: input.authUserId,
    tokenHash: await sha256Hex(token),
    accessKeyId: input.accessKeyId,
    scopes: JSON.stringify(input.scopes),
    expiresAt: addDaysIso(REFRESH_TOKEN_TTL_DAYS),
    createdAt: nowIso(),
  });
  return { token, id };
}

export type ValidatedRefreshToken = {
  id: string;
  clientId: string;
  authUserId: string;
  accessKeyId: string | null;
  scopes: MemosPatScope[];
};

/** Validate a refresh token; the caller mints the new access token. */
export async function validateRefreshToken(
  db: FlareMoDb,
  refreshToken: string,
): Promise<ValidatedRefreshToken> {
  const rows = await db
    .select()
    .from(deviceRefreshTokens)
    .where(eq(deviceRefreshTokens.tokenHash, await sha256Hex(refreshToken)))
    .limit(1);
  const row = rows[0];
  if (!row || row.revokedAt !== null) {
    throw new DeviceFlowError("invalid_grant", "Unknown refresh token.");
  }
  if (row.expiresAt <= nowIso()) {
    throw new DeviceFlowError("expired_token", "The refresh token expired.");
  }
  await db
    .update(deviceRefreshTokens)
    .set({ lastUsedAt: nowIso() })
    .where(eq(deviceRefreshTokens.id, row.id));
  return {
    id: row.id,
    clientId: row.clientId,
    authUserId: row.authUserId,
    accessKeyId: row.accessKeyId,
    scopes: parseScopes(row.scopes),
  };
}

/** Point a refresh token at the access token it most recently minted. */
export async function attachAccessKey(
  db: FlareMoDb,
  input: { refreshTokenId: string; accessKeyId: string },
): Promise<void> {
  await db
    .update(deviceRefreshTokens)
    .set({ accessKeyId: input.accessKeyId })
    .where(eq(deviceRefreshTokens.id, input.refreshTokenId));
}

/** Revoke every refresh token bound to an access token (used on reuse or removal). */
export async function revokeRefreshTokensForAccessKey(
  db: FlareMoDb,
  accessKeyId: string,
): Promise<void> {
  await db
    .update(deviceRefreshTokens)
    .set({ revokedAt: nowIso() })
    .where(
      and(
        eq(deviceRefreshTokens.accessKeyId, accessKeyId),
        isNull(deviceRefreshTokens.revokedAt),
      ),
    );
}

/** The auth-api-key row backing one connected app, scoped to its owner. */
export async function getConnectedAppKey(
  db: FlareMoDb,
  input: { authUserId: string; keyId: string; patConfigId: string },
) {
  const rows = await db
    .select()
    .from(authApiKeys)
    .where(
      and(
        eq(authApiKeys.id, input.keyId),
        eq(authApiKeys.referenceId, input.authUserId),
        eq(authApiKeys.configId, input.patConfigId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function isoFromMs(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Rows for the "connected apps" settings page. */
export async function listConnectedApps(
  db: FlareMoDb,
  input: { authUserId: string; patConfigId: string },
): Promise<ConnectedAppDto[]> {
  const keys = await db
    .select()
    .from(authApiKeys)
    .where(
      and(
        eq(authApiKeys.referenceId, input.authUserId),
        eq(authApiKeys.configId, input.patConfigId),
      ),
    )
    .orderBy(desc(authApiKeys.createdAt));

  // Map access key → device client (so non-device PATs show as manual).
  const deviceRows = await db
    .select({
      accessKeyId: deviceRefreshTokens.accessKeyId,
      clientName: appClients.name,
      clientType: appClients.clientType,
    })
    .from(deviceRefreshTokens)
    .innerJoin(appClients, eq(deviceRefreshTokens.clientId, appClients.id))
    .where(
      and(
        eq(deviceRefreshTokens.authUserId, input.authUserId),
        isNotNull(deviceRefreshTokens.accessKeyId),
      ),
    )
    .orderBy(asc(deviceRefreshTokens.createdAt));
  const clientByKey = new Map<
    string,
    { name: string; clientType: AppClientType }
  >();
  for (const row of deviceRows) {
    if (row.accessKeyId !== null && !clientByKey.has(row.accessKeyId)) {
      clientByKey.set(row.accessKeyId, {
        name: row.clientName,
        clientType: row.clientType as AppClientType,
      });
    }
  }

  const now = nowIso();
  // Only third-party clients appear here: manual PATs already have their own
  // token list, and a revoked key must disappear instead of lingering as
  // "expired" (the auth row stays for audit but is disabled).
  const rows: ConnectedAppDto[] = [];
  for (const key of keys) {
    const client = clientByKey.get(key.id);
    if (client === undefined || !key.enabled) continue;
    const expired = key.expiresAt !== null && key.expiresAt.toISOString() <= now;
    rows.push({
      id: key.id,
      name: client.name,
      clientType: client.clientType,
      scopes: memosPatScopesFromPermissions(key.permissions) ?? ["notes"],
      createdAt: key.createdAt.toISOString(),
      lastUsedAt: isoFromMs(key.lastRequest),
      expiresAt: isoFromMs(key.expiresAt),
      status: expired ? "expired" : "active",
    });
  }
  return rows;
}

/** Delete expired device authorizations and dead refresh tokens. */
export async function cleanupExpiredDeviceData(db: FlareMoDb): Promise<{
  authorizations: number;
  refreshTokens: number;
}> {
  const now = nowIso();
  const staleAuthorizations = await db
    .delete(deviceAuthorizations)
    .where(lt(deviceAuthorizations.expiresAt, now))
    .returning({ id: deviceAuthorizations.id });
  const deadRefresh = await db
    .delete(deviceRefreshTokens)
    .where(
      or(
        lt(deviceRefreshTokens.expiresAt, now),
        isNotNull(deviceRefreshTokens.revokedAt),
      ),
    )
    .returning({ id: deviceRefreshTokens.id });
  return {
    authorizations: staleAuthorizations.length,
    refreshTokens: deadRefresh.length,
  };
}

/** Display name of a registered client, for token labels. */
export async function getAppClientName(
  db: FlareMoDb,
  clientId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ name: appClients.name })
    .from(appClients)
    .where(eq(appClients.id, clientId))
    .limit(1);
  return row?.name ?? null;
}
