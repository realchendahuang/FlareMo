import type { UserRow } from "@flaremo/db";
import { createDb } from "@flaremo/db";
import {
  bindMemoAttachments,
  compileAttachmentFilter,
  createAttachmentMetadata,
  createMemo,
  createMemoComment,
  createMemoShare,
  createShortcut,
  createUserWebhook,
  type DomainError,
  deleteMemoReaction,
  deleteShortcut,
  deleteUserNotification,
  deleteUserWebhook,
  finalizeAttachmentDelete,
  getAttachmentById,
  getAuthBootstrapStatus,
  getAuthUserById,
  getFlaremoUserByAuthSessionToken,
  getFlaremoUserById,
  getMemoById,
  getMemoByIdForViewer,
  getMemoParent,
  getMemoStats,
  getPublicShareByToken,
  getShortcut,
  getStoredSetting,
  getUserWebhookSigningSecret,
  hardDeleteMemo,
  listAttachmentsPage,
  listMemoAttachments,
  listMemoAttachmentsForViewer,
  listMemoComments,
  listMemoReactions,
  listMemoRelationsForViewer,
  listMemoShares,
  listMemos,
  listMemosForViewer,
  listMemosPersonalAccessTokens,
  listShortcuts,
  listUserNotifications,
  listUserWebhooks,
  markAttachmentDeleting,
  markMemoAttachmentsDeleting,
  replaceMemoRelations,
  revokeAuthSessionByToken,
  revokeMemoShare,
  type UserNotificationDto,
  updateAttachmentMemo,
  updateFlaremoUserProfile,
  updateMemo,
  updateShortcut,
  updateUserNotification,
  updateUserWebhook,
  upsertMemoReaction,
  upsertStoredSetting,
} from "@flaremo/domain";
import {
  currentAttachmentsToListResponse,
  currentAttachmentToDto,
  currentMemoToDto,
  currentReactionToDto,
  currentRelationToDto,
  currentShareToDto,
  currentShortcutsToListResponse,
  currentShortcutToDto,
  currentUserToDto,
  publicUserToDto,
} from "@flaremo/memos";
import { type Context, Hono } from "hono";
import {
  createAttachmentObjectKey,
  MAX_ATTACHMENT_BYTES,
} from "../attachment-http";
import { createFlareMoAuth } from "../auth";
import {
  assertRequestCredentialBoundary,
  assertTrustedCookieMutation,
  getOptionalRequestContext,
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
  normalizeMemosJsonResponse,
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
    assertRequestCredentialBoundary(c);
    const service = c.req.param("service") ?? "";
    const method = c.req.param("method") ?? "";
    if (service === "memos.api.v1.AuthService" && method === "SignIn") {
      return connectAuthSignIn(c, body, binaryTransport);
    }
    if (service === "memos.api.v1.AuthService" && method === "RefreshToken") {
      return connectAuthRefresh(c, binaryTransport);
    }
    if (
      service === memoService &&
      (method === "GetMemoByShare" || method === "GetSharedMemo")
    ) {
      return await connectGetSharedMemo(c, body, binaryTransport);
    }
    if (service === memoService && method === "GetLinkMetadata") {
      return await connectGetLinkMetadata(c, body, binaryTransport);
    }
    if (service === memoService && method === "BatchGetLinkMetadata") {
      return await connectBatchGetLinkMetadata(c, body, binaryTransport);
    }
    if (service === memoService && isPublicMemoReadMethod(method)) {
      return await connectPublicMemoRead(
        c,
        await getOptionalRequestContext(c),
        method,
        body,
        binaryTransport,
      );
    }
    if (
      service === "memos.api.v1.IdentityProviderService" &&
      method === "ListIdentityProviders"
    ) {
      return connectValue(c, { identityProviders: [] }, binaryTransport);
    }
    if (
      service === "memos.api.v1.InstanceService" &&
      [
        "GetInstanceProfile",
        "GetInstanceSetting",
        "BatchGetInstanceSettings",
      ].includes(method)
    ) {
      const optionalContext = await getOptionalRequestContext(c);
      return await connectInstanceMethod(
        c,
        optionalContext.user
          ? (optionalContext as ConnectRequestContext)
          : await getPublicInstanceContext(c),
        method,
        body,
        binaryTransport,
      );
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
    if (service === "memos.api.v1.AttachmentService") {
      return await connectAttachmentMethod(
        c,
        context,
        method,
        body,
        binaryTransport,
      );
    }
    if (service === "memos.api.v1.UserService") {
      return await connectUserMethod(c, context, method, body, binaryTransport);
    }
    if (service === "memos.api.v1.InstanceService") {
      return await connectInstanceMethod(
        c,
        context,
        method,
        body,
        binaryTransport,
      );
    }
    if (service === "memos.api.v1.IdentityProviderService") {
      return await connectIdentityProviderMethod(
        c,
        context,
        method,
        body,
        binaryTransport,
      );
    }
    if (service === "memos.api.v1.AIService") {
      return connectErrorForTransport(
        c,
        binaryTransport,
        "unimplemented",
        "AI transcription is not configured on FlareMo",
        501,
      );
    }
    if (service === "memos.api.v1.ShortcutService") {
      return await connectShortcutMethod(
        c,
        context,
        method,
        body,
        binaryTransport,
      );
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
      const parent = requiredString(body.parent, "parent");
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
        parentName: requiredString(body.parent, "parent"),
        title: optionalString(shortcut.title),
        filter: optionalString(shortcut.filter),
        validateOnly: body.validateOnly === true,
      });
      return connectValue(c, currentShortcutToDto(created), transport);
    }
    case "UpdateShortcut": {
      const shortcut = record(body.shortcut);
      const updateMask = fieldMaskPaths(body.updateMask);
      if (updateMask.length === 0) {
        throw new ConnectInputError("updateMask is required");
      }
      const updated = await updateShortcut(context.db, context.user, {
        name: requiredString(shortcut.name, "shortcut.name"),
        title: optionalString(shortcut.title),
        filter: optionalString(shortcut.filter),
        updateMask,
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

type ConnectRequestContext = Awaited<ReturnType<typeof getRequestContext>>;

async function connectAttachmentMethod(
  c: ConnectContext,
  context: ConnectRequestContext,
  method: string,
  value: unknown,
  transport?: BinaryTransport,
) {
  const body = record(value);
  switch (method) {
    case "CreateAttachment": {
      const attachment = await createConnectAttachment(
        c.env,
        context,
        record(body.attachment),
        optionalString(body.attachmentId),
      );
      return connectValue(c, currentAttachmentToDto(attachment), transport);
    }
    case "ListAttachments": {
      const filterExpression = optionalString(body.filter);
      const filterPredicate = compileAttachmentFilter(filterExpression);
      const result = await listAttachmentsPage(context.db, context.user, {
        pageSize: pageSize(body.pageSize),
        pageToken: optionalString(body.pageToken),
        orderBy: optionalString(body.orderBy),
        ...(filterPredicate
          ? {
              filterPredicate,
              filterExpression,
            }
          : {}),
      });
      return connectValue(
        c,
        currentAttachmentsToListResponse(result.attachments, {
          nextPageToken: result.nextPageToken,
          totalSize: result.totalSize,
        }),
        transport,
      );
    }
    case "GetAttachment": {
      const attachment = await getAttachmentById(
        context.db,
        context.user,
        normalizeAttachmentName(requiredString(body.name, "name")),
      );
      return connectValue(c, currentAttachmentToDto(attachment), transport);
    }
    case "UpdateAttachment": {
      const attachment = record(body.attachment);
      const fields = fieldMaskPaths(body.updateMask);
      if (fields.length !== 1 || fields[0] !== "memo") {
        throw new ConnectInputError(
          "Only the attachment memo field is mutable",
        );
      }
      const updated = await updateAttachmentMemo(
        context.db,
        context.user,
        normalizeAttachmentName(
          requiredString(attachment.name, "attachment.name"),
        ),
        optionalString(attachment.memo) ?? null,
      );
      return connectValue(c, currentAttachmentToDto(updated), transport);
    }
    case "DeleteAttachment": {
      await deleteConnectAttachment(
        c.env,
        context,
        requiredString(body.name, "name"),
      );
      return connectValue(c, {}, transport);
    }
    case "BatchDeleteAttachments": {
      const names = list(body.names).map((name) =>
        requiredString(name, "names[]"),
      );
      for (const name of names) {
        await deleteConnectAttachment(c.env, context, name);
      }
      return connectValue(c, {}, transport);
    }
    default:
      return connectErrorForTransport(
        c,
        transport,
        "unimplemented",
        `Attachment method is not implemented: ${method}`,
        501,
      );
  }
}

async function createConnectAttachment(
  env: FlareMoEnv,
  context: ConnectRequestContext,
  attachment: Record<string, unknown>,
  attachmentId?: string,
) {
  if (attachmentId) {
    throw new ConnectInputError(
      "attachmentId is not supported; FlareMo generates attachment resource names",
    );
  }
  if (optionalString(attachment.externalLink)) {
    throw new ConnectInputError(
      "External attachments are not supported by FlareMo",
    );
  }
  const filename = requiredString(attachment.filename, "attachment.filename");
  const type = requiredString(attachment.type, "attachment.type");
  const bytes = attachmentBytes(attachment.content);
  if (bytes.byteLength === 0) {
    throw new ConnectInputError("attachment.content is required");
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new ConnectInputError("Attachment exceeds the 25 MiB limit");
  }
  const objectKey = createAttachmentObjectKey(
    context.user.id,
    filename,
    "memos",
  );
  const object = await env.ATTACHMENTS.put(objectKey, bytes, {
    httpMetadata: { contentType: type },
  });
  try {
    return await createAttachmentMetadata(context.db, context.user, {
      memoId: optionalString(attachment.memo) ?? null,
      filename,
      contentType: type,
      size: bytes.byteLength,
      r2Key: objectKey,
      etag: object.httpEtag,
    });
  } catch (error) {
    await env.ATTACHMENTS.delete(objectKey);
    throw error;
  }
}

async function deleteConnectAttachment(
  env: FlareMoEnv,
  context: ConnectRequestContext,
  name: string,
) {
  const attachment = await markAttachmentDeleting(
    context.db,
    context.user,
    normalizeAttachmentName(name),
  );
  await env.ATTACHMENTS.delete(attachment.r2Key);
  await finalizeAttachmentDelete(context.db, context.user, attachment.id);
}

async function connectUserMethod(
  c: ConnectContext,
  context: ConnectRequestContext,
  method: string,
  value: unknown,
  transport?: BinaryTransport,
) {
  const body = record(value);
  const authUser = await getAuthUserById(context.db, context.authUserId);
  const currentUser = currentUserToDto(context.user, authUser);
  switch (method) {
    case "ListUsers": {
      const filter = optionalString(body.filter);
      if (filter && !filter.includes(currentUser.username)) {
        return connectValue(c, { users: [], totalSize: 0 }, transport);
      }
      return connectValue(c, { users: [currentUser], totalSize: 1 }, transport);
    }
    case "BatchGetUsers": {
      const usernames = list(body.usernames).filter(
        (username): username is string => typeof username === "string",
      );
      const users =
        usernames.length === 0 || usernames.includes(currentUser.username)
          ? [currentUser]
          : [];
      return connectValue(c, { users }, transport);
    }
    case "GetUser":
      assertConnectUserPath(body.name, context.user.id);
      return connectValue(c, currentUser, transport);
    case "CreateUser":
    case "DeleteUser":
      return connectErrorForTransport(
        c,
        transport,
        "unimplemented",
        "FlareMo is single-user and does not expose user creation or deletion",
        501,
      );
    case "UpdateUser": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to update the user",
          403,
        );
      }
      const user = record(body.user);
      assertConnectUserPath(user.name, context.user.id);
      const fields = fieldMaskPaths(body.updateMask);
      if (fields.length === 0)
        throw new ConnectInputError("updateMask is required");
      let nextAuthUser = authUser;
      if (fields.includes("username")) {
        const username = requiredString(user.username, "user.username");
        await updateBetterAuthUsername(c, context, username);
        nextAuthUser = await getAuthUserById(context.db, context.authUserId);
      }
      const updatedUser = await updateFlaremoUserProfile(
        context.db,
        context.user,
        {
          ...(fields.includes("displayName")
            ? { name: requiredString(user.displayName, "user.displayName") }
            : {}),
          ...(fields.includes("avatarUrl")
            ? { avatarUrl: optionalString(user.avatarUrl) ?? null }
            : {}),
        },
      );
      return connectValue(
        c,
        currentUserToDto(updatedUser, nextAuthUser),
        transport,
      );
    }
    case "GetUserStats": {
      assertConnectUserPath(body.name, context.user.id);
      const stats = await getMemoStats(context.db, context.user, {
        time_zone: "UTC",
      });
      return connectValue(
        c,
        userStatsFromMemoStats(context.user.id, stats),
        transport,
      );
    }
    case "ListAllUserStats": {
      const stats = await getMemoStats(context.db, context.user, {
        time_zone: "UTC",
      });
      return connectValue(
        c,
        { stats: [userStatsFromMemoStats(context.user.id, stats)] },
        transport,
      );
    }
    case "GetUserSetting": {
      assertConnectUserSettingPath(body.name, context.user.id);
      return connectValue(
        c,
        userSettingResponse(context, requiredString(body.name, "name")),
        transport,
      );
    }
    case "ListUserSettings": {
      assertConnectUserPath(body.parent, context.user.id);
      const settings = await listConnectUserSettings(context);
      return connectValue(
        c,
        { settings, totalSize: settings.length },
        transport,
      );
    }
    case "UpdateUserSetting": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to update settings",
          403,
        );
      }
      const setting = connectSettingRecord(body.setting);
      assertConnectUserSettingPath(setting.name, context.user.id);
      const key = userSettingKey(requiredString(setting.name, "setting.name"));
      await upsertStoredSetting(
        context.db,
        context.user,
        `memos.user.${key}`,
        setting.value,
      );
      return connectValue(c, setting, transport);
    }
    case "ListLinkedIdentities":
      assertConnectUserPath(body.parent, context.user.id);
      return connectValue(c, { linkedIdentities: [] }, transport);
    case "CreateLinkedIdentity":
    case "GetLinkedIdentity":
    case "DeleteLinkedIdentity":
      return connectErrorForTransport(
        c,
        transport,
        "unimplemented",
        "SSO linked identities are not configured on FlareMo",
        501,
      );
    case "ListPersonalAccessTokens": {
      assertConnectUserPath(body.parent, context.user.id);
      const tokens = await listMemosPersonalAccessTokens(
        context.db,
        context.authUserId,
      );
      return connectValue(
        c,
        {
          personalAccessTokens: tokens.map((token) =>
            connectPatToDto(token, context.user.id),
          ),
          totalSize: tokens.length,
        },
        transport,
      );
    }
    case "CreatePersonalAccessToken": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to create a PAT",
          403,
        );
      }
      assertConnectUserPath(body.parent, context.user.id);
      const expiresInDays =
        body.expiresInDays === undefined ? 0 : Number(body.expiresInDays);
      if (
        !Number.isInteger(expiresInDays) ||
        expiresInDays < 0 ||
        expiresInDays > 365
      ) {
        throw new ConnectInputError(
          "expiresInDays must be an integer between 0 and 365",
        );
      }
      const created = await createFlareMoAuth(
        c.env,
        context.db,
      ).api.createApiKey({
        body: {
          configId: "memos",
          userId: context.authUserId,
          name: optionalString(body.description) ?? "Memos API token",
          expiresIn: expiresInDays === 0 ? null : expiresInDays * 24 * 60 * 60,
        },
      });
      return connectValue(
        c,
        {
          personalAccessToken: connectPatToDto(created, context.user.id),
          token: created.key,
        },
        transport,
      );
    }
    case "DeletePersonalAccessToken": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to revoke a PAT",
          403,
        );
      }
      assertConnectPatPath(body.name, context.user.id);
      const tokenId = requiredString(body.name, "name").split("/").at(-1) ?? "";
      const token = (
        await listMemosPersonalAccessTokens(context.db, context.authUserId)
      ).find((item) => item.id === tokenId);
      if (!token)
        throw new ConnectInputError("Personal access token not found");
      await createFlareMoAuth(c.env, context.db).api.updateApiKey({
        body: {
          configId: "memos",
          keyId: token.id,
          userId: context.authUserId,
          enabled: false,
        },
      });
      return connectValue(c, {}, transport);
    }
    case "ListUserWebhooks":
      assertConnectUserPath(body.parent, context.user.id);
      return connectValue(
        c,
        { webhooks: await listUserWebhooks(context.db, context.user) },
        transport,
      );
    case "CreateUserWebhook": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to create a webhook",
          403,
        );
      }
      assertConnectUserPath(body.parent, context.user.id);
      const webhook = record(body.webhook);
      const signingSecret = webhook.signingSecret;
      if (signingSecret !== undefined && typeof signingSecret !== "string") {
        throw new ConnectInputError("webhook.signingSecret must be a string");
      }
      return connectValue(
        c,
        {
          ...(await createUserWebhook(context.db, context.user, {
            url: requiredString(webhook.url, "webhook.url"),
            displayName: optionalString(webhook.displayName) ?? "",
            ...(signingSecret !== undefined ? { signingSecret } : {}),
          })),
        },
        transport,
      );
    }
    case "UpdateUserWebhook": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to update a webhook",
          403,
        );
      }
      const webhook = record(body.webhook);
      const signingSecret = webhook.signingSecret;
      if (signingSecret !== undefined && typeof signingSecret !== "string") {
        throw new ConnectInputError("webhook.signingSecret must be a string");
      }
      return connectValue(
        c,
        await updateUserWebhook(context.db, context.user, {
          name: requiredString(webhook.name, "webhook.name"),
          ...(webhook.url !== undefined ? { url: String(webhook.url) } : {}),
          ...(webhook.displayName !== undefined
            ? { displayName: String(webhook.displayName) }
            : {}),
          ...(signingSecret !== undefined ? { signingSecret } : {}),
          updateMask: fieldMaskPaths(body.updateMask),
        }),
        transport,
      );
    }
    case "DeleteUserWebhook": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to delete a webhook",
          403,
        );
      }
      await deleteUserWebhook(
        context.db,
        context.user,
        requiredString(body.name, "name"),
      );
      return connectValue(c, {}, transport);
    }
    case "GetUserWebhookSigningSecret": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to reveal a webhook secret",
          403,
        );
      }
      return connectValue(
        c,
        {
          signingSecret: await getUserWebhookSigningSecret(
            context.db,
            context.user,
            requiredString(body.name, "name"),
          ),
        },
        transport,
      );
    }
    case "ListUserNotifications": {
      assertConnectUserPath(body.parent, context.user.id);
      const result = await listUserNotifications(context.db, context.user, {
        pageSize:
          body.pageSize === undefined ? undefined : pageSize(body.pageSize),
        pageToken: optionalString(body.pageToken),
        filter: optionalString(body.filter),
      });
      return connectValue(
        c,
        {
          notifications: result.notifications.map(connectNotificationToDto),
          ...(result.nextPageToken
            ? { nextPageToken: result.nextPageToken }
            : {}),
        },
        transport,
      );
    }
    case "UpdateUserNotification": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to update a notification",
          403,
        );
      }
      const notification = record(body.notification);
      return connectValue(
        c,
        connectNotificationToDto(
          await updateUserNotification(
            context.db,
            context.user,
            requiredString(notification.name, "notification.name"),
            notificationStatusFromDto(notification.status),
            fieldMaskPaths(body.updateMask),
          ),
        ),
        transport,
      );
    }
    case "DeleteUserNotification": {
      if (context.credential === "pat") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to delete a notification",
          403,
        );
      }
      await deleteUserNotification(
        context.db,
        context.user,
        requiredString(body.name, "name"),
      );
      return connectValue(c, {}, transport);
    }
    default:
      return connectErrorForTransport(
        c,
        transport,
        "unimplemented",
        `User method is not implemented: ${method}`,
        501,
      );
  }
}

