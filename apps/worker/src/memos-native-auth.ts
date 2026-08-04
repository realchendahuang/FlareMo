import {
  authSessions,
  authUserLinks,
  type FlareMoDb,
  type UserRow,
} from "@flaremo/db";
import { getAuthUserById, getFlaremoUserByAuthUserId } from "@flaremo/domain";
import { and, eq, gt } from "drizzle-orm";
import { getBetterAuthSecret } from "./auth";
import type { FlareMoEnv } from "./env";

export const MEMOS_ISSUER = "memos";
export const MEMOS_JWT_KEY_ID = "v1";
export const MEMOS_ACCESS_AUDIENCE = "user.access-token";
export const MEMOS_REFRESH_AUDIENCE = "user.refresh-token";
export const MEMOS_ACCESS_TOKEN_DURATION_SECONDS = 15 * 60;
export const MEMOS_REFRESH_TOKEN_DURATION_SECONDS = 30 * 24 * 60 * 60;
export const MEMOS_REFRESH_COOKIE_NAME = "memos_refresh";

const MEMOS_REFRESH_SESSION_PREFIX = "memos-refresh:";
const MAX_INT32 = 2_147_483_647;
const OWNER_SUBJECT = 1;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type MemosAccessClaims = {
  type: "access";
  role: string;
  status: string;
  username: string;
  issuer: typeof MEMOS_ISSUER;
  audience: typeof MEMOS_ACCESS_AUDIENCE;
  subject: number;
  issuedAt: number;
  expiresAt: number;
};

export type MemosRefreshClaims = {
  type: "refresh";
  tokenId: string;
  issuer: typeof MEMOS_ISSUER;
  audience: typeof MEMOS_REFRESH_AUDIENCE;
  subject: number;
  issuedAt: number;
  expiresAt: number;
};

export type MemosNativeIdentity = {
  authUserId: string;
  flaremoUserId: string;
  user: UserRow;
  authUser: NonNullable<Awaited<ReturnType<typeof getAuthUserById>>>;
  subject: number;
};

export type MemosNativeAccessIdentity = MemosNativeIdentity & {
  claims: MemosAccessClaims;
};

export type MemosNativeTokenPair = {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  refreshCookie: string;
  subject: number;
};

export type MemosNativeRefreshResult = {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshCookie: string;
  authUserId: string;
  flaremoUserId: string;
  subject: number;
};

export class MemosNativeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemosNativeAuthError";
  }
}

/**
 * Memos resources use int32 user ids in JWT subjects while FlareMo keeps
 * stable string resource ids. The owner is deliberately pinned to subject 1,
 * matching the first-user convention in Memos. Numeric future resource ids
 * remain stable, and non-numeric ids use a deterministic 31-bit FNV-1a value.
 * Subject resolution rejects an ambiguous collision instead of guessing.
 */
