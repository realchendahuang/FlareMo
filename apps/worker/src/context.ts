import { createDb } from "@flaremo/db";
import { ensureSingleUser } from "@flaremo/domain";
import type { Context } from "hono";

export type HonoBindings = {
  Bindings: Env;
};

export async function getRequestContext(c: Context<HonoBindings>) {
  const db = createDb(c.env.DB);
  const user = await ensureSingleUser(db, {
    email: c.env.FLAREMO_SINGLE_USER_EMAIL,
    name: c.env.FLAREMO_SINGLE_USER_NAME,
  });

  return { db, user };
}

export type ReturnTypeOfRequestContext = Awaited<
  ReturnType<typeof getRequestContext>
>;
