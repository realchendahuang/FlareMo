import type { createDb, UserRow } from "@flaremo/db";
import {
  ConflictError,
  ForbiddenError,
  getAuthBootstrapStatus,
  type getMemoById,
  getMemoByIdForViewer,
  getMemosByIdsForViewer,
  getUserRegistrationAllowed,
  isInstanceOwner,
  listMemoAttachmentsForViewer,
  listMemoRelationsForViewer,
  NotFoundError,
  UnauthorizedError,
  type updateMemo,
} from "@flaremo/domain";
import { currentMemoToDto, currentUserToDto } from "@flaremo/memos";
import type { z } from "zod";
import {
  getFlareMoAuth,
  getFlareMoDb,
  type getOptionalRequestContext,
  type getRequestContext,
  loadAuthFactory,
} from "../../context";
import { getAuthUserCached } from "../../identity-cache";
import { base64ToUint8Array } from "../../memos-compat/base64";
import { splitBearerToken } from "../../memos-compat/credential";
import { CompatValidationError, isRecord } from "../../memos-compat/errors";
import { resolveMemoCreator } from "../../memos-compat/memo-creator";
import { memoRelationsToDtos } from "../../memos-compat/memo-relations";
import {
  compatMemoVisibility,
  parseMemosOrderBy,
  parseMemosPageSize,
  parseMemosState,
  splitUpdateMaskFields,
} from "../../memos-compat/parsing";
import { compatMemoPayload } from "../../memos-compat/payload";
import {
  clearMemosRefreshCookie,
  type MemosNativeRefreshResult,
} from "../../memos-native-auth";
import type {
  currentAttachmentBodySchema,
  currentAttachmentPatchBodySchema,
  currentMemoBodySchema,
  currentShareBodySchema,
} from "./schemas";

export async function currentMemoWithDetails(
  context: Awaited<ReturnType<typeof getOptionalRequestContext>>,
  memo: Awaited<ReturnType<typeof getMemoById>>,
) {
  const [attachments, relations] = await Promise.all([
    listMemoAttachmentsForViewer(context.db, context.user, memo.id),
    currentRelations(context, memo.id),
  ]);
  return currentMemoToDto(memo, await resolveMemoCreator(context, memo), {
    attachments,
    relations,
  });
}

export async function currentRelations(
  context: Awaited<ReturnType<typeof getOptionalRequestContext>>,
  memoId: string,
) {
  await getMemoByIdForViewer(context.db, context.user, memoId, {
    includeDeleted: true,
  });
  const rows = await listMemoRelationsForViewer(
    context.db,
    context.user,
    memoId,
  );
  if (rows.length === 0) return [];
  // Fetch both endpoints of every relation in one scoped read. Passing the
  // single-id helper here issued two extra round trips per relation — on a
  // memo with 50 comments that is 100 queries to render one detail page.
  const memosById = await getMemosByIdsForViewer(
    context.db,
    context.user,
    [...new Set(rows.flatMap((row) => [row.memoId, row.relatedMemoId]))],
    { includeDeleted: true },
  );
  return memoRelationsToDtos(
    rows,
    async (id) => {
      const memo = memosById.get(id);
      if (!memo) throw new NotFoundError("Memo not found");
      return memo;
    },
    { skipUnavailable: true },
  );
}

export async function currentUserForContext(context: {
  db: ReturnType<typeof createDb>;
  user: UserRow;
  authUserId: string;
}) {
  return currentUserToDto(
    context.user,
    await getAuthUserCached(context.db, context.authUserId),
  );
}

export async function createAuthContext(
  c: Parameters<typeof getRequestContext>[0],
) {
  return { db: getFlareMoDb(c.env), auth: await getFlareMoAuth(c.env) };
}
export function assertSessionCredential(
  context: Awaited<ReturnType<typeof getRequestContext>>,
) {
  // PATs authorize memo data, but a credential-management endpoint must not
  // let a leaked PAT mint or revoke additional PATs. Cookie sessions and the
  // opaque Better Auth session bearer returned by the auth facade are allowed.
  if (context.credential === "pat") throw new UnauthorizedError();
}

export function assertOwnerUser(
  context: Awaited<ReturnType<typeof getRequestContext>>,
) {
  if (context.credential === "pat" || !isInstanceOwner(context.user)) {
    throw new ForbiddenError(
      "An owner session is required for user management",
    );
  }
}

