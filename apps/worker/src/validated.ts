import { zValidator as honoZValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { ZodError } from "zod";

type ZValidator = typeof honoZValidator;
type Target = Parameters<ZValidator>[0];
type Schema = Parameters<ZValidator>[1];
type Hook = NonNullable<Parameters<ZValidator>[2]>;

/**
 * The package default answers `{ success: false, error: ZodError }`. The web
 * client reads `error.message`, so users saw the raw issue JSON in a toast.
 * Every route here imports this wrapper instead, which keeps the same
 * `{ error: { message } }` envelope as `jsonError`.
 */
const defaultHook = ((
  result: { success: boolean; error?: ZodError },
  c: Context,
) => {
  if (result.success) return;
  const issue = result.error?.issues[0];
  const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
  return c.json(
    { error: { message: `${path}${issue?.message ?? "Invalid request"}` } },
    400,
  );
}) as unknown as Hook;

export const zValidator = ((target: Target, schema: Schema, hook?: Hook) =>
  honoZValidator(
    target as never,
    schema as never,
    hook ?? defaultHook,
  )) as ZValidator;
