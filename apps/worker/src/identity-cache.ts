import type { FlareMoDb } from "@flaremo/db";
import { getAuthUserById, getFlaremoUserById } from "@flaremo/domain";

/**
 * Auth-identity rows (Better Auth users, email/username) and FlareMo user
 * rows (name, display) change rarely, and several request handlers re-read
 * the same row within a request — e.g. a Connect session resolves viewer and
 * creator identity repeatedly across RPCs. Cache both per D1 instance for a
 * short TTL using the same WeakMap pattern as the identity-links cache in
 * memos-native-auth.ts. Authorization-critical rows (the viewer's FlareMo
 * user for membership checks) intentionally stay on live reads so member
 * removal keeps failing fast.
 */
const AUTH_IDENTITY_CACHE_TTL_MS = 30_000;

type IdentityEntry<T> = { value: T; expiresAt: number };

function cachedLookup<T>(
  cache: WeakMap<FlareMoDb, Map<string, IdentityEntry<T>>>,
  key: string,
  db: FlareMoDb,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const live = cache.get(db) ?? new Map<string, IdentityEntry<T>>();
  const cached = live.get(key);
  if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);
  return load().then((value) => {
    live.set(key, { value, expiresAt: now + AUTH_IDENTITY_CACHE_TTL_MS });
    cache.set(db, live);
    return value;
  });
}

const authUserCache = new WeakMap<
  FlareMoDb,
  Map<string, IdentityEntry<Awaited<ReturnType<typeof getAuthUserById>>>>
>();

export function getAuthUserCached(
  db: FlareMoDb,
  authUserId: string,
): ReturnType<typeof getAuthUserById> {
  return cachedLookup(authUserCache, authUserId, db, () =>
    getAuthUserById(db, authUserId),
  );
}

const flaremoUserCache = new WeakMap<
  FlareMoDb,
  Map<string, IdentityEntry<Awaited<ReturnType<typeof getFlaremoUserById>>>>
>();

export function getFlaremoUserCached(
  db: FlareMoDb,
  userId: string,
): ReturnType<typeof getFlaremoUserById> {
  return cachedLookup(flaremoUserCache, userId, db, () =>
    getFlaremoUserById(db, userId),
  );
}