async function connectInstanceMethod(
  c: ConnectContext,
  context: ConnectRequestContext,
  method: string,
  value: unknown,
  transport?: BinaryTransport,
) {
  const body = record(value);
  switch (method) {
    case "GetInstanceProfile": {
      const bootstrap = await getAuthBootstrapStatus(context.db);
      const admin = context.authUserId
        ? currentUserToDto(
            context.user,
            await getAuthUserById(context.db, context.authUserId),
          )
        : publicUserToDto(context.user);
      return connectValue(
        c,
        {
          version: "0.6.0",
          demo: false,
          instanceUrl: c.env.FLAREMO_PUBLIC_URL ?? new URL(c.req.url).origin,
          admin,
          needsSetup: bootstrap.state !== "complete",
        },
        transport,
      );
    }
    case "GetInstanceSetting": {
      const name = requiredString(body.name, "name");
      if (!context.authUserId && !isPublicInstanceSettingKey(name)) {
        return connectErrorForTransport(
          c,
          transport,
          "unauthenticated",
          "This instance setting requires authentication",
          401,
        );
      }
      return connectValue(
        c,
        await instanceSettingResponse(context, name),
        transport,
      );
    }
    case "BatchGetInstanceSettings": {
      const names = list(body.names).map((name) =>
        requiredString(name, "names[]"),
      );
      if (names.length > 20) {
        return connectErrorForTransport(
          c,
          transport,
          "invalid_argument",
          "A maximum of 20 instance settings may be requested",
          400,
        );
      }
      if (
        !context.authUserId &&
        names.some((name) => !isPublicInstanceSettingKey(name))
      ) {
        return connectErrorForTransport(
          c,
          transport,
          "unauthenticated",
          "One or more instance settings require authentication",
          401,
        );
      }
      const settings = await Promise.all(
        names.map((name) => instanceSettingResponse(context, name)),
      );
      return connectValue(c, { settings }, transport);
    }
    case "UpdateInstanceSetting": {
      if (context.credential === "pat" || context.user.role !== "owner") {
        return connectErrorForTransport(
          c,
          transport,
          "permission_denied",
          "A session credential is required to update instance settings",
          403,
        );
      }
      const setting = connectSettingRecord(body.setting);
      const name = requiredString(setting.name, "setting.name");
      const key = instanceSettingKey(name);
      await upsertStoredSetting(
        context.db,
        context.user,
        `memos.instance.${key}`,
        setting.value,
      );
      return connectValue(c, setting, transport);
    }
    case "GetInstanceStats": {
      const stats = await getMemoStats(context.db, context.user, {
        time_zone: "UTC",
      });
      return connectValue(
        c,
        {
          database: { driver: "sqlite", sizeBytes: "-1" },
          localStorageBytes: "-1",
          generatedTime: new Date().toISOString(),
          memoCount: stats.counts.total,
        },
        transport,
      );
    }
    case "TestInstanceEmailSetting":
      return connectErrorForTransport(
        c,
        transport,
        "unimplemented",
        "Email delivery is not configured on FlareMo",
        501,
      );
    default:
      return connectErrorForTransport(
        c,
        transport,
        "unimplemented",
        `Instance method is not implemented: ${method}`,
        501,
      );
  }
}

