import {
  bindMemoAttachments,
  createMemo,
  type DomainError,
  getMemoById,
  hardDeleteMemo,
  listMemoAttachments,
  listMemoRelations,
  listMemos,
  markMemoAttachmentsDeleting,
  replaceMemoRelations,
  updateMemo,
} from "@flaremo/domain";
import {
  currentAttachmentToDto,
  currentMemoToDto,
  currentRelationToDto,
} from "@flaremo/memos";
import { type Context, Hono } from "hono";
import { getRequestContext, type HonoBindings } from "../context";
import type { FlareMoEnv } from "../env";

/**
 * Connect's JSON protocol is HTTP unary RPC: the request and response body are
 * the protobuf-JSON message itself.  It is separate from the REST adapter so
 * Connect clients can use the canonical service/method paths without relying
 * on a vendor header or a REST-shaped URL.
 *
 * This Worker intentionally advertises JSON Connect only.  Native gRPC and
 * gRPC-Web require a different binary transport/server surface and are not
 * silently treated as equivalent.
 */
export const memosConnectApi = new Hono<HonoBindings>();
type ConnectContext = Context<HonoBindings>;

const service = "memos.api.v1.MemoService";

memosConnectApi.post(`/${service}/:method`, async (c) => {
  const contentType = c.req.header("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return connectError(
      c,
      "unsupported_media_type",
      "Connect JSON is required",
      415,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return connectError(
      c,
      "invalid_argument",
      "Request body must be JSON",
      400,
    );
  }

  try {
    const context = await getRequestContext(c);
    switch (c.req.param("method")) {
      case "CreateMemo":
        return connectJson(c, await createConnectMemo(context, body));
      case "ListMemos":
        return connectJson(c, await listConnectMemos(context, body));
      case "GetMemo":
        return connectJson(c, await getConnectMemo(context, body));
      case "UpdateMemo":
        return connectJson(c, await updateConnectMemo(context, body));
      case "DeleteMemo":
        await deleteConnectMemo(context, c.env, body);
        return connectJson(c, {});
      case "SetMemoAttachments":
        await setConnectAttachments(context, body);
        return connectJson(c, {});
      case "ListMemoAttachments":
        return connectJson(c, await listConnectAttachments(context, body));
      case "SetMemoRelations":
        await setConnectRelations(context, body);
        return connectJson(c, {});
      case "ListMemoRelations":
        return connectJson(c, await listConnectRelations(context, body));
      default:
        return connectError(
          c,
          "unimplemented",
          `Memos Connect method is not implemented: ${c.req.param("method")}`,
          501,
        );
    }
  } catch (error) {
    return connectDomainError(c, error);
  }
});

async function createConnectMemo(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const memo = record(body.memo);
  const created = await createMemo(context.db, context.user, {
    content: requiredString(memo.content, "memo.content"),
    visibility: visibilityToLegacy(memo.visibility),
    payload: currentPayload(memo),
    source: "memos-connect",
  });
  return connectMemoWithDetails(context, created.id);
}

async function listConnectMemos(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const query = {
    page_size: pageSize(body.pageSize),
    page_token: optionalString(body.pageToken),
    order_by: normalizeOrderBy(
      optionalString(body.orderBy) ?? "create_time desc",
    ),
    state: stateToLegacy(optionalString(body.state)),
    filter: optionalString(body.filter),
    include_deleted: body.showDeleted === true,
  };
  const result = await listMemos(context.db, context.user, query);
  const attachments = await listMemoAttachmentsForPage(
    context,
    result.memos.map((memo) => memo.id),
  );
  return {
    memos: result.memos.map((memo) =>
      currentMemoToDto(memo, context.user, {
        attachments: attachments.get(memo.id) ?? [],
      }),
    ),
    ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
  };
}

async function getConnectMemo(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  return connectMemoWithDetails(context, requiredString(body.name, "name"));
}

