import { createDb } from "@flaremo/db";
import {
  bindMemoAttachments,
  createMemo,
  createMemoComment,
  createMemoShare,
  createShortcut,
  type DomainError,
  deleteMemoReaction,
  deleteShortcut,
  getAuthUserById,
  getFlaremoUserByAuthSessionToken,
  getMemoById,
  getMemoParent,
  getPublicShareByToken,
  getShortcut,
  hardDeleteMemo,
  listMemoAttachments,
  listMemoComments,
  listMemoReactions,
  listMemoRelations,
  listMemoShares,
  listMemos,
  listShortcuts,
  markMemoAttachmentsDeleting,
  replaceMemoRelations,
  revokeMemoShare,
  updateMemo,
  updateShortcut,
  upsertMemoReaction,
} from "@flaremo/domain";
import {
  currentAttachmentToDto,
  currentMemoToDto,
  currentReactionToDto,
  currentRelationToDto,
  currentShareToDto,
  currentShortcutsToListResponse,
  currentShortcutToDto,
  currentUserToDto,
} from "@flaremo/memos";
import { type Context, Hono } from "hono";
import { createFlareMoAuth } from "../auth";
import {
  assertTrustedCookieMutation,
  getRequestContext,
  type HonoBindings,
} from "../context";
import type { FlareMoEnv } from "../env";
import { fetchLinkMetadata } from "../memos-link-metadata";
import {
  clearMemosRefreshCookie,
  issueMemosNativeTokens,
  revokeMemosRefreshToken,
  rotateMemosRefreshToken,
} from "../memos-native-auth";
import {
  type BinaryTransport,
  decodeBinaryRequest,
  detectBinaryTransport,
  encodeBinaryError,
  encodeBinaryResponse,
  ProtoCodecError,
} from "../memos-protobuf";

/**
 * Connect's JSON protocol is HTTP unary RPC: the request and response body are
 * the protobuf-JSON message itself.  It is separate from the REST adapter so
 * Connect clients can use the canonical service/method paths without relying
 * on a vendor header or a REST-shaped URL.
 *
 * The core MemoService supports Connect JSON plus protobuf unary frames for
 * Connect, gRPC, and gRPC-Web. Service coverage remains explicit below so an
 * unimplemented upstream RPC cannot be mistaken for a generic transport win.
 */
export const memosConnectApi = new Hono<HonoBindings>();
type ConnectContext = Context<HonoBindings>;

const memoService = "memos.api.v1.MemoService";