export async function assertRegistrationOpen(
  c: Parameters<typeof getRequestContext>[0],
) {
  const db = getFlareMoDb(c.env);
  const status = await getAuthBootstrapStatus(db);
  if (status.state !== "complete") {
    throw new ConflictError("Registration is not available yet");
  }
  if (!(await getUserRegistrationAllowed(db))) {
    throw new ForbiddenError("User registration is disabled");
  }
}

export function currentListQuery(c: Parameters<typeof getRequestContext>[0]) {
  const rawOrderBy = c.req.query("orderBy") ?? "create_time desc";
  const orderBy = parseMemosOrderBy(rawOrderBy);
  if (!orderBy) {
    throw new CompatValidationError(
      "Only a single create_time, display_time, or update_time order is supported",
    );
  }
  const rawState = c.req.query("state");
  const state = parseMemosState(rawState);
  if (
    rawState &&
    rawState.trim().toUpperCase() !== "STATE_UNSPECIFIED" &&
    !state
  ) {
    throw new CompatValidationError(`Unsupported memo state: ${rawState}`);
  }
  if (state === "trashed" || state === "deleted") {
    throw new CompatValidationError(
      "Current Memos only exposes NORMAL and ARCHIVED list states",
    );
  }
  const filter = parseCurrentFilter(c.req.query("filter"));
  return {
    page_size: parsePageSize(c.req.query("pageSize"), 50, 200),
    page_token: c.req.query("pageToken"),
    order_by: orderBy,
    ...(state ? { state } : {}),
    ...(filter.expression ? { filter: filter.expression } : {}),
    include_deleted: c.req.query("showDeleted") === "true",
  };
}

export function parseCurrentFilter(filter: string | undefined) {
  return filter?.trim() ? { expression: filter.trim() } : {};
}

/**
 * Read the request body for a `schema.parse(...)` call. `c.req.json()`
 * rejects with a bare SyntaxError on malformed JSON, which the error
 * envelope maps to 500; a bad body is a client error, so it is wrapped in
 * the canonical 400 validation error instead.
 */
export async function readCurrentJsonObject(
  c: Parameters<typeof getRequestContext>[0],
) {
  try {
    return await c.req.json();
  } catch {
    throw new CompatValidationError("Request body must be valid JSON");
  }
}

/**
 * Flatten the optional single-nested-resource envelope Memos clients send
 * (`{ memo: {…} }`, `{ memoShare: {…} }`, `{ attachment: {…} }`): the nested
 * object's fields merge over the top-level body, matching the previous
 * per-key copies that differed only in the envelope key.
 */
function unwrapNestedBody<T extends Record<string, unknown>>(
  body: T,
  key: keyof T,
): T {
  const nested = isRecord(body[key]) ? body[key] : undefined;
  return (nested ? { ...body, ...nested } : { ...body }) as T;
}

export function unwrapMemoBody(body: z.infer<typeof currentMemoBodySchema>) {
  return unwrapNestedBody(body, "memo");
}

export function unwrapShareBody(body: z.infer<typeof currentShareBodySchema>) {
  return unwrapNestedBody(body, "memoShare");
}

export function unwrapAttachmentBody(
  body: z.infer<typeof currentAttachmentBodySchema>,
) {
  return unwrapNestedBody(body, "attachment");
}

export function unwrapAttachmentPatchBody(
  body: z.infer<typeof currentAttachmentPatchBodySchema>,
) {
  return unwrapNestedBody(body, "attachment");
}