async function updateConnectMemo(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const memo = record(body.memo);
  const name = requiredString(memo.name, "memo.name");
  const fields = String(body.updateMask ?? "")
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.length === 0)
    throw new ConnectInputError("updateMask is required");

  const input: Parameters<typeof updateMemo>[3] = {};
  for (const field of fields) {
    switch (field) {
      case "content":
        input.content = requiredString(memo.content, "memo.content");
        break;
      case "visibility":
        input.visibility = visibilityToLegacy(memo.visibility);
        break;
      case "pinned":
        if (typeof memo.pinned !== "boolean")
          throw new ConnectInputError("memo.pinned must be a boolean");
        input.pinned = memo.pinned;
        break;
      case "state":
        input.status = stateToLegacy(optionalString(memo.state));
        break;
      case "property":
      case "location":
      case "tags":
        input.payload = currentPayload(memo);
        break;
      default:
        throw new ConnectInputError(`Unsupported updateMask field: ${field}`);
    }
  }
  const updated = await updateMemo(
    context.db,
    context.user,
    normalizeMemoName(name),
    input,
  );
  return connectMemoWithDetails(context, updated.id);
}

async function deleteConnectMemo(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  env: FlareMoEnv,
  value: unknown,
) {
  const body = record(value);
  const memo = await getMemoById(
    context.db,
    context.user,
    normalizeMemoName(requiredString(body.name, "name")),
    { includeDeleted: true },
  );
  if (body.force === true) {
    const attachments = await markMemoAttachmentsDeleting(
      context.db,
      context.user,
      memo.id,
    );
    const objectKeys = attachments
      .filter((attachment) => attachment.state !== "missing")
      .map((attachment) => attachment.r2Key);
    if (objectKeys.length > 0) await env.ATTACHMENTS.delete(objectKeys);
    await hardDeleteMemo(context.db, context.user, memo.id);
  } else {
    await updateMemo(context.db, context.user, memo.id, { status: "trashed" });
  }
}

async function setConnectAttachments(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const names = list(body.attachments).map((attachment) =>
    typeof attachment === "string"
      ? attachment
      : requiredString(record(attachment).name, "attachments[].name"),
  );
  await bindMemoAttachments(
    context.db,
    context.user,
    normalizeMemoName(requiredString(body.name, "name")),
    names,
  );
}

async function listConnectAttachments(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const attachments = await listMemoAttachments(
    context.db,
    context.user,
    normalizeMemoName(requiredString(body.name, "name")),
  );
  return { attachments: attachments.map(currentAttachmentToDto) };
}

async function setConnectRelations(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const relations = list(body.relations).map((value) => {
    const relation = record(value);
    const relatedMemo = record(relation.relatedMemo);
    return {
      related_memo:
        optionalString(relatedMemo.name) ??
        requiredString(relation.relatedMemo, "relations[].relatedMemo"),
      type: relationTypeToLegacy(optionalString(relation.type)),
    };
  });
  await replaceMemoRelations(
    context.db,
    context.user,
    normalizeMemoName(requiredString(body.name, "name")),
    { relations },
  );
}

async function listConnectRelations(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const memoId = normalizeMemoName(requiredString(record(value).name, "name"));
  const memo = await getMemoById(context.db, context.user, memoId, {
    includeDeleted: true,
  });
  const rows = await listMemoRelations(context.db, context.user, memo.id);
  const relations = await Promise.all(
    rows.map(async (row) => {
      const relatedMemo = await getMemoById(
        context.db,
        context.user,
        row.relatedMemoId,
        { includeDeleted: true },
      );
      return currentRelationToDto(row, memo, relatedMemo);
    }),
  );
  return { relations };
}

async function connectMemoWithDetails(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  id: string,
) {
  const memo = await getMemoById(
    context.db,
    context.user,
    normalizeMemoName(id),
  );
  const [attachments, rows] = await Promise.all([
    listMemoAttachments(context.db, context.user, memo.id),
    listMemoRelations(context.db, context.user, memo.id),
  ]);
  const relations = await Promise.all(
    rows.map(async (row) => {
      const related = await getMemoById(
        context.db,
        context.user,
        row.relatedMemoId,
        { includeDeleted: true },
      );
      return currentRelationToDto(row, memo, related);
    }),
  );
  return currentMemoToDto(memo, context.user, { attachments, relations });
}

