import {
  deleteUserNotification,
  listUserNotifications,
  memosWireRole,
  type UserNotificationDto,
  updateUserNotification,
} from "@flaremo/domain";
import { CompatValidationError } from "../../../memos-compat/errors";
import {
  fieldMaskPaths,
  optionalString,
  pageSize,
  record,
  requiredString,
} from "../shared";
import { connectErrorForTransport, connectValue } from "../transport";
import { assertConnectUserPath, type ConnectUserMethodInput } from "./shared";

/**
 * The notification surface: listing is path-checked, every mutation needs a
 * session, and FlareMo-only kinds stay invisible to third-party clients.
 */
export async function connectUserNotificationMethod(
  input: ConnectUserMethodInput,
  method: string,
) {
  const { c, context, body, transport } = input;
  switch (method) {
    case "ListUserNotifications": {
      assertConnectUserPath(body.parent, context.user.id);
      const result = await listUserNotifications(context.db, context.user, {
        pageSize:
          body.pageSize === undefined ? undefined : pageSize(body.pageSize),
        pageToken: optionalString(body.pageToken),
        filter: optionalString(body.filter),
        // FlareMo-only kinds such as daily_review have no upstream Memos type
        // mapping; hide them from third-party clients entirely.
        excludeTypes: ["daily_review", "task_overdue", "task_due"],
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
  }
}

function connectNotificationToDto(notification: UserNotificationDto) {
  const sender = notification.senderUser;
  const senderUser = {
    name: sender.id,
    role: memosWireRole(sender),
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
  throw new CompatValidationError(
    "notification.status must be UNREAD or ARCHIVED",
  );
}