async function connectIdentityProviderMethod(
  c: ConnectContext,
  _context: ConnectRequestContext,
  method: string,
  _value: unknown,
  transport?: BinaryTransport,
) {
  if (method === "ListIdentityProviders") {
    return connectValue(c, { identityProviders: [] }, transport);
  }
  return connectErrorForTransport(
    c,
    transport,
    "unimplemented",
    "Identity providers are not configured on FlareMo",
    501,
  );
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
    totalSize: result.totalSize,
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
    totalSize: result.totalSize,
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
    requiredString(body.shareId ?? body.shareToken, "shareId"),
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

type ConnectReadContext = Awaited<ReturnType<typeof getOptionalRequestContext>>;

async function connectPublicMemoRead(
  c: ConnectContext,
  context: ConnectReadContext,
  method: string,
  value: unknown,
  transport?: BinaryTransport,
) {
  const body = record(value);
  switch (method) {
    case "ListMemos": {
      const result = await listMemosForViewer(context.db, context.user, {
        page_size: pageSize(body.pageSize),
        page_token: optionalString(body.pageToken),
        order_by: normalizeOrderBy(
          optionalString(body.orderBy) ?? "create_time desc",
        ),
        state: stateToLegacy(optionalString(body.state)),
        filter: optionalString(body.filter),
        include_deleted: body.showDeleted === true,
      });
      const memos = await Promise.all(
        result.memos.map((memo) =>
          connectPublicMemoWithDetails(context, memo.id),
        ),
      );
      return connectValue(
        c,
        {
          memos,
          ...(result.nextPageToken
            ? { nextPageToken: result.nextPageToken }
            : {}),
        },
        transport,
      );
    }
    case "GetMemo":
      return connectValue(
        c,
        await connectPublicMemoWithDetails(
          context,
          requiredString(body.name, "name"),
        ),
        transport,
      );
    case "ListMemoComments": {
      const parentName = normalizeMemoName(requiredString(body.name, "name"));
      const result = await listMemoComments(context.db, context.user, {
        memoName: parentName,
        pageSize: pageSize(body.pageSize),
        ...(optionalString(body.pageToken)
          ? { pageToken: optionalString(body.pageToken) }
          : {}),
        orderBy: optionalString(body.orderBy) ?? "create_time desc",
      });
      const memos = await Promise.all(
        result.memos.map((memo) =>
          connectPublicMemoWithDetails(context, memo.id, parentName),
        ),
      );
      return connectValue(
        c,
        {
          memos,
          totalSize: result.totalSize,
          ...(result.nextPageToken
            ? { nextPageToken: result.nextPageToken }
            : {}),
        },
        transport,
      );
    }
    case "ListMemoReactions": {
      const result = await listMemoReactions(context.db, context.user, {
        memoName: normalizeMemoName(requiredString(body.name, "name")),
        pageSize: pageSize(body.pageSize),
        ...(optionalString(body.pageToken)
          ? { pageToken: optionalString(body.pageToken) }
          : {}),
      });
      return connectValue(
        c,
        {
          reactions: result.reactions.map(currentReactionToDto),
          totalSize: result.totalSize,
          ...(result.nextPageToken
            ? { nextPageToken: result.nextPageToken }
            : {}),
        },
        transport,
      );
    }
    case "ListMemoAttachments": {
      const attachments = await listMemoAttachmentsForViewer(
        context.db,
        context.user,
        normalizeMemoName(requiredString(body.name, "name")),
      );
      return connectValue(
        c,
        { attachments: attachments.map(currentAttachmentToDto) },
        transport,
      );
    }
    case "ListMemoRelations": {
      const memoId = normalizeMemoName(requiredString(body.name, "name"));
      await getMemoByIdForViewer(context.db, context.user, memoId);
      const rows = await listMemoRelationsForViewer(
        context.db,
        context.user,
        memoId,
      );
      const relations = await Promise.all(
        rows.map(async (relation) => {
          try {
            const [relationMemo, relatedMemo] = await Promise.all([
              getMemoByIdForViewer(context.db, context.user, relation.memoId),
              getMemoByIdForViewer(
                context.db,
                context.user,
                relation.relatedMemoId,
              ),
            ]);
            return currentRelationToDto(relation, relationMemo, relatedMemo);
          } catch {
            return null;
          }
        }),
      );
      return connectValue(
        c,
        {
          relations: relations.filter(
            (relation): relation is NonNullable<typeof relation> =>
              relation !== null,
          ),
        },
        transport,
      );
    }
    default:
      return connectErrorForTransport(
        c,
        transport,
        "unimplemented",
        `Public Memos read method is not implemented: ${method}`,
        501,
      );
  }
}

async function connectPublicMemoWithDetails(
  context: ConnectReadContext,
  memoId: string,
  parent?: string,
) {
  const memo = await getMemoByIdForViewer(context.db, context.user, memoId);
  const [attachments, reactions, relationRows] = await Promise.all([
    listMemoAttachmentsForViewer(context.db, context.user, memo.id),
    listMemoReactions(context.db, context.user, memo.id, { pageSize: 1_000 }),
    listMemoRelationsForViewer(context.db, context.user, memo.id),
  ]);
  const relations = await Promise.all(
    relationRows.map(async (relation) => {
      try {
        const [relationMemo, relatedMemo] = await Promise.all([
          getMemoByIdForViewer(context.db, context.user, relation.memoId),
          getMemoByIdForViewer(
            context.db,
            context.user,
            relation.relatedMemoId,
          ),
        ]);
        return currentRelationToDto(relation, relationMemo, relatedMemo);
      } catch {
        return null;
      }
    }),
  );
  const creator = await getMemoCreatorForViewer(context, memo);
  return currentMemoToDto(memo, creator, {
    attachments,
    reactions: reactions.reactions,
    relations: relations.filter(
      (relation): relation is NonNullable<typeof relation> => relation !== null,
    ),
    ...(parent ? { parent } : {}),
  });
}

async function getMemoCreatorForViewer(
  context: ConnectReadContext,
  memo: Awaited<ReturnType<typeof getMemoByIdForViewer>>,
) {
  if (context.user?.id === memo.userId) return context.user;
  const creator = await getFlaremoUserById(context.db, memo.userId);
  if (!creator) throw new Error("Memo creator not found");
  return creator;
}

function isPublicMemoReadMethod(method: string) {
  return [
    "GetMemo",
    "ListMemos",
    "ListMemoComments",
    "ListMemoReactions",
    "ListMemoAttachments",
    "ListMemoRelations",
  ].includes(method);
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
  const rows = await listMemoRelationsForViewer(
    context.db,
    context.user,
    memo.id,
  );
  const relations = await Promise.all(
    rows.map(async (row) => {
      const [relationMemo, relatedMemo] = await Promise.all([
        getMemoById(context.db, context.user, row.memoId, {
          includeDeleted: true,
        }),
        getMemoById(context.db, context.user, row.relatedMemoId, {
          includeDeleted: true,
        }),
      ]);
      return currentRelationToDto(row, relationMemo, relatedMemo);
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
    listMemoRelationsForViewer(context.db, context.user, memo.id),
    listMemoReactions(context.db, context.user, {
      memoName: memo.id,
      pageSize: 1_000,
    }),
    getMemoParent(context.db, context.user, memo.id),
  ]);
  const relations = await Promise.all(
    rows.map(async (row) => {
      const [relationMemo, relatedMemo] = await Promise.all([
        getMemoById(context.db, context.user, row.memoId, {
          includeDeleted: true,
        }),
        getMemoById(context.db, context.user, row.relatedMemoId, {
          includeDeleted: true,
        }),
      ]);
      return currentRelationToDto(row, relationMemo, relatedMemo);
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

function normalizeAttachmentName(value: string) {
  return value.startsWith("attachments/") ? value : `attachments/${value}`;
}

async function getPublicInstanceContext(
  c: ConnectContext,
): Promise<ConnectRequestContext> {
  const db = createDb(c.env.DB);
  const user =
    (await getFlaremoUserById(db, "users/owner")) ??
    publicOwnerFallback(c.env.FLAREMO_SINGLE_USER_NAME);
  return {
    db,
    user,
    authUserId: "",
    credential: "session",
    bearerSession: false,
    nativeAccessToken: false,
    session: null,
  };
}

function publicOwnerFallback(name: string | undefined): UserRow {
  const timestamp = new Date(0).toISOString();
  return {
    id: "users/owner",
    email: "",
    name: name?.trim() || "Owner",
    avatarUrl: null,
    role: "owner",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function attachmentBytes(value: unknown) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") {
    try {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    } catch {
      throw new ConnectInputError("attachment.content must be valid base64");
    }
  }
  return new Uint8Array();
}

function fieldMaskPaths(value: unknown) {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
  }
  const paths = record(value).paths;
  return Array.isArray(paths)
    ? paths.filter(
        (path): path is string =>
          typeof path === "string" && Boolean(path.trim()),
      )
    : [];
}

function assertConnectUserPath(value: unknown, currentUserId: string) {
  const name = requiredString(value, "user");
  const normalized = name.startsWith("users/") ? name : `users/${name}`;
  if (normalized !== currentUserId) {
    throw new ConnectInputError("Only the current FlareMo user is available");
  }
}

function assertConnectUserSettingPath(value: unknown, currentUserId: string) {
  const name = requiredString(value, "setting");
  const prefix = `${currentUserId}/settings/`;
  if (!name.startsWith(prefix) || name.slice(prefix.length).includes("/")) {
    throw new ConnectInputError(
      "Only the current FlareMo user settings are available",
    );
  }
}

function assertConnectPatPath(value: unknown, currentUserId: string) {
  const name = requiredString(value, "name");
  if (!name.startsWith(`${currentUserId}/personalAccessTokens/`)) {
    throw new ConnectInputError(
      "Only the current FlareMo user's PATs are available",
    );
  }
}

function userSettingKey(name: string) {
  return name.split("/").at(-1) ?? "GENERAL";
}

async function userSettingResponse(
  context: ConnectRequestContext,
  name: string,
) {
  const key = userSettingKey(name);
  const stored = await getStoredSetting(
    context.db,
    context.user,
    `memos.user.${key}`,
  );
  return {
    name,
    value:
      stored?.value && typeof stored.value === "object"
        ? stored.value
        : { case: "generalSetting", value: {} },
  };
}

async function listConnectUserSettings(context: ConnectRequestContext) {
  const username =
    (await getAuthUserById(context.db, context.authUserId))?.username ??
    "owner";
  const generalName = `${context.user.id}/settings/GENERAL`;
  const stored = await getStoredSetting(
    context.db,
    context.user,
    "memos.user.GENERAL",
  );
  return [
    {
      name: generalName.replace(context.user.id, `users/${username}`),
      value:
        stored?.value && typeof stored.value === "object"
          ? stored.value
          : { case: "generalSetting", value: {} },
    },
  ];
}

function instanceSettingKey(name: string) {
  const key = name.split("/").at(-1)?.toUpperCase();
  if (!key || !/^[A-Z_]+$/.test(key)) {
    throw new ConnectInputError("Invalid instance setting name");
  }
  return key;
}

async function instanceSettingResponse(
  context: ConnectRequestContext,
  name: string,
) {
  if (!name.startsWith("instance/settings/")) {
    throw new ConnectInputError("Invalid instance setting name");
  }
  const key = instanceSettingKey(name);
  const stored = await getStoredSetting(
    context.db,
    context.user,
    `memos.instance.${key}`,
  );
  if (!context.authUserId) {
    return {
      name,
      value: publicInstanceSettingValue(key, stored?.value),
    };
  }
  return {
    name,
    value:
      stored?.value && typeof stored.value === "object"
        ? stored.value
        : defaultInstanceSetting(key),
  };
}

function isPublicInstanceSettingKey(name: string) {
  if (!name.startsWith("instance/settings/")) return false;
  const key = name.split("/").at(-1)?.toUpperCase();
  return key === "GENERAL" || key === "MEMO_RELATED";
}

function publicInstanceSettingValue(key: string, value: unknown) {
  const stored = record(record(value).value);
  if (key === "GENERAL") {
    return {
      case: "generalSetting",
      value: {
        disallowUserRegistration:
          typeof stored.disallowUserRegistration === "boolean"
            ? stored.disallowUserRegistration
            : true,
        disallowPasswordAuth:
          typeof stored.disallowPasswordAuth === "boolean"
            ? stored.disallowPasswordAuth
            : false,
        disallowChangeUsername:
          typeof stored.disallowChangeUsername === "boolean"
            ? stored.disallowChangeUsername
            : false,
        disallowChangeNickname:
          typeof stored.disallowChangeNickname === "boolean"
            ? stored.disallowChangeNickname
            : false,
      },
    };
  }
  if (key === "MEMO_RELATED") {
    const reactions = Array.isArray(stored.reactions)
      ? stored.reactions.filter(
          (reaction): reaction is string =>
            typeof reaction === "string" && reaction.length <= 32,
        )
      : ["👍", "❤️", "😂", "😢", "😡"];
    return {
      case: "memoRelatedSetting",
      value: {
        contentLengthLimit:
          typeof stored.contentLengthLimit === "number" &&
          Number.isSafeInteger(stored.contentLengthLimit) &&
          stored.contentLengthLimit > 0
            ? Math.min(stored.contentLengthLimit, 10_000_000)
            : 1_000_000,
        enableDoubleClickEdit:
          typeof stored.enableDoubleClickEdit === "boolean"
            ? stored.enableDoubleClickEdit
            : true,
        reactions: reactions.slice(0, 64),
      },
    };
  }
  throw new ConnectInputError("This instance setting requires authentication");
}

function defaultInstanceSetting(key: string) {
  switch (key) {
    case "GENERAL":
      return {
        case: "generalSetting",
        value: {
          disallowUserRegistration: true,
          disallowPasswordAuth: false,
          disallowChangeUsername: false,
          disallowChangeNickname: false,
        },
      };
    case "MEMO_RELATED":
      return {
        case: "memoRelatedSetting",
        value: {
          contentLengthLimit: 1_000_000,
          enableDoubleClickEdit: true,
          reactions: ["👍", "❤️", "😂", "😢", "😡"],
        },
      };
    case "STORAGE":
      return {
        case: "storageSetting",
        value: {
          storageType: "S3",
          filepathTemplate: "memos/{timestamp}_{filename}",
        },
      };
    case "NOTIFICATION":
      return {
        case: "notificationSetting",
        value: { email: { enabled: false } },
      };
    case "AI":
      return { case: "aiSetting", value: { providers: [] } };
    case "TAGS":
      return { case: "tagsSetting", value: { tags: {} } };
    default:
      throw new ConnectInputError(`Unsupported instance setting: ${key}`);
  }
}

function userStatsFromMemoStats(
  userId: string,
  stats: Awaited<ReturnType<typeof getMemoStats>>,
) {
  return {
    name: userId,
    memoTypeStats: { linkCount: 0, codeCount: 0, todoCount: 0, undoCount: 0 },
    tagCount: Object.fromEntries(
      stats.tags.map((tag) => [tag.name, tag.count]),
    ),
    totalMemoCount: stats.counts.total,
    pinnedMemos: [],
    memoCreatedTimestamps: [],
    memoUpdatedTimestamps: [],
  };
}

function connectPatToDto(
  token: {
    id: string;
    name: string | null;
    createdAt: Date;
    expiresAt: Date | null;
    lastRequest: Date | null;
  },
  userId: string,
) {
  return {
    name: `${userId}/personalAccessTokens/${token.id}`,
    ...(token.name ? { description: token.name } : {}),
    createdAt: token.createdAt.toISOString(),
    ...(token.expiresAt ? { expiresAt: token.expiresAt.toISOString() } : {}),
    ...(token.lastRequest
      ? { lastUsedAt: token.lastRequest.toISOString() }
      : {}),
  };
}

async function updateBetterAuthUsername(
  c: ConnectContext,
  context: ConnectRequestContext,
  username: string,
) {
  if (!c.req.raw.headers.get("cookie")) {
    throw new ConnectInputError(
      "A Better Auth cookie session is required to update the username",
    );
  }
  const headers = new Headers(c.req.raw.headers);
  headers.set("content-type", "application/json");
  const request = new Request(new URL("/api/auth/update-user", c.req.url), {
    method: "POST",
    headers,
    body: JSON.stringify({ username }),
  });
  const response = await createFlareMoAuth(c.env, context.db).handler(request);
  if (response.ok) return;
  let message = "Better Auth rejected the username update";
  try {
    const payload = (await response.json()) as { message?: unknown };
    if (typeof payload.message === "string" && payload.message) {
      message = payload.message;
    }
  } catch {
    // Keep the stable compatibility error when Better Auth did not return JSON.
  }
  throw new ConnectInputError(message);
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

function connectSettingRecord(value: unknown) {
  const setting = record(value);
  if (setting.value !== undefined) return setting;
  for (const caseName of [
    "generalSetting",
    "storageSetting",
    "memoRelatedSetting",
    "tagsSetting",
    "notificationSetting",
    "aiSetting",
    "webhooksSetting",
  ]) {
    if (Object.hasOwn(setting, caseName)) {
      return {
        ...setting,
        value: { case: caseName, value: setting[caseName] },
      };
    }
  }
  return setting;
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

function connectNotificationToDto(notification: UserNotificationDto) {
  const sender = notification.senderUser;
  const senderUser = {
    name: sender.id,
    role: sender.role === "owner" ? "ADMIN" : "USER",
    username: notification.senderUsername ?? sender.id.replace(/^users\//u, ""),
    email: notification.senderEmail ?? sender.email,
    displayName: sender.name,
    ...(sender.avatarUrl ? { avatarUrl: sender.avatarUrl } : {}),
    state: "NORMAL",
    createTime: sender.createdAt,
    updateTime: sender.updatedAt,
  };
  const payload = {
    memo: notification.memo,
    relatedMemo: notification.relatedMemo ?? "",
    memoSnippet: notification.memoSnippet,
    relatedMemoSnippet: notification.relatedMemoSnippet,
  };
  return {
    name: notification.name,
    sender: notification.sender,
    senderUser,
    status: notification.status === "unread" ? "UNREAD" : "ARCHIVED",
    createTime: notification.createTime,
    type:
      notification.type === "memo_comment" ? "MEMO_COMMENT" : "MEMO_MENTION",
    ...(notification.type === "memo_comment"
      ? { memoComment: payload }
      : { memoMention: payload }),
  };
}

function notificationStatusFromDto(value: unknown) {
  if (value === "UNREAD" || value === "unread") return "unread" as const;
  if (value === "ARCHIVED" || value === "archived") return "archived" as const;
  throw new ConnectInputError("notification.status must be UNREAD or ARCHIVED");
}

class ConnectInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectInputError";
  }
}

function connectJson(c: ConnectContext, value: unknown) {
  const normalized = normalizeMemosJsonResponse(
    c.req.param("service") ?? "",
    c.req.param("method") ?? "",
    value,
  );
  return c.json(normalized, 200, { "content-type": "application/json" });
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
    if (isBetterAuthCredentialError(error)) {
      return transport
        ? connectErrorForTransport(
            c,
            transport,
            "invalid_argument",
            "unmatched username and password",
            400,
          )
        : connectError(
            c,
            "invalid_argument",
            "unmatched username and password",
            400,
          );
    }
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
    const bearer = c.req.header("authorization");
    if (context.bearerSession && bearer) {
      await revokeAuthSessionByToken(context.db, parseBearerForSignOut(bearer));
    }
    if (c.req.raw.headers.get("cookie")) {
      const headers = new Headers(c.req.raw.headers);
      headers.delete("authorization");
      const authResponse = await createFlareMoAuth(c.env, context.db).handler(
        new Request(new URL("/api/auth/sign-out", c.req.url), {
          method: "POST",
          headers,
        }),
      );
      copyResponseHeaders(response.headers, authResponse.headers);
    }
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
    // Better Auth returns a JSON representation for its sign-out/sign-in
    // handler. The Connect adapter has already selected the protobuf
    // representation, so copying representation headers would make a valid
    // binary response undecodable by generated clients (especially an empty
    // google.protobuf.Empty response).
    else if (name === "content-type" || name === "content-length") continue;
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
  return new Response(
    encodeBinaryError(message, transport, grpcStatusForCode(code)),
    {
      status,
      headers,
    },
  );
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

function isBetterAuthCredentialError(error: unknown) {
  const value = record(error);
  return value.code === "INVALID_USERNAME_OR_PASSWORD";
}

function parseBearerForSignOut(value: string) {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer" || !parts[1]) {
    throw new ConnectInputError("Invalid authorization header");
  }
  return parts[1];
}
