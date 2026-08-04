import type { FlareMoDb, UserRow } from "@flaremo/db";
import { settings } from "@flaremo/db";
import { and, asc, eq } from "drizzle-orm";

export type StoredSetting = {
  key: string;
  value: unknown;
  updatedAt: string;
};

/**
 * Settings are deliberately kept behind a domain boundary.  The table is
 * shared by the single-user runtime and the future multi-user runtime, so
 * callers must always supply the owning FlareMo user instead of reaching into
 * the table from an HTTP adapter.
 */
export async function getStoredSetting(
  db: FlareMoDb,
  user: UserRow,
  key: string,
): Promise<StoredSetting | undefined> {
  const row = await db.query.settings.findFirst({
    where: and(eq(settings.userId, user.id), eq(settings.key, key)),
  });
  return row
    ? { key: row.key, value: row.value, updatedAt: row.updatedAt }
    : undefined;
}

export async function listStoredSettings(
  db: FlareMoDb,
  user: UserRow,
  prefix?: string,
): Promise<StoredSetting[]> {
  const rows = await db
    .select({
      key: settings.key,
      value: settings.value,
      updatedAt: settings.updatedAt,
    })
    .from(settings)
    .where(eq(settings.userId, user.id))
    .orderBy(asc(settings.key));
  return rows
    .filter((row) => !prefix || row.key.startsWith(prefix))
    .map((row) => ({
      key: row.key,
      value: row.value,
      updatedAt: row.updatedAt,
    }));
}

export async function upsertStoredSetting(
  db: FlareMoDb,
  user: UserRow,
  key: string,
  value: unknown,
): Promise<StoredSetting> {
  const updatedAt = new Date().toISOString();
  await db
    .insert(settings)
    .values({ userId: user.id, key, value, updatedAt })
    .onConflictDoUpdate({
      target: [settings.userId, settings.key],
      set: { value, updatedAt },
    });
  return { key, value, updatedAt };
}
