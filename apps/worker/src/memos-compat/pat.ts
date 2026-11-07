/**
 * Personal-access-token creation and DTO shared by the account API and the
 * current REST / Connect Memos compatibility surfaces. Every new token must go
 * through `createMemosPersonalAccessToken`: the compatibility schemas predate
 * scopes and expiry, but that is no reason to mint another permanent token with
 * legacy full access.
 */
import {
  DEFAULT_MEMOS_PAT_EXPIRES_IN_DAYS,
  DEFAULT_MEMOS_PAT_SCOPE,
  MAX_MEMOS_PAT_EXPIRES_IN_DAYS,
  type MemosPatScope,
  memosPatPermissionsFor,
} from "@flaremo/contracts";
import { ValidationError } from "@flaremo/domain";
import { type FlareMoAuth, MEMOS_PAT_CONFIG_ID } from "../auth-env";

export type PersonalAccessTokenLike = {
  id: string;
  name: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  lastRequest: Date | null;
};

export function personalAccessTokenToDto(
  token: PersonalAccessTokenLike,
  userId: string,
) {
  return {
    name: `${userId}/personalAccessTokens/${token.id}`,
    ...(token.name ? { description: token.name } : {}),
    createdAt: token.createdAt.toISOString(),
    ...(token.expiresAt ? { expiresAt: token.expiresAt.toISOString() } : {}),
    ...(token.lastRequest
      ? { lastUsedAt: token.lastRequest.toISOString() }
      : {}),
  };
}

const DEFAULT_PAT_NAME = "Memos API token";

/**
 * Compatibility clients still send `expiresInDays: 0` (or omit the field) to
 * mean "no explicit choice". That used to mint a permanent token; it now maps
 * to the same 90-day default as the account UI. Explicit limits are validated
 * here as well, so a future route cannot bypass the 1..365 day policy.
 */
export function normalizeMemosPatExpiresInDays(
  value: number | null | undefined,
): number {
  if (value === undefined || value === null || value === 0) {
    return DEFAULT_MEMOS_PAT_EXPIRES_IN_DAYS;
  }
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_MEMOS_PAT_EXPIRES_IN_DAYS
  ) {
    throw new ValidationError(
      `Personal access token lifetime must be between 1 and ${MAX_MEMOS_PAT_EXPIRES_IN_DAYS} days.`,
    );
  }
  return value;
}

/** Default to notes; an admin request always remains an additive superset. */
export function normalizeMemosPatScopes(
  scopes: readonly MemosPatScope[] | null | undefined,
): MemosPatScope[] {
  const selected = [...new Set(scopes ?? [])];
  if (selected.length === 0) return [DEFAULT_MEMOS_PAT_SCOPE];
  if (selected.includes("admin") && !selected.includes("notes")) {
    return ["notes", "admin"];
  }
  return selected;
}

export type CreateMemosPersonalAccessTokenInput = {
  userId: string;
  name?: string | null;
  expiresInDays?: number | null;
  scopes?: readonly MemosPatScope[] | null;
};

/**
 * The only allowed way to mint a new PAT. It deliberately owns all three security
 * inputs (permissions, lifetime, stored config id) so a compatibility route can
 * supply no client-side scope/expiry and still get the safe server default.
 */
export async function createMemosPersonalAccessToken(
  auth: FlareMoAuth,
  input: CreateMemosPersonalAccessTokenInput,
) {
  const expiresInDays = normalizeMemosPatExpiresInDays(input.expiresInDays);
  const scopes = normalizeMemosPatScopes(input.scopes);
  return auth.api.createApiKey({
    body: {
      configId: MEMOS_PAT_CONFIG_ID,
      userId: input.userId,
      name: input.name?.trim() || DEFAULT_PAT_NAME,
      expiresIn: expiresInDays * 24 * 60 * 60,
      permissions: memosPatPermissionsFor(scopes),
    },
  });
}