async function listMemoAttachmentsForPage(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  memoIds: string[],
) {
  const result = new Map<
    string,
    Awaited<ReturnType<typeof listMemoAttachments>>
  >();
  await Promise.all(
    memoIds.map(async (id) => {
      result.set(id, await listMemoAttachments(context.db, context.user, id));
    }),
  );
  return result;
}

function currentPayload(memo: Record<string, unknown>) {
  const payload = record(memo.payload);
  if (Array.isArray(memo.tags)) payload.tags = memo.tags;
  if (memo.property && typeof memo.property === "object") {
    payload.property = memo.property;
  }
  if (memo.location && typeof memo.location === "object") {
    payload.location = memo.location;
  }
  return payload;
}

function visibilityToLegacy(value: unknown) {
  const normalized = String(value ?? "PRIVATE").toLowerCase();
  if (
    normalized === "private" ||
    normalized === "protected" ||
    normalized === "public"
  ) {
    return normalized;
  }
  throw new ConnectInputError(`Unsupported visibility: ${String(value)}`);
}

function stateToLegacy(value: string | undefined) {
  const normalized = (value ?? "NORMAL").toUpperCase();
  if (normalized === "NORMAL") return "normal" as const;
  if (normalized === "ARCHIVED") return "archived" as const;
  if (normalized === "TRASHED") return "trashed" as const;
  if (normalized === "DELETED") return "deleted" as const;
  if (normalized === "STATE_UNSPECIFIED") return undefined;
  throw new ConnectInputError(`Unsupported memo state: ${value}`);
}

function relationTypeToLegacy(value: string | undefined) {
  const normalized = (value ?? "REFERENCE").toUpperCase();
  if (normalized === "REFERENCE") return "reference" as const;
  if (normalized === "COMMENT") return "comment" as const;
  throw new ConnectInputError(`Unsupported relation type: ${value}`);
}

function normalizeOrderBy(value: string) {
  const match =
    /^(created_at|created_time|create_time|updated_at|updated_time|update_time)\s+(asc|desc)$/i.exec(
      value.trim(),
    );
  if (!match) {
    throw new ConnectInputError(
      "orderBy must be one supported single-field order such as create_time desc",
    );
  }
  const field = match[1]?.toLowerCase().startsWith("update")
    ? "updated_at"
    : "created_at";
  const direction = match[2]?.toLowerCase() === "asc" ? "asc" : "desc";
  return `${field} ${direction}` as
    | "created_at asc"
    | "created_at desc"
    | "updated_at asc"
    | "updated_at desc";
}

function pageSize(value: unknown) {
  if (value === undefined) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new ConnectInputError("pageSize must be a positive integer");
  return Math.min(parsed, 1_000);
}

function normalizeMemoName(value: string) {
  return value.startsWith("memos/") ? value : `memos/${value}`;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim())
    throw new ConnectInputError(`${field} is required`);
  return value.trim();
}

class ConnectInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectInputError";
  }
}

function connectJson(c: ConnectContext, value: unknown) {
  return c.json(value, 200, { "content-type": "application/json" });
}

function connectError(
  c: ConnectContext,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 415 | 500 | 501,
) {
  return c.json({ code, message }, status, {
    "content-type": "application/json",
  });
}

function connectDomainError(c: ConnectContext, error: unknown) {
  if (error instanceof ConnectInputError) {
    return connectError(c, "invalid_argument", error.message, 400);
  }
  if (isDomainError(error)) {
    const status = error.status;
    return connectError(
      c,
      domainCode(status),
      error.message,
      status === 401 || status === 403 || status === 404 || status === 409
        ? status
        : status >= 500
          ? 500
          : 400,
    );
  }
  return connectError(c, "internal", "Internal error", 500);
}

function isDomainError(error: unknown): error is DomainError {
  return Boolean(
    error &&
      typeof error === "object" &&
      "status" in error &&
      typeof error.status === "number" &&
      "message" in error,
  );
}

function domainCode(status: number) {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "already_exists";
  return "invalid_argument";
}