export function currentUpdateInput(
  body: z.infer<typeof currentMemoBodySchema>,
  updateMask: string[],
) {
  const fields = updateMask.includes("*")
    ? [
        "content",
        "visibility",
        "state",
        "pinned",
        "property",
        "location",
        "tags",
      ]
    : updateMask;
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    if (field === "content") {
      if (body.content === undefined)
        throw new CompatValidationError("content is required by updateMask");
      input.content = body.content;
    } else if (field === "visibility") {
      if (body.visibility === undefined)
        throw new CompatValidationError("visibility is required by updateMask");
      input.visibility = compatMemoVisibility(body.visibility);
    } else if (field === "state") {
      if (body.state === undefined)
        throw new CompatValidationError("state is required by updateMask");
      const state = parseMemosState(body.state);
      if (!state || state === "trashed" || state === "deleted") {
        throw new CompatValidationError(
          "Only NORMAL and ARCHIVED memo states are supported by current Memos",
        );
      }
      input.status = state;
    } else if (field === "pinned") {
      if (body.pinned === undefined)
        throw new CompatValidationError("pinned is required by updateMask");
      input.pinned = body.pinned;
    } else if (
      field === "property" ||
      field === "location" ||
      field === "tags" ||
      field === "payload"
    ) {
      input.payload = compatMemoPayload(body);
    } else {
      throw new CompatValidationError(`Unsupported updateMask field: ${field}`);
    }
  }
  if (Object.keys(input).length === 0)
    throw new CompatValidationError("updateMask is required");
  return input as Parameters<typeof updateMemo>[3];
}

export function parseUpdateMask(value: string | undefined) {
  const fields = splitUpdateMaskFields(value);
  if (fields.length === 0)
    throw new CompatValidationError("updateMask is required");
  return fields;
}

export function parsePageSize(
  value: string | undefined,
  fallback: number,
  maximum = 100,
) {
  if (!value) return fallback;
  const parsed = parseMemosPageSize(value);
  if (parsed === null)
    throw new CompatValidationError("pageSize must be a positive integer");
  return Math.min(parsed, maximum);
}

export function parseBearerToken(value: string) {
  const token = splitBearerToken(value);
  if (token === null) throw new UnauthorizedError();
  return token;
}

export function normalizeUserName(value: string) {
  return value.startsWith("users/") ? value : `users/${value}`;
}

export function assertCurrentUserPath(value: string, currentUserId: string) {
  const expected = currentUserId.replace(/^users\//, "");
  const normalized = value.startsWith("users/")
    ? value.replace(/^users\//, "")
    : value;
  if (normalized !== expected)
    throw new ForbiddenError("Only the current user is available");
}

export function decodeBase64(value: string) {
  try {
    return base64ToUint8Array(value);
  } catch {
    throw new CompatValidationError("Attachment content must be valid base64");
  }
}

export function currentRequiredString(
  value: string | undefined,
  field: string,
) {
  if (!value?.trim()) {
    throw new CompatValidationError(`${field} is required`);
  }
  return value.trim();
}

export function copyHeaders(target: Headers, source: Headers) {
  source.forEach((value, key) => {
    target.append(key, value);
  });
}

export function noStoreResponse(response: Response) {
  response.headers.set("cache-control", "no-store");
  return response;
}

export function nativeRefreshResponse(
  c: Parameters<typeof getRequestContext>[0],
  result: MemosNativeRefreshResult,
) {
  const response = noStoreResponse(
    c.json({
      accessToken: result.accessToken,
      expiresAt: result.accessTokenExpiresAt.toISOString(),
    }),
  );
  response.headers.append("set-cookie", result.refreshCookie);
  return response;
}

export function appendMemosRefreshClearCookie(
  response: Response,
  request: Request,
) {
  response.headers.append("set-cookie", clearMemosRefreshCookie(request));
  return response;
}

export async function signOutCookieSession(
  c: Parameters<typeof getRequestContext>[0],
  db: ReturnType<typeof createDb>,
): Promise<Response> {
  const headers = new Headers(c.req.raw.headers);
  headers.delete("authorization");
  const request = new Request(new URL("/api/auth/sign-out", c.req.url), {
    method: "POST",
    headers,
  });
  const { createFlareMoAuth } = await loadAuthFactory();
  return await createFlareMoAuth(c.env, db).handler(request);
}

/**
 * The default `/api/v1` representation is the current Memos protobuf-JSON
 * shape. The previous FlareMo snake_case surface remains available by sending
 * `X-FlareMo-Wire: legacy` (or the matching vendor Accept value); the route
 * then falls through to the original handler mounted after this app.
 */
export function isLegacyWireRequest(c: {
  req: { header(name: string): string | undefined };
}) {
  return (
    c.req.header("x-flaremo-wire")?.toLowerCase() === "legacy" ||
    c.req
      .header("accept")
      ?.toLowerCase()
      .includes("application/vnd.flaremo.legacy+json") === true
  );
}

export { isRecord };
