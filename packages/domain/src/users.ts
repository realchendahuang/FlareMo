import type { FlareMoDb, UserRow } from "@flaremo/db";
import { users } from "@flaremo/db";
import { eq } from "drizzle-orm";

export type SingleUserConfig = {
  email: string;
  name: string;
};

export async function ensureSingleUser(
  db: FlareMoDb,
  config: SingleUserConfig,
): Promise<UserRow> {
  const id = "users/owner";
  const now = new Date().toISOString();
  const existing = await db.query.users.findFirst({
    where: eq(users.id, id),
  });

  if (existing) {
    return existing;
  }

  const row = {
    id,
    email: config.email,
    name: config.name,
    avatarUrl: null,
    role: "owner" as const,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(users).values(row).onConflictDoNothing({ target: users.id });
  return (await db.query.users.findFirst({ where: eq(users.id, id) })) ?? row;
}

export async function getFlaremoUserById(
  db: FlareMoDb,
  id: string,
): Promise<UserRow | null> {
  return (await db.query.users.findFirst({ where: eq(users.id, id) })) ?? null;
}

export async function updateFlaremoUserProfile(
  db: FlareMoDb,
  user: UserRow,
  input: { name?: string; avatarUrl?: string | null },
) {
  const nextName = input.name?.trim();
  if (nextName === "") throw new Error("Display name cannot be empty");
  await db
    .update(users)
    .set({
      ...(nextName !== undefined ? { name: nextName } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, user.id));
  return (
    (await db.query.users.findFirst({ where: eq(users.id, user.id) })) ?? user
  );
}
