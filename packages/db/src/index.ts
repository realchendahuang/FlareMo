import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export * from "./schema";
export * from "./test-migrations";

export function createDb(database: D1Database) {
  return drizzle(database, { schema });
}

export type FlareMoDb = ReturnType<typeof createDb>;