memosConnectApi.post("/:service/:method", async (c) => {
  const contentType = c.req.header("content-type")?.toLowerCase() ?? "";
  const binaryTransport = detectBinaryTransport(contentType);
  if (!contentType.includes("application/json") && !binaryTransport) {
    return connectError(
      c,
      "unsupported_media_type",
      "Connect JSON or protobuf is required",
      415,
    );
  }

  let body: unknown;
  try {
    body = binaryTransport
      ? decodeBinaryRequest(
          c.req.param("service"),
          c.req.param("method"),
          new Uint8Array(await c.req.raw.arrayBuffer()),
          binaryTransport,
        )
      : await c.req.json();
  } catch (error) {
    if (binaryTransport) {
      return connectBinaryError(c, binaryTransport, error);
    }
    return connectError(
      c,
      "invalid_argument",
      "Request body must be JSON",
      400,
    );
  }

  try {
    const service = c.req.param("service") ?? "";
    const method = c.req.param("method") ?? "";
    if (service === "memos.api.v1.AuthService" && method === "SignIn") {
      return connectAuthSignIn(c, body, binaryTransport);
    }
    if (service === "memos.api.v1.AuthService" && method === "RefreshToken") {
      return connectAuthRefresh(c, binaryTransport);
    }
    if (service === memoService && method === "GetSharedMemo") {
      return await connectGetSharedMemo(c, body, binaryTransport);
    }
    if (service === memoService && method === "GetLinkMetadata") {
      return await connectGetLinkMetadata(c, body, binaryTransport);
    }
    if (service === memoService && method === "BatchGetLinkMetadata") {
      return await connectBatchGetLinkMetadata(c, body, binaryTransport);
    }
    const context = await getRequestContext(c);
    if (service === "memos.api.v1.AuthService" && method === "GetCurrentUser") {
      const authUser = await getAuthUserForContext(context);
      return connectValue(
        c,
        { user: currentUserToDto(context.user, authUser) },
        binaryTransport,
      );
    }
    if (service === "memos.api.v1.AuthService" && method === "SignOut") {
      return connectAuthSignOut(c, context, binaryTransport);
    }
    if (service === "memos.api.v1.ShortcutService") {
      return connectShortcutMethod(c, context, method, body, binaryTransport);
    }
    if (service !== memoService) {
      return connectErrorForTransport(
        c,
        binaryTransport,
        "unimplemented",
        `Memos Connect service is not implemented: ${service}`,
        501,
      );
    }
    switch (method) {
      case "CreateMemo":
        return connectValue(
          c,
          await createConnectMemo(context, body),
          binaryTransport,
        );
      case "ListMemos":
        return connectValue(
          c,
          await listConnectMemos(context, body),
          binaryTransport,
        );
      case "GetMemo":
        return connectValue(
          c,
          await getConnectMemo(context, body),
          binaryTransport,
        );
      case "UpdateMemo":
        return connectValue(
          c,
          await updateConnectMemo(context, body),
          binaryTransport,
        );
      case "DeleteMemo":
        await deleteConnectMemo(context, c.env, body);
        return connectValue(c, {}, binaryTransport);
      case "SetMemoAttachments":
        await setConnectAttachments(context, body);
        return connectValue(c, {}, binaryTransport);
      case "ListMemoAttachments":
        return connectValue(
          c,
          await listConnectAttachments(context, body),
          binaryTransport,
        );
      case "SetMemoRelations":
        await setConnectRelations(context, body);
        return connectValue(c, {}, binaryTransport);
      case "ListMemoRelations":
        return connectValue(
          c,
          await listConnectRelations(context, body),
          binaryTransport,
        );
      case "CreateMemoComment":
        return connectValue(
          c,
          await createConnectMemoComment(context, body),
          binaryTransport,
        );
      case "ListMemoComments":
        return connectValue(
          c,
          await listConnectMemoComments(context, body),
          binaryTransport,
        );
      case "ListMemoReactions":
        return connectValue(
          c,
          await listConnectMemoReactions(context, body),
          binaryTransport,
        );
      case "UpsertMemoReaction":
        return connectValue(
          c,
          await upsertConnectMemoReaction(context, body),
          binaryTransport,
        );
      case "DeleteMemoReaction":
        await deleteConnectMemoReaction(context, body);
        return connectValue(c, {}, binaryTransport);
      case "CreateMemoShare":
        return connectValue(
          c,
          await createConnectMemoShare(context, body),
          binaryTransport,
        );
      case "ListMemoShares":
        return connectValue(
          c,
          await listConnectMemoShares(context, body),
          binaryTransport,
        );
      case "DeleteMemoShare":
        await deleteConnectMemoShare(context, body);
        return connectValue(c, {}, binaryTransport);
      default:
        return connectErrorForTransport(
          c,
          binaryTransport,
          "unimplemented",
          `Memos Connect method is not implemented: ${method}`,
          501,
        );
    }
  } catch (error) {
    if (binaryTransport) return connectBinaryError(c, binaryTransport, error);
    return connectDomainError(c, error);
  }
});

async function connectShortcutMethod(
  c: ConnectContext,
  context: Awaited<ReturnType<typeof getRequestContext>>,
  method: string,
  value: unknown,
  transport?: BinaryTransport,
) {
  const body = record(value);
  switch (method) {
    case "ListShortcuts": {
      const parent = optionalString(body.parent) ?? context.user.id;
      const shortcuts = await listShortcuts(context.db, context.user, parent);
      return connectValue(
        c,
        currentShortcutsToListResponse(shortcuts),
        transport,
      );
    }
    case "GetShortcut":
      return connectValue(
        c,
        currentShortcutToDto(
          await getShortcut(
            context.db,
            context.user,
            requiredString(body.name, "name"),
          ),
        ),
        transport,
      );
    case "CreateShortcut": {
      const shortcut = record(body.shortcut);
      const created = await createShortcut(context.db, context.user, {
        parentName: optionalString(body.parent),
        title: optionalString(shortcut.title),
        filter: optionalString(shortcut.filter),
        validateOnly: body.validateOnly === true,
      });
      return connectValue(c, currentShortcutToDto(created), transport);
    }
    case "UpdateShortcut": {
      const shortcut = record(body.shortcut);
      const updated = await updateShortcut(context.db, context.user, {
        name: requiredString(shortcut.name, "shortcut.name"),
        title: optionalString(shortcut.title),
        filter: optionalString(shortcut.filter),
        updateMask: optionalString(body.updateMask),
      });
      return connectValue(c, currentShortcutToDto(updated), transport);
    }
    case "DeleteShortcut":
      await deleteShortcut(context.db, context.user, {
        name: requiredString(body.name, "name"),
      });
      return connectValue(c, {}, transport);
    default:
      return connectErrorForTransport(
        c,
        transport,
        "unimplemented",
        `Shortcut method is not implemented: ${method}`,
        501,
      );
  }
}

