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

  await db.insert(users).values(row);
  return row;
}
