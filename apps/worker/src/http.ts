import { DomainError } from "@flaremo/domain";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { HonoBindings } from "./context";

export function jsonError(c: Context<HonoBindings>, error: unknown) {
  if (error instanceof DomainError) {
    return c.json(
      { error: { message: error.message } },
      toContentfulStatus(error.status),
    );
  }

  console.error(
    JSON.stringify({
      level: "error",
      message: "Unhandled request error",
      error: serializeError(error),
    }),
  );
  return c.json({ error: { message: "Internal server error" } }, 500);
}

function toContentfulStatus(status: number): ContentfulStatusCode {
  if (status >= 200 && status < 300) {
    return 400;
  }
  if (status === 101 || status === 204 || status === 205 || status === 304) {
    return 500;
  }
  if (status >= 100 && status <= 599) {
    return status as ContentfulStatusCode;
  }
  return 500;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { value: String(error) };
}