async function createConnectMemoComment(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const comment = record(body.comment);
  const created = await createMemoComment(
    context.db,
    context.user,
    normalizeMemoName(requiredString(body.name, "name")),
    {
      content: requiredString(comment.content, "comment.content"),
      payload: currentPayload(comment),
      source: "memos-connect",
      ...(optionalString(body.commentId)
        ? { commentId: optionalString(body.commentId) }
        : {}),
    },
  );
  return connectMemoWithDetails(context, created.id);
}

async function listConnectMemoComments(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const result = await listMemoComments(context.db, context.user, {
    memoName: normalizeMemoName(requiredString(body.name, "name")),
    pageSize: pageSize(body.pageSize),
    ...(optionalString(body.pageToken)
      ? { pageToken: optionalString(body.pageToken) }
      : {}),
    orderBy: optionalString(body.orderBy) ?? "create_time desc",
  });
  const comments = await Promise.all(
    result.memos.map((memo) => connectMemoWithDetails(context, memo.id)),
  );
  return {
    memos: comments,
    ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
  };
}

async function listConnectMemoReactions(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const result = await listMemoReactions(context.db, context.user, {
    memoName: normalizeMemoName(requiredString(body.name, "name")),
    pageSize: pageSize(body.pageSize),
    ...(optionalString(body.pageToken)
      ? { pageToken: optionalString(body.pageToken) }
      : {}),
  });
  return {
    reactions: result.reactions.map(currentReactionToDto),
    ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
  };
}

async function upsertConnectMemoReaction(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const reaction = record(body.reaction);
  const memoName = normalizeMemoName(requiredString(body.name, "name"));
  const contentId = normalizeMemoName(
    optionalString(reaction.contentId) ?? memoName,
  );
  const created = await upsertMemoReaction(context.db, context.user, {
    memoName,
    contentId,
    reactionType: requiredString(
      reaction.reactionType,
      "reaction.reactionType",
    ),
  });
  return currentReactionToDto(created);
}

async function deleteConnectMemoReaction(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const name = requiredString(body.name, "name");
  await deleteMemoReaction(context.db, context.user, {
    name,
    memoName: normalizeMemoName(reactionMemoName(name)),
  });
}

async function createConnectMemoShare(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const memoShare = record(body.memoShare);
  const expireTime = optionalTimestamp(
    memoShare.expireTime ?? memoShare.expire_time,
    "memoShare.expireTime",
  );
  const share = await createMemoShare(
    context.db,
    context.user,
    normalizeMemoName(requiredString(body.parent, "parent")),
    { expires_at: expireTime },
  );
  return currentShareToDto(share);
}

async function listConnectMemoShares(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const shares = await listMemoShares(
    context.db,
    context.user,
    normalizeMemoName(requiredString(body.parent, "parent")),
  );
  return { memoShares: shares.map(currentShareToDto) };
}

async function deleteConnectMemoShare(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  await revokeMemoShare(
    context.db,
    context.user,
    shareTokenFromName(requiredString(body.name, "name")),
  );
}

async function connectGetSharedMemo(
  c: ConnectContext,
  value: unknown,
  transport?: BinaryTransport,
) {
  const body = record(value);
  const db = createDb(c.env.DB);
  const shared = await getPublicShareByToken(
    db,
    requiredString(body.shareToken, "shareToken"),
  );
  const reactions = await listMemoReactions(db, shared.user, shared.memo.id, {
    pageSize: 1_000,
  });
  return connectValue(
    c,
    currentMemoToDto(shared.memo, shared.user, {
      attachments: shared.attachments,
      reactions: reactions.reactions,
    }),
    transport,
  );
}

