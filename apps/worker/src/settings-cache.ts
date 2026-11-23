import type { FlareMoDb } from "@flaremo/db";
import { getBranding, getPluginSettings } from "@flaremo/domain";

/**
 * Instance-level settings that every anonymous request reads.
 *
 * `getBranding` costs two D1 round trips (owner row + setting row) and
 * `getPluginSettings` the same, yet both answer identically for every request
 * in the isolate: the public branding endpoint, the SSR share/article pages,
 * and — worst of all — every single plugin asset file. A plugin card can make
 * twenty of those requests in one page load.
 *
 * Entries live per D1 instance (same WeakMap keying as identity-cache so a
 * test harness with two databases never shares a value) and expire on a short
 * TTL. Every write path that mutates these settings calls the matching
 * invalidator, so an operator's change is visible on the next request rather
 * than up to a TTL later.
 */
const SETTINGS_CACHE_TTL_MS = 30_000;

type Entry<T> = { value: T; expiresAt: number };

function readThrough<T>(
  cache: WeakMap<FlareMoDb, Entry<T>>,
  db: FlareMoDb,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(db);
  if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);
  return load().then((value) => {
    cache.set(db, { value, expiresAt: now + SETTINGS_CACHE_TTL_MS });
    return value;
  });
}

const brandingCache = new WeakMap<
  FlareMoDb,
  Entry<Awaited<ReturnType<typeof getBranding>>>
>();

export function getBrandingCached(
  db: FlareMoDb,
): ReturnType<typeof getBranding> {
  return readThrough(brandingCache, db, () => getBranding(db));
}

export function invalidateBrandingCache(db: FlareMoDb): void {
  brandingCache.delete(db);
}

const pluginSettingsCache = new WeakMap<
  FlareMoDb,
  Entry<Awaited<ReturnType<typeof getPluginSettings>>>
>();

export function getPluginSettingsCached(
  db: FlareMoDb,
): ReturnType<typeof getPluginSettings> {
  return readThrough(pluginSettingsCache, db, () => getPluginSettings(db));
}

export function invalidatePluginSettingsCache(db: FlareMoDb): void {
  pluginSettingsCache.delete(db);
}