export function memosSubjectForFlaremoUserId(flaremoUserId: string): number {
  if (flaremoUserId === "users/owner") return OWNER_SUBJECT;

  const numericId = /^users\/([1-9][0-9]*)$/.exec(flaremoUserId)?.[1];
  if (numericId) {
    const parsed = Number(numericId);
    if (Number.isSafeInteger(parsed) && parsed <= MAX_INT32) return parsed;
  }

  let hash = 0x811c9dc5;
  for (const byte of textEncoder.encode(flaremoUserId)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  const subject = hash & MAX_INT32;
  return subject > OWNER_SUBJECT ? subject : OWNER_SUBJECT + 1;
}

export function getMemosRefreshToken(headers: Headers): string | null {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== MEMOS_REFRESH_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

/**
 * Issue the native Memos access/refresh pair after Better Auth has already
 * authenticated the password. The refresh record intentionally lives in the
 * existing Better Auth session table: it is scoped to the Better Auth user,
 * expires through the same D1 source of truth, and can be revoked without a
 * second account or token database.
 */
export async function issueMemosNativeTokens(input: {
  db: FlareMoDb;
  env: FlareMoEnv;
  authUserId: string;
  user: UserRow;
  request: Request;
}): Promise<MemosNativeTokenPair> {
  const identity = await resolveMemosIdentityByAuthUserId(
    input.db,
    input.authUserId,
  );
  if (!identity || identity.user.id !== input.user.id) {
    throw new MemosNativeAuthError(
      "The Better Auth identity is not linked to the FlareMo user.",
    );
  }

  const secret = getBetterAuthSecret(input.env);
  const issuedAt = Math.floor(Date.now() / 1_000);
  const accessExpiresAt = new Date(
    (issuedAt + MEMOS_ACCESS_TOKEN_DURATION_SECONDS) * 1_000,
  );
  const refreshExpiresAt = new Date(
    (issuedAt + MEMOS_REFRESH_TOKEN_DURATION_SECONDS) * 1_000,
  );
  const refreshTokenId = crypto.randomUUID();
  const accessToken = await signAccessToken({
    identity,
    issuedAt,
    expiresAt: Math.floor(accessExpiresAt.getTime() / 1_000),
    secret,
  });
  const refreshToken = await signRefreshToken({
    identity,
    tokenId: refreshTokenId,
    issuedAt,
    expiresAt: Math.floor(refreshExpiresAt.getTime() / 1_000),
    secret,
  });

  await insertRefreshSession(input.db, {
    authUserId: identity.authUserId,
    tokenId: refreshTokenId,
    refreshToken,
    expiresAt: refreshExpiresAt,
    request: input.request,
  });

  return {
    accessToken,
    accessTokenExpiresAt: accessExpiresAt,
    refreshTokenExpiresAt: refreshExpiresAt,
    refreshCookie: buildMemosRefreshCookie(
      input.request,
      refreshToken,
      refreshExpiresAt,
    ),
    subject: identity.subject,
  };
}

/**
 * Validate a Memos access JWT and resolve its numeric subject through
 * auth_user_links. Claims are never used as a substitute for the link: the
 * current Better Auth/D1 identity remains the authorization fact source.
 */
export async function authenticateMemosAccessToken(input: {
  db: FlareMoDb;
  env: FlareMoEnv;
  token: string;
}): Promise<MemosNativeAccessIdentity | null> {
  const claims = await parseAccessToken(
    input.token,
    getBetterAuthSecret(input.env),
  );
  if (!claims) return null;

  const identity = await resolveMemosIdentityBySubject(
    input.db,
    claims.subject,
  );
  if (!identity) return null;

  return { ...identity, claims };
}

/**
 * Rotate a refresh token from the HttpOnly memos_refresh cookie. Updating the
 * dedicated auth_sessions row in one D1 statement makes the old token id
 * disappear atomically; a concurrent request that already consumed it gets no
 * second valid rotation result.
 */
export async function rotateMemosRefreshToken(input: {
  db: FlareMoDb;
  env: FlareMoEnv;
  request: Request;
  expectedAuthUserId?: string;
}): Promise<MemosNativeRefreshResult | null> {
  const refreshToken = getMemosRefreshToken(input.request.headers);
  if (!refreshToken) return null;

  const claims = await parseRefreshToken(
    refreshToken,
    getBetterAuthSecret(input.env),
  );
  if (!claims) return null;

  const identity = await resolveMemosIdentityBySubject(
    input.db,
    claims.subject,
  );
  if (!identity) return null;
  if (
    input.expectedAuthUserId &&
    input.expectedAuthUserId !== identity.authUserId
  ) {
    return null;
  }

  const oldSessionId = refreshSessionId(claims.tokenId);
  const now = new Date();
  const existing = await input.db.query.authSessions.findFirst({
    where: and(
      eq(authSessions.id, oldSessionId),
      eq(authSessions.userId, identity.authUserId),
      gt(authSessions.expiresAt, now),
    ),
  });
  if (!existing) return null;

  const secret = getBetterAuthSecret(input.env);
  const issuedAt = Math.floor(Date.now() / 1_000);
  const accessExpiresAt = new Date(
    (issuedAt + MEMOS_ACCESS_TOKEN_DURATION_SECONDS) * 1_000,
  );
  const refreshExpiresAt = new Date(
    (issuedAt + MEMOS_REFRESH_TOKEN_DURATION_SECONDS) * 1_000,
  );
  const newTokenId = crypto.randomUUID();
  const accessToken = await signAccessToken({
    identity,
    issuedAt,
    expiresAt: Math.floor(accessExpiresAt.getTime() / 1_000),
    secret,
  });
  const newRefreshToken = await signRefreshToken({
    identity,
    tokenId: newTokenId,
    issuedAt,
    expiresAt: Math.floor(refreshExpiresAt.getTime() / 1_000),
    secret,
  });

  const updated = await input.db
    .update(authSessions)
    .set({
      id: refreshSessionId(newTokenId),
      token: await hashRefreshToken(newRefreshToken),
      expiresAt: refreshExpiresAt,
      createdAt: new Date(issuedAt * 1_000),
      updatedAt: new Date(),
      ipAddress: readClientIp(input.request),
      userAgent: input.request.headers.get("user-agent"),
    })
    .where(
      and(
        eq(authSessions.id, oldSessionId),
        eq(authSessions.userId, identity.authUserId),
        gt(authSessions.expiresAt, now),
      ),
    )
    .returning({ id: authSessions.id });
  if (updated.length === 0) return null;

  return {
    accessToken,
    accessTokenExpiresAt: accessExpiresAt,
    refreshCookie: buildMemosRefreshCookie(
      input.request,
      newRefreshToken,
      refreshExpiresAt,
    ),
    authUserId: identity.authUserId,
    flaremoUserId: identity.flaremoUserId,
    subject: identity.subject,
  };
}

/**
 * Revoke the refresh record identified by the cookie. Invalid or expired
 * cookies are treated as already revoked so sign-out can still clear the
 * browser cookie without revealing token state.
 */
export async function revokeMemosRefreshToken(input: {
  db: FlareMoDb;
  env: FlareMoEnv;
  headers: Headers;
  expectedAuthUserId?: string;
}): Promise<boolean> {
  const refreshToken = getMemosRefreshToken(input.headers);
  if (!refreshToken) return false;

  const claims = await parseRefreshToken(
    refreshToken,
    getBetterAuthSecret(input.env),
  );
  if (!claims) return false;
  const identity = await resolveMemosIdentityBySubject(
    input.db,
    claims.subject,
  );
  if (!identity) return false;
  if (
    input.expectedAuthUserId &&
    input.expectedAuthUserId !== identity.authUserId
  ) {
    return false;
  }

  const deleted = await input.db
    .delete(authSessions)
    .where(
      and(
        eq(authSessions.id, refreshSessionId(claims.tokenId)),
        eq(authSessions.userId, identity.authUserId),
      ),
    )
    .returning({ id: authSessions.id });
  return deleted.length > 0;
}

export function buildMemosRefreshCookie(
  request: Request,
  refreshToken: string,
  expiresAt: Date | null,
): string {
  const attributes = [
    `${MEMOS_REFRESH_COOKIE_NAME}=${refreshToken}`,
    "Path=/",
    "HttpOnly",
  ];
  if (expiresAt === null) {
    attributes.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  } else {
    attributes.push(`Expires=${expiresAt.toUTCString()}`);
  }
  attributes.push("SameSite=Lax");
  if (isSecureRequest(request)) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearMemosRefreshCookie(request: Request): string {
  return buildMemosRefreshCookie(request, "", null);
}

async function resolveMemosIdentityByAuthUserId(
  db: FlareMoDb,
  authUserId: string,
): Promise<MemosNativeIdentity | null> {
  const user = await getFlaremoUserByAuthUserId(db, authUserId);
  const authUser = await getAuthUserById(db, authUserId);
  if (!user || !authUser) return null;

  return {
    authUserId,
    flaremoUserId: user.id,
    user,
    authUser,
    subject: memosSubjectForFlaremoUserId(user.id),
  };
}

async function resolveMemosIdentityBySubject(
  db: FlareMoDb,
  subject: number,
): Promise<MemosNativeIdentity | null> {
  const links = await db
    .select({
      authUserId: authUserLinks.authUserId,
      flaremoUserId: authUserLinks.flaremoUserId,
    })
    .from(authUserLinks);
  const matches = links.filter(
    (link) => memosSubjectForFlaremoUserId(link.flaremoUserId) === subject,
  );
  if (matches.length !== 1) return null;

  const link = matches[0];
  if (!link) return null;
  return resolveMemosIdentityByAuthUserId(db, link.authUserId);
}

async function insertRefreshSession(
  db: FlareMoDb,
  input: {
    authUserId: string;
    tokenId: string;
    refreshToken: string;
    expiresAt: Date;
    request: Request;
  },
) {
  const now = new Date();
  await db.insert(authSessions).values({
    id: refreshSessionId(input.tokenId),
    expiresAt: input.expiresAt,
    token: await hashRefreshToken(input.refreshToken),
    createdAt: now,
    updatedAt: now,
    ipAddress: readClientIp(input.request),
    userAgent: input.request.headers.get("user-agent"),
    userId: input.authUserId,
  });
}

async function signAccessToken(input: {
  identity: MemosNativeIdentity;
  issuedAt: number;
  expiresAt: number;
  secret: string;
}) {
  return signJwt(
    {
      alg: "HS256",
      kid: MEMOS_JWT_KEY_ID,
      typ: "JWT",
    },
    {
      type: "access",
      role: input.identity.user.role === "owner" ? "ADMIN" : "USER",
      status: "NORMAL",
      username:
        input.identity.authUser.username?.trim() ||
        input.identity.user.id.replace(/^users\//, ""),
      iss: MEMOS_ISSUER,
      sub: String(input.identity.subject),
      aud: [MEMOS_ACCESS_AUDIENCE],
      exp: input.expiresAt,
      iat: input.issuedAt,
    },
    input.secret,
  );
}

async function signRefreshToken(input: {
  identity: MemosNativeIdentity;
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
  secret: string;
}) {
  return signJwt(
    {
      alg: "HS256",
      kid: MEMOS_JWT_KEY_ID,
      typ: "JWT",
    },
    {
      type: "refresh",
      tid: input.tokenId,
      iss: MEMOS_ISSUER,
      sub: String(input.identity.subject),
      aud: [MEMOS_REFRESH_AUDIENCE],
      exp: input.expiresAt,
      iat: input.issuedAt,
    },
    input.secret,
  );
}

async function parseAccessToken(
  token: string,
  secret: string,
): Promise<MemosAccessClaims | null> {
  const parsed = await verifyJwt(token, secret, MEMOS_ACCESS_AUDIENCE);
  if (parsed?.type !== "access") return null;
  if (
    typeof parsed.role !== "string" ||
    typeof parsed.status !== "string" ||
    typeof parsed.username !== "string"
  ) {
    return null;
  }

  const subject = parseMemosSubject(parsed.sub);
  const issuedAt = parseNumericClaim(parsed.iat);
  const expiresAt = parseNumericClaim(parsed.exp);
  if (subject === null || issuedAt === null || expiresAt === null) return null;

  return {
    type: "access",
    role: parsed.role,
    status: parsed.status,
    username: parsed.username,
    issuer: MEMOS_ISSUER,
    audience: MEMOS_ACCESS_AUDIENCE,
    subject,
    issuedAt,
    expiresAt,
  };
}

async function parseRefreshToken(
  token: string,
  secret: string,
): Promise<MemosRefreshClaims | null> {
  const parsed = await verifyJwt(token, secret, MEMOS_REFRESH_AUDIENCE);
  if (parsed?.type !== "refresh" || typeof parsed.tid !== "string") {
    return null;
  }

  const subject = parseMemosSubject(parsed.sub);
  const issuedAt = parseNumericClaim(parsed.iat);
  const expiresAt = parseNumericClaim(parsed.exp);
  if (
    subject === null ||
    issuedAt === null ||
    expiresAt === null ||
    !parsed.tid
  ) {
    return null;
  }

  return {
    type: "refresh",
    tokenId: parsed.tid,
    issuer: MEMOS_ISSUER,
    audience: MEMOS_REFRESH_AUDIENCE,
    subject,
    issuedAt,
    expiresAt,
  };
}

type ParsedJwt = {
  type: string;
  role?: unknown;
  status?: unknown;
  username?: unknown;
  tid?: unknown;
  iss?: unknown;
  sub?: unknown;
  aud?: unknown;
  iat?: unknown;
  exp?: unknown;
};

async function verifyJwt(
  token: string,
  secret: string,
  expectedAudience: string,
): Promise<ParsedJwt | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;

  try {
    const header = parseJsonObject(
      textDecoder.decode(decodeBase64Url(parts[0] ?? "")),
    );
    const payload = parseJsonObject(
      textDecoder.decode(decodeBase64Url(parts[1] ?? "")),
    ) as ParsedJwt;
    if (
      header.alg !== "HS256" ||
      header.kid !== MEMOS_JWT_KEY_ID ||
      header.typ !== "JWT" ||
      payload.iss !== MEMOS_ISSUER ||
      !hasAudience(payload.aud, expectedAudience)
    ) {
      return null;
    }

    const expiresAt = parseNumericClaim(payload.exp);
    if (expiresAt === null || expiresAt <= Math.floor(Date.now() / 1_000)) {
      return null;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(parts[2] ?? ""),
      textEncoder.encode(`${parts[0]}.${parts[1]}`),
    );
    return valid ? payload : null;
  } catch {
    return null;
  }
}

async function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret: string,
) {
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(signingInput),
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("JWT JSON value is not an object");
  }
  return parsed as Record<string, unknown>;
}

function parseNumericClaim(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value)
    ? value
    : null;
}

function parseMemosSubject(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const subject = Number(value);
  return Number.isSafeInteger(subject) && subject <= MAX_INT32 ? subject : null;
}

function hasAudience(value: unknown, expected: string) {
  if (typeof value === "string") return value === expected;
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string") &&
    value.includes(expected)
  );
}

function refreshSessionId(tokenId: string) {
  return `${MEMOS_REFRESH_SESSION_PREFIX}${tokenId}`;
}

async function hashRefreshToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(token),
  );
  return `${MEMOS_REFRESH_SESSION_PREFIX}${encodeHex(new Uint8Array(digest))}`;
}

function encodeHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function encodeBase64Url(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? textEncoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function readClientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")
  );
}

function isSecureRequest(request: Request) {
  try {
    if (new URL(request.url).protocol === "https:") return true;
  } catch {
    // A malformed request URL is not expected inside a Worker; keep the
    // conservative non-Secure cookie behavior for test doubles instead.
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (
    forwardedProto
      ?.split(",")
      .some((value) => value.trim().toLowerCase() === "https")
  ) {
    return true;
  }

  const forwarded = request.headers.get("forwarded")?.toLowerCase();
  return forwarded?.includes("proto=https") === true;
}