async function connectGetLinkMetadata(
  c: ConnectContext,
  value: unknown,
  transport?: BinaryTransport,
) {
  const body = record(value);
  return connectValue(
    c,
    await fetchLinkMetadata(requiredString(body.url, "url")),
    transport,
  );
}

async function connectBatchGetLinkMetadata(
  c: ConnectContext,
  value: unknown,
  transport?: BinaryTransport,
) {
  const body = record(value);
  const urls = list(body.urls).map((url) => requiredString(url, "urls[]"));
  if (urls.length === 0) throw new ConnectInputError("urls are required");
  if (urls.length > 10) throw new ConnectInputError("too many urls (max 10)");
  const linkMetadata = await Promise.all(
    urls.map((url) => fetchLinkMetadata(url)),
  );
  return connectValue(c, { linkMetadata }, transport);
}

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
  const reactions = await listMemoReactionsForPage(
    context,
    result.memos.map((memo) => memo.id),
  );
  return {
    memos: result.memos.map((memo) =>
      currentMemoToDto(memo, context.user, {
        attachments: attachments.get(memo.id) ?? [],
        reactions: reactions.get(memo.id) ?? [],
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
  const [attachments, rows, reactionPage, parent] = await Promise.all([
    listMemoAttachments(context.db, context.user, memo.id),
    listMemoRelations(context.db, context.user, memo.id),
    listMemoReactions(context.db, context.user, {
      memoName: memo.id,
      pageSize: 1_000,
    }),
    getMemoParent(context.db, context.user, memo.id),
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
  return currentMemoToDto(memo, context.user, {
    attachments,
    relations,
    reactions: reactionPage.reactions,
    parent,
  });
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

async function listMemoReactionsForPage(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  memoIds: string[],
) {
  const result = new Map<
    string,
    Awaited<ReturnType<typeof listMemoReactions>>["reactions"]
  >();
  await Promise.all(
    memoIds.map(async (id) => {
      const page = await listMemoReactions(context.db, context.user, {
        memoName: id,
        pageSize: 1_000,
      });
      result.set(id, page.reactions);
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

function reactionMemoName(value: string) {
  const parts = value.split("/").filter(Boolean);
  const marker = parts.lastIndexOf("reactions");
  if (marker <= 0 || marker + 2 !== parts.length) {
    throw new ConnectInputError("Invalid reaction name");
  }
  return parts.slice(0, marker).join("/");
}

function shareTokenFromName(value: string) {
  const parts = value.split("/").filter(Boolean);
  const marker = parts.lastIndexOf("shares");
  if (marker < 0 || marker + 2 !== parts.length) {
    throw new ConnectInputError("Invalid share name");
  }
  const token = parts[marker + 1];
  if (!token) throw new ConnectInputError("Invalid share name");
  return token;
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

function optionalTimestamp(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = requiredString(value, field);
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new ConnectInputError(`${field} must be a valid timestamp`);
  }
  return date.toISOString();
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

function connectValue(
  c: ConnectContext,
  value: unknown,
  transport?: BinaryTransport,
) {
  if (!transport) return connectJson(c, value);
  const encoded = encodeBinaryResponse(
    c.req.param("service") ?? "",
    c.req.param("method") ?? "",
    value,
    transport,
  );
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": binaryContentType(transport),
  });
  if (transport !== "connect-proto") headers.set("grpc-status", "0");
  return new Response(encoded as unknown as BodyInit, { status: 200, headers });
}

async function connectAuthSignIn(
  c: ConnectContext,
  value: unknown,
  transport?: BinaryTransport,
) {
  try {
    assertTrustedCookieMutation(c);
    const credentials = record(record(value).passwordCredentials);
    const username = requiredString(credentials.username, "username");
    const password = requiredString(credentials.password, "password");
    const db = createDb(c.env.DB);
    const auth = createFlareMoAuth(c.env, db);
    const result = await auth.api.signInUsername({
      body: { username, password, rememberMe: true },
      headers: c.req.raw.headers,
      asResponse: false,
      returnHeaders: true,
    });
    const session = await getFlaremoUserByAuthSessionToken(
      db,
      result.response.token,
    );
    if (!session) throw new Error("Better Auth session could not be resolved");
    const nativeTokens = await issueMemosNativeTokens({
      db,
      env: c.env,
      authUserId: session.authUserId,
      user: session.user,
      request: c.req.raw,
    });
    const response = connectValue(
      c,
      {
        user: currentUserToDto(
          session.user,
          await getAuthUserById(db, session.authUserId),
        ),
        accessToken: nativeTokens.accessToken,
        accessTokenExpiresAt: nativeTokens.accessTokenExpiresAt.toISOString(),
      },
      transport,
    );
    copyResponseHeaders(response.headers, result.headers);
    response.headers.append("set-cookie", nativeTokens.refreshCookie);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return transport
      ? connectBinaryError(c, transport, error)
      : connectDomainError(c, error);
  }
}

async function connectAuthRefresh(
  c: ConnectContext,
  transport?: BinaryTransport,
) {
  try {
    if (c.req.raw.headers.get("cookie")) assertTrustedCookieMutation(c);
    const db = createDb(c.env.DB);
    const rotated = await rotateMemosRefreshToken({
      db,
      env: c.env,
      request: c.req.raw,
    });
    if (!rotated) {
      return connectErrorForTransport(
        c,
        transport,
        "unauthenticated",
        "Refresh token is invalid or expired",
        401,
      );
    }
    const response = connectValue(
      c,
      {
        accessToken: rotated.accessToken,
        expiresAt: rotated.accessTokenExpiresAt.toISOString(),
      },
      transport,
    );
    response.headers.append("set-cookie", rotated.refreshCookie);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return transport
      ? connectBinaryError(c, transport, error)
      : connectDomainError(c, error);
  }
}

async function connectAuthSignOut(
  c: ConnectContext,
  context: Awaited<ReturnType<typeof getRequestContext>>,
  transport?: BinaryTransport,
) {
  try {
    if (c.req.raw.headers.get("cookie")) assertTrustedCookieMutation(c);
    await revokeMemosRefreshToken({
      db: context.db,
      env: c.env,
      headers: c.req.raw.headers,
      expectedAuthUserId: context.authUserId,
    });
    const response = connectValue(c, {}, transport);
    response.headers.append("set-cookie", clearMemosRefreshCookie(c.req.raw));
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return transport
      ? connectBinaryError(c, transport, error)
      : connectDomainError(c, error);
  }
}

function copyResponseHeaders(target: Headers, source: Headers) {
  for (const [name, value] of source.entries()) {
    if (name === "set-cookie") target.append(name, value);
    else target.set(name, value);
  }
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

function connectErrorForTransport(
  c: ConnectContext,
  transport: BinaryTransport | undefined,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 415 | 500 | 501,
) {
  if (!transport) return connectError(c, code, message, status);
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": binaryContentType(transport),
    "grpc-message": encodeURIComponent(message),
    "grpc-status": String(grpcStatusForCode(code)),
  });
  return new Response(encodeBinaryError(message, transport), {
    status,
    headers,
  });
}

function connectBinaryError(
  c: ConnectContext,
  transport: BinaryTransport,
  error: unknown,
) {
  if (error instanceof ConnectInputError) {
    return connectErrorForTransport(
      c,
      transport,
      "invalid_argument",
      error.message,
      400,
    );
  }
  if (error instanceof ProtoCodecError) {
    return connectErrorForTransport(
      c,
      transport,
      "invalid_argument",
      error.message,
      400,
    );
  }
  if (isDomainError(error)) {
    const status = error.status;
    return connectErrorForTransport(
      c,
      transport,
      domainCode(status),
      error.message,
      status === 401 || status === 403 || status === 404 || status === 409
        ? status
        : status >= 500
          ? 500
          : 400,
    );
  }
  return connectErrorForTransport(
    c,
    transport,
    "internal",
    "Internal error",
    500,
  );
}

function binaryContentType(transport: BinaryTransport) {
  if (transport === "connect-proto") return "application/proto";
  if (transport === "grpc-proto") return "application/grpc+proto";
  if (transport === "grpc-web-proto") return "application/grpc-web+proto";
  return "application/grpc-web-text+proto";
}

function grpcStatusForCode(code: string) {
  switch (code) {
    case "invalid_argument":
      return 3;
    case "unauthenticated":
      return 16;
    case "permission_denied":
      return 7;
    case "not_found":
      return 5;
    case "already_exists":
      return 6;
    case "unimplemented":
      return 12;
    default:
      return 13;
  }
}

async function getAuthUserForContext(
  context: Awaited<ReturnType<typeof getRequestContext>>,
) {
  return getAuthUserById(context.db, context.authUserId);
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
