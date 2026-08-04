import type { MemoRow, ReactionRow, ShortcutRow } from "@flaremo/db";
import {
  createMemoComment,
  createShortcut,
  type DomainError,
  deleteMemoReaction,
  deleteShortcut,
  getFlaremoUserById,
  getMemoByIdForViewer,
  getShortcut,
  listMemoAttachmentsForViewer,
  listMemoComments,
  listMemoReactions,
  listMemoRelationsForViewer,
  listShortcuts,
  updateShortcut,
  upsertMemoReaction,
} from "@flaremo/domain";
import {
  currentMemoToDto,
  currentReactionToDto,
  currentRelationToDto,
  currentShortcutToDto,
} from "@flaremo/memos";
import type { Context } from "hono";
import { Hono } from "hono";
import type { HonoBindings } from "../context";
import { getOptionalRequestContext, getRequestContext } from "../context";

/**
 * Mount this app at `/api/v1`, before the legacy Memos app:
 *
 *   app.route("/api/v1", memosSocialApi);
 *
 * The social domain functions deliberately sit behind a small, explicit
 * contract here. The route never imports a table or builds a Drizzle query.
 * The parent implementation in `@flaremo/domain` is expected to provide:
 *
 * - `createMemoComment(db, user, { parentMemoName, content, visibility,
 *   payload, commentId })` -> `MemoRow`;
 * - `listMemoComments(db, user, { memoName, pageSize, pageToken, orderBy })`
 *   -> `{ memos: MemoRow[], nextPageToken? }`;
 * - `listMemoReactions(db, user, { memoName, pageSize, pageToken })` ->
 *   `{ reactions: MemoReactionRow[], nextPageToken? }`;
 * - `upsertMemoReaction(db, user, { memoName, contentId, reactionType })` ->
 *   `MemoReactionRow`;
 * - `deleteMemoReaction(db, user, { name, memoName, reactionId })` -> void;
 * - `listShortcuts(db, user, { parentName })` -> `ShortcutRow[]`;
 * - `getShortcut(db, user, { name })` -> `ShortcutRow`;
 * - `createShortcut(db, user, { parentName, title, filter, validateOnly })` ->
 *   `ShortcutRow`;
 * - `updateShortcut(db, user, { name, title?, filter?, updateMask })` ->
 *   `ShortcutRow`;
 * - `deleteShortcut(db, user, { name })` -> void.
 */

type MemoVisibility = "private" | "protected" | "public";

type PageOptions = {
  pageSize: number;
  pageToken?: string;
};

type MemoCommentPage = {
  memos: MemoRow[];
  nextPageToken?: string;
};

type MemoReactionPage = {
  reactions: ReactionRow[];
  nextPageToken?: string;
};

export const memosSocialApi = new Hono<HonoBindings>();

memosSocialApi.get("/memos/:memo/comments", async (c) => {
  try {
    const context = await getOptionalRequestContext(c);
    const memoName = normalizeMemoName(c.req.param("memo"));
    const page = readPageOptions(c, "create_time desc");
    const result: MemoCommentPage = await listMemoComments(
      context.db,
      context.user,
      {
        memoName,
        pageSize: page.pageSize,
        ...(page.pageToken ? { pageToken: page.pageToken } : {}),
        orderBy: page.orderBy,
      },
    );

    const memos = await Promise.all(
      result.memos.map((memo) => memoToCurrentDto(context, memo, memoName)),
    );

    return c.json({
      memos,
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    });
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosSocialApi.post("/memos/:memo/comments", async (c) => {
  try {
    const context = await getRequestContext(c);
    const memoName = normalizeMemoName(c.req.param("memo"));
    const raw = await readJsonObject(c);
    const comment = unwrapResourceBody(raw, "comment");
    const content = requiredString(comment.content, "comment.content");
    const commentId =
      c.req.query("commentId") ??
      c.req.query("comment_id") ??
      optionalString(raw.commentId) ??
      optionalString(raw.comment_id);

    const created: MemoRow = await createMemoComment(
      context.db,
      context.user,
      memoName,
      {
        content,
        visibility: parseVisibility(comment.visibility),
        payload: memoPayload(comment),
        ...(commentId ? { commentId } : {}),
      },
    );
    return c.json(await memoToCurrentDto(context, created, memoName));
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosSocialApi.get("/memos/:memo/reactions", async (c) => {
  try {
    const context = await getOptionalRequestContext(c);
    const memoName = normalizeMemoName(c.req.param("memo"));
    const page = readPageOptions(c);
    const result: MemoReactionPage = await listMemoReactions(
      context.db,
      context.user,
      {
        memoName,
        pageSize: page.pageSize,
        ...(page.pageToken ? { pageToken: page.pageToken } : {}),
      },
    );

    return c.json({
      reactions: result.reactions.map((reaction) => reactionToDto(reaction)),
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    });
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosSocialApi.post("/memos/:memo/reactions", async (c) => {
  try {
    const context = await getRequestContext(c);
    const memoName = normalizeMemoName(c.req.param("memo"));
    const raw = await readJsonObject(c);
    const reaction = unwrapResourceBody(raw, "reaction");
    const contentId = requiredString(
      reaction.contentId ?? reaction.content_id,
      "reaction.contentId",
    );
    if (normalizeMemoName(contentId) !== memoName) {
      throw new ValidationCurrentError(
        "reaction.contentId must match the memo resource",
      );
    }
    const reactionType = requiredString(
      reaction.reactionType ?? reaction.reaction_type,
      "reaction.reactionType",
    );
    const created: ReactionRow = await upsertMemoReaction(
      context.db,
      context.user,
      { memoName, contentId: memoName, reactionType },
    );
    return c.json(reactionToDto(created));
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosSocialApi.delete("/memos/:memo/reactions/:reaction", async (c) => {
  try {
    const context = await getRequestContext(c);
    const memoName = normalizeMemoName(c.req.param("memo"));
    const reactionId = requiredPathSegment(c.req.param("reaction"), "reaction");
    await deleteMemoReaction(context.db, context.user, {
      name: `${memoName}/reactions/${reactionId}`,
      memoName,
      reactionId,
    });
    return c.body(null, 200);
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosSocialApi.get("/users/:user/shortcuts", async (c) => {
  try {
    const context = await getRequestContext(c);
    const parentName = currentUserResourceName(
      c.req.param("user"),
      context.user.id,
    );
    const shortcuts: ShortcutRow[] = await listShortcuts(
      context.db,
      context.user,
      { parentName },
    );
    return c.json({
      shortcuts: shortcuts.map((shortcut) => shortcutToDto(shortcut)),
    });
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosSocialApi.post("/users/:user/shortcuts", async (c) => {
  try {
    const context = await getRequestContext(c);
    const parentName = currentUserResourceName(
      c.req.param("user"),
      context.user.id,
    );
    const raw = await readJsonObject(c);
    const shortcut = unwrapResourceBody(raw, "shortcut");
    const title = requiredString(shortcut.title, "shortcut.title");
    const filter = optionalString(shortcut.filter) ?? "";
    const validateOnly = readBooleanQuery(c, "validateOnly", "validate_only");
    const bodyValidateOnly = readBooleanValue(
      raw.validateOnly ?? raw.validate_only,
      "validateOnly",
    );

    const created: ShortcutRow = await createShortcut(
      context.db,
      context.user,
      {
        parentName,
        title,
        filter,
        validateOnly: validateOnly ?? bodyValidateOnly ?? false,
      },
    );
    return c.json(shortcutToDto(created));
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosSocialApi.get("/users/:user/shortcuts/:shortcut", async (c) => {
  try {
    const context = await getRequestContext(c);
    const name = currentShortcutResourceName(
      c.req.param("user"),
      c.req.param("shortcut"),
      context.user.id,
    );
    const shortcut: ShortcutRow = await getShortcut(context.db, context.user, {
      name,
    });
    return c.json(shortcutToDto(shortcut));
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosSocialApi.patch("/users/:user/shortcuts/:shortcut", async (c) => {
  try {
    const context = await getRequestContext(c);
    const name = currentShortcutResourceName(
      c.req.param("user"),
      c.req.param("shortcut"),
      context.user.id,
    );
    const raw = await readJsonObject(c);
    const shortcut = unwrapResourceBody(raw, "shortcut");
    const suppliedName = optionalString(shortcut.name);
    if (suppliedName && normalizeShortcutName(suppliedName) !== name) {
      throw new ValidationCurrentError(
        "shortcut.name must match the resource path",
      );
    }
    const updateMask = parseUpdateMask(
      c.req.query("updateMask") ??
        c.req.query("update_mask") ??
        optionalString(raw.updateMask) ??
        optionalString(raw.update_mask),
    );
    const title = optionalString(shortcut.title);
    const filter = optionalString(shortcut.filter);
    if (updateMask.includes("title") && !title) {
      throw new ValidationCurrentError(
        "shortcut.title is required by updateMask",
      );
    }
    if (updateMask.includes("filter") && filter === undefined) {
      throw new ValidationCurrentError(
        "shortcut.filter is required by updateMask",
      );
    }

    const updated: ShortcutRow = await updateShortcut(
      context.db,
      context.user,
      {
        name,
        ...(title !== undefined ? { title } : {}),
        ...(filter !== undefined ? { filter } : {}),
        updateMask,
      },
    );
    return c.json(shortcutToDto(updated));
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosSocialApi.delete("/users/:user/shortcuts/:shortcut", async (c) => {
  try {
    const context = await getRequestContext(c);
    const name = currentShortcutResourceName(
      c.req.param("user"),
      c.req.param("shortcut"),
      context.user.id,
    );
    await deleteShortcut(context.db, context.user, { name });
    return c.body(null, 200);
  } catch (error) {
    return currentJsonError(c, error);
  }
});

async function memoToCurrentDto(
  context: Awaited<ReturnType<typeof getOptionalRequestContext>>,
  memo: MemoRow,
  parentName?: string,
) {
  const reactionPagePromise: Promise<MemoReactionPage> = listMemoReactions(
    context.db,
    context.user,
    {
      memoName: memo.id,
      pageSize: 1000,
    },
  );
  const [attachments, relationRows, reactionPage] = await Promise.all([
    listMemoAttachmentsForViewer(context.db, context.user, memo.id),
    listMemoRelationsForViewer(context.db, context.user, memo.id),
    reactionPagePromise,
  ]);
  const relations = await Promise.all(
    relationRows.map(async (relation) => {
      try {
        const [relationMemo, relatedMemo] = await Promise.all([
          getMemoByIdForViewer(context.db, context.user, relation.memoId, {
            includeDeleted: true,
          }),
          getMemoByIdForViewer(
            context.db,
            context.user,
            relation.relatedMemoId,
            { includeDeleted: true },
          ),
        ]);
        return currentRelationToDto(relation, relationMemo, relatedMemo);
      } catch {
        return null;
      }
    }),
  );
  const creator =
    context.user?.id === memo.userId
      ? context.user
      : await getFlaremoUserById(context.db, memo.userId);
  if (!creator) throw new Error("Memo creator not found");
  return {
    ...currentMemoToDto(memo, creator, {
      attachments,
      relations: relations.filter(
        (value): value is NonNullable<typeof value> => value !== null,
      ),
    }),
    reactions: reactionPage.reactions.map((reaction) =>
      reactionToDto(reaction),
    ),
    ...(parentName ? { parent: parentName } : {}),
  };
}

function reactionToDto(value: ReactionRow) {
  return currentReactionToDto(value);
}

function shortcutToDto(value: ShortcutRow) {
  // The domain row retains a `shortcuts/<id>` storage id. The current adapter
  // strips that storage prefix before constructing the public resource name.
  return currentShortcutToDto(value);
}

function readPageOptions(c: Context<HonoBindings>): PageOptions;
function readPageOptions(
  c: Context<HonoBindings>,
  defaultOrderBy: string,
): PageOptions & { orderBy: string };
function readPageOptions(c: Context<HonoBindings>, defaultOrderBy?: string) {
  const rawPageSize = c.req.query("pageSize") ?? c.req.query("page_size");
  const rawPageToken = c.req.query("pageToken") ?? c.req.query("page_token");
  const result: PageOptions & { orderBy?: string } = {
    pageSize: parsePageSize(rawPageSize),
    ...(rawPageToken ? { pageToken: rawPageToken } : {}),
  };
  if (defaultOrderBy !== undefined) {
    result.orderBy = parseOrderBy(
      c.req.query("orderBy") ?? c.req.query("order_by") ?? defaultOrderBy,
    );
  }
  return result;
}

function parsePageSize(value: string | undefined) {
  if (value === undefined || value.trim() === "") return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ValidationCurrentError("pageSize must be an integer");
  }
  if (parsed <= 0) return 50;
  return Math.min(parsed, 1000);
}

function parseOrderBy(value: string) {
  const match = /^(create_time|update_time)\s+(asc|desc)$/i.exec(value.trim());
  if (!match) {
    throw new ValidationCurrentError(
      "Only create_time or update_time with asc or desc is supported",
    );
  }
  return `${match[1]?.toLowerCase()} ${match[2]?.toLowerCase()}`;
}

function parseUpdateMask(value: string | undefined) {
  const fields = (value ?? "")
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.length === 0) {
    throw new ValidationCurrentError("updateMask is required");
  }
  const expanded = fields.includes("*") ? ["title", "filter"] : fields;
  const unsupported = expanded.filter(
    (field) => field !== "title" && field !== "filter",
  );
  if (unsupported.length > 0) {
    throw new ValidationCurrentError(
      `Unsupported shortcut updateMask field: ${unsupported[0]}`,
    );
  }
  return [...new Set(expanded)];
}

function readBooleanQuery(
  c: Context<HonoBindings>,
  primary: string,
  legacy: string,
) {
  const value = c.req.query(primary) ?? c.req.query(legacy);
  return value === undefined ? undefined : parseBoolean(value, primary);
}

function readBooleanValue(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return parseBoolean(value, field);
  throw new ValidationCurrentError(`${field} must be a boolean`);
}

function parseBoolean(value: string, field: string) {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new ValidationCurrentError(`${field} must be a boolean`);
}

async function readJsonObject(c: Context<HonoBindings>) {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new ValidationCurrentError("Request body must be valid JSON");
  }
  if (!isRecord(value)) {
    throw new ValidationCurrentError("Request body must be a JSON object");
  }
  return value;
}

function unwrapResourceBody(
  body: Record<string, unknown>,
  resource: "comment" | "reaction" | "shortcut",
) {
  const nested = body[resource];
  if (nested !== undefined && !isRecord(nested)) {
    throw new ValidationCurrentError(`${resource} must be an object`);
  }
  return isRecord(nested) ? nested : body;
}

function memoPayload(body: Record<string, unknown>) {
  const payload = isRecord(body.payload) ? { ...body.payload } : {};
  if (Array.isArray(body.tags)) {
    payload.tags = body.tags.filter(
      (tag): tag is string => typeof tag === "string",
    );
  }
  if (isRecord(body.property)) {
    payload.property = {
      ...(typeof body.property.title === "string"
        ? { title: body.property.title }
        : {}),
      ...(typeof body.property.hasLink === "boolean"
        ? { has_link: body.property.hasLink }
        : {}),
      ...(typeof body.property.hasTaskList === "boolean"
        ? { has_task_list: body.property.hasTaskList }
        : {}),
      ...(typeof body.property.hasCode === "boolean"
        ? { has_code: body.property.hasCode }
        : {}),
      ...(typeof body.property.hasIncompleteTasks === "boolean"
        ? { has_incomplete_tasks: body.property.hasIncompleteTasks }
        : {}),
    };
  }
  if (isRecord(body.location)) payload.location = { ...body.location };
  return payload;
}

function parseVisibility(value: unknown): MemoVisibility {
  const normalized =
    typeof value === "string" ? value.toLowerCase() : "private";
  if (normalized === "visibility_unspecified") return "private";
  if (
    normalized === "private" ||
    normalized === "protected" ||
    normalized === "public"
  ) {
    return normalized;
  }
  throw new ValidationCurrentError(
    `Unsupported memo visibility: ${String(value)}`,
  );
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationCurrentError(`${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function normalizeMemoName(value: string) {
  const normalized = value.startsWith("memos/") ? value : `memos/${value}`;
  if (normalized.split("/").length !== 2 || normalized.endsWith("/")) {
    throw new ValidationCurrentError("Invalid memo resource name");
  }
  return normalized;
}

function currentUserResourceName(value: string, currentUserId: string) {
  const normalized = stripUserPrefix(value);
  const expected = stripUserPrefix(currentUserId);
  if (!normalized || normalized !== expected) {
    throw new ForbiddenCurrentError("Only the current user is available");
  }
  return currentUserId.startsWith("users/")
    ? currentUserId
    : `users/${currentUserId}`;
}

function currentShortcutResourceName(
  user: string,
  shortcut: string,
  currentUserId: string,
) {
  const parentName = currentUserResourceName(user, currentUserId);
  const shortcutId = requiredPathSegment(shortcut, "shortcut");
  return `${parentName}/shortcuts/${shortcutId}`;
}

function normalizeShortcutName(value: string) {
  const parts = value.split("/");
  if (parts.length !== 4 || parts[0] !== "users" || parts[2] !== "shortcuts") {
    throw new ValidationCurrentError("Invalid shortcut resource name");
  }
  requiredPathSegment(parts[1] ?? "", "user");
  requiredPathSegment(parts[3] ?? "", "shortcut");
  return value;
}

function stripUserPrefix(value: string) {
  const decoded = decodePathSegment(value);
  return decoded.startsWith("users/")
    ? decoded.slice("users/".length)
    : decoded;
}

function requiredPathSegment(value: string, field: string) {
  const decoded = decodePathSegment(value);
  if (!decoded || decoded.includes("/")) {
    throw new ValidationCurrentError(`${field} is required`);
  }
  return decoded;
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ValidationCurrentError("Invalid resource path");
  }
}

function currentJsonError(c: Context<HonoBindings>, error: unknown) {
  const status = currentErrorStatus(error);
  return c.json(
    {
      code: currentErrorCode(status),
      message: currentErrorMessage(error),
      details: [],
    },
    status as 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500,
  );
}

function currentErrorStatus(error: unknown) {
  if (error instanceof CurrentHttpError) return error.status;
  if (isDomainError(error)) return error.status;
  if (isRecord(error) && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  if (isRecord(error) && typeof error.status === "number") {
    return error.status;
  }
  console.error(
    JSON.stringify({
      level: "error",
      message: "Unhandled current Memos social compatibility request error",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return 500;
}

function currentErrorMessage(error: unknown) {
  if (error instanceof CurrentHttpError) return error.message;
  if (isDomainError(error)) return error.message;
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return "Internal server error";
}

function currentErrorCode(status: number) {
  if (status === 400 || status === 422) return 3;
  if (status === 401) return 16;
  if (status === 403) return 7;
  if (status === 404) return 5;
  if (status === 409) return 6;
  if (status === 413) return 8;
  return 13;
}

function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class CurrentHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

class ValidationCurrentError extends CurrentHttpError {
  constructor(message: string) {
    super(message, 400);
  }
}

class ForbiddenCurrentError extends CurrentHttpError {
  constructor(message: string) {
    super(message, 403);
  }
}
