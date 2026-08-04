import {
  authUserLinks,
  authUsers,
  type FlareMoDb,
  type MemosNotificationRow,
  type MemosWebhookRow,
  memos,
  memosNotifications,
  memosWebhooks,
  type UserRow,
  users,
} from "@flaremo/db";
import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";

const MAX_NOTIFICATION_PAGE_SIZE = 1_000;
const MAX_WEBHOOK_DISPLAY_NAME_LENGTH = 256;
const MAX_WEBHOOK_URL_LENGTH = 2_048;

export type UserWebhookDto = {
  name: string;
  url: string;
  displayName: string;
  createTime: string;
  updateTime: string;
  signingSecretSet: boolean;
};

export type CreateUserWebhookInput = {
  url: string;
  displayName?: string;
  signingSecret?: string;
};

export type UpdateUserWebhookInput = {
  name: string;
  url?: string;
  displayName?: string;
  signingSecret?: string;
  updateMask?: string[];
};

export type UserNotificationType = "memo_comment" | "memo_mention";
export type UserNotificationStatus = "unread" | "archived";

export type UserNotificationDto = {
  name: string;
  sender: string;
  senderUser: UserRow;
  senderUsername?: string | null;
  senderEmail?: string | null;
  status: UserNotificationStatus;
  createTime: string;
  type: UserNotificationType;
  memo: string;
  relatedMemo?: string;
  memoSnippet: string;
  relatedMemoSnippet: string;
};

export type ListUserNotificationsInput = {
  pageSize?: number;
  pageToken?: string;
  filter?: string;
};

export type ListUserNotificationsResult = {
  notifications: UserNotificationDto[];
  nextPageToken?: string;
};

export type CreateMemoNotificationInput = {
  receiverId: string;
  senderId: string;
  type: UserNotificationType;
  sourceEventId: string;
  memoId: string;
  relatedMemoId?: string | null;
  createdAt?: string;
};

type NotificationWithSender = {
  notification: MemosNotificationRow;
  sender: UserRow;
  senderUsername: string | null;
  senderEmail: string | null;
};

type NotificationCursor = {
  createdAt: string;
  id: number;
};

export function userWebhookName(user: UserRow, id: string) {
  return `${user.id}/webhooks/${id}`;
}

export function userNotificationName(user: UserRow, id: string) {
  return `${user.id}/notifications/${id}`;
}

export async function listUserWebhooks(
  db: FlareMoDb,
  user: UserRow,
): Promise<UserWebhookDto[]> {
  const rows = await db
    .select()
    .from(memosWebhooks)
    .where(eq(memosWebhooks.userId, user.id))
    .orderBy(asc(memosWebhooks.createdAt), asc(memosWebhooks.id));
  return rows.map((row) => userWebhookToDto(user, row));
}

export async function createUserWebhook(
  db: FlareMoDb,
  user: UserRow,
  input: CreateUserWebhookInput,
): Promise<UserWebhookDto> {
  const url = validateWebhookUrl(input.url);
  const displayName = validateWebhookDisplayName(input.displayName ?? "");
  const signingSecret = normalizeSigningSecret(input.signingSecret, true);
  const now = new Date().toISOString();
  const row = {
    id: createWebhookId(),
    userId: user.id,
    url,
    displayName,
    signingSecret,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.insert(memosWebhooks).values(row);
  } catch (error) {
    // UUID collisions are extraordinarily unlikely, but a retryable conflict
    // is clearer to a caller than returning a partially formed resource.
    throw new ConflictError(
      `Failed to create webhook: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return userWebhookToDto(user, row);
}

export async function updateUserWebhook(
  db: FlareMoDb,
  user: UserRow,
  input: UpdateUserWebhookInput,
): Promise<UserWebhookDto> {
  const id = parseUserChildResourceName(input.name, user, "webhooks");
  const existing = await getWebhookRow(db, user, id);
  if (!existing) throw new NotFoundError("Webhook not found");
  const updateMask = normalizeUpdateMask(input.updateMask);
  const fields = updateMask ?? ["url", "display_name", "signing_secret"];
  const updates: Partial<
    Pick<MemosWebhookRow, "url" | "displayName" | "signingSecret">
  > = {};

  for (const field of fields) {
    switch (field) {
      case "url":
        updates.url = validateWebhookUrl(input.url ?? existing.url);
        break;
      case "display_name":
        updates.displayName = validateWebhookDisplayName(
          input.displayName ?? existing.displayName,
        );
        break;
      case "signing_secret":
        updates.signingSecret = normalizeSigningSecret(
          input.signingSecret,
          false,
        );
        break;
      default:
        throw new ValidationError(`Unsupported webhook update field: ${field}`);
    }
  }

  const updatedAt = new Date().toISOString();
  await db
    .update(memosWebhooks)
    .set({ ...updates, updatedAt })
    .where(
      and(eq(memosWebhooks.id, existing.id), eq(memosWebhooks.userId, user.id)),
    );
  const updated = await getWebhookRow(db, user, id);
  if (!updated) throw new NotFoundError("Webhook not found after update");
  return userWebhookToDto(user, updated);
}

export async function deleteUserWebhook(
  db: FlareMoDb,
  user: UserRow,
  name: string,
): Promise<void> {
  const id = parseUserChildResourceName(name, user, "webhooks");
  const deleted = await db
    .delete(memosWebhooks)
    .where(and(eq(memosWebhooks.id, id), eq(memosWebhooks.userId, user.id)))
    .returning({ id: memosWebhooks.id });
  if (!deleted[0]) throw new NotFoundError("Webhook not found");
}

export async function getUserWebhookSigningSecret(
  db: FlareMoDb,
  user: UserRow,
  name: string,
): Promise<string> {
  const id = parseUserChildResourceName(name, user, "webhooks");
  const row = await getWebhookRow(db, user, id);
  if (!row) throw new NotFoundError("Webhook not found");
  return row.signingSecret;
}

export async function listUserNotifications(
  db: FlareMoDb,
  user: UserRow,
  input: ListUserNotificationsInput = {},
): Promise<ListUserNotificationsResult> {
  const limit = normalizeNotificationPageSize(input.pageSize);
  const filter = parseNotificationFilter(input.filter);
  const cursor = input.pageToken
    ? decodeNotificationPageToken(input.pageToken)
    : undefined;
  const filters = [eq(memosNotifications.receiverId, user.id)];
  if (filter.status) filters.push(eq(memosNotifications.status, filter.status));
  if (filter.type) filters.push(eq(memosNotifications.type, filter.type));
  if (cursor) {
    const cursorFilter = or(
      lt(memosNotifications.createdAt, cursor.createdAt),
      and(
        eq(memosNotifications.createdAt, cursor.createdAt),
        lt(memosNotifications.id, cursor.id),
      ),
    );
    if (cursorFilter) filters.push(cursorFilter);
  }

  const rows = await selectNotifications(db, and(...filters));
  const page: UserNotificationDto[] = [];
  let scanned = 0;
  let lastScanned: NotificationWithSender | undefined;
  for (const row of rows) {
    scanned += 1;
    lastScanned = row;
    const dto = await notificationToDto(db, user, row);
    if (dto) page.push(dto);
    if (page.length >= limit) break;
  }
  const next = lastScanned && scanned < rows.length ? lastScanned : undefined;
  return {
    notifications: page,
    ...(next
      ? {
          nextPageToken: encodeNotificationPageToken({
            createdAt: next.notification.createdAt,
            id: next.notification.id,
          }),
        }
      : {}),
  };
}

export async function updateUserNotification(
  db: FlareMoDb,
  user: UserRow,
  name: string,
  status: UserNotificationStatus,
  updateMask?: string[],
): Promise<UserNotificationDto> {
  const id = parseNotificationResourceId(name, user);
  const fields = normalizeNotificationUpdateMask(updateMask);
  if (fields.length !== 1 || fields[0] !== "status") {
    throw new ValidationError("Only the notification status may be updated");
  }
  if (status !== "unread" && status !== "archived") {
    throw new ValidationError("Notification status must be unread or archived");
  }
  const updated = await db
    .update(memosNotifications)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(memosNotifications.id, id),
        eq(memosNotifications.receiverId, user.id),
      ),
    )
    .returning({ id: memosNotifications.id });
  if (!updated[0]) throw new NotFoundError("Notification not found");
  const row = await getNotification(db, user, id);
  if (!row) throw new NotFoundError("Notification not found after update");
  const dto = await notificationToDto(db, user, row);
  if (!dto) throw new NotFoundError("Notification is no longer visible");
  return dto;
}

export async function deleteUserNotification(
  db: FlareMoDb,
  user: UserRow,
  name: string,
): Promise<void> {
  const id = parseNotificationResourceId(name, user);
  const deleted = await db
    .delete(memosNotifications)
    .where(
      and(
        eq(memosNotifications.id, id),
        eq(memosNotifications.receiverId, user.id),
      ),
    )
    .returning({ id: memosNotifications.id });
  if (!deleted[0]) throw new NotFoundError("Notification not found");
}

/**
 * Build an inbox insert for a memo mutation. The caller can include this
 * statement in the same D1 batch as the memo and its SSE event, preserving
 * the atomicity boundary of comment creation.
 */
export function insertMemoNotification(
  db: FlareMoDb,
  input: CreateMemoNotificationInput,
) {
  const now = input.createdAt ?? new Date().toISOString();
  return db
    .insert(memosNotifications)
    .values({
      receiverId: input.receiverId,
      senderId: input.senderId,
      type: input.type,
      status: "unread",
      sourceEventId: input.sourceEventId,
      memoId: input.memoId,
      relatedMemoId: input.relatedMemoId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        memosNotifications.receiverId,
        memosNotifications.sourceEventId,
        memosNotifications.type,
      ],
    });
}

/** Resolve @username mentions to linked FlareMo users. */
export async function findMentionedUsers(
  db: FlareMoDb,
  content: string,
  excludedUserIds: string[] = [],
): Promise<UserRow[]> {
  const usernames = [
    ...new Set(
      [
        ...content.matchAll(
          /(^|[^\p{L}\p{N}_])@([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gu,
        ),
      ]
        .map((match) => match[2])
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (usernames.length === 0) return [];
  const rows = await db
    .select({ user: users, username: authUsers.username })
    .from(authUsers)
    .innerJoin(authUserLinks, eq(authUserLinks.authUserId, authUsers.id))
    .innerJoin(users, eq(users.id, authUserLinks.flaremoUserId))
    .where(inArray(authUsers.username, usernames));
  return rows
    .filter((row) => row.username && !excludedUserIds.includes(row.user.id))
    .map((row) => row.user);
}

function userWebhookToDto(user: UserRow, row: MemosWebhookRow): UserWebhookDto {
  return {
    name: userWebhookName(user, row.id),
    url: row.url,
    displayName: row.displayName,
    createTime: row.createdAt,
    updateTime: row.updatedAt,
    signingSecretSet: row.signingSecret.length > 0,
  };
}

async function getWebhookRow(
  db: FlareMoDb,
  user: UserRow,
  id: string,
): Promise<MemosWebhookRow | undefined> {
  return (
    (await db
      .select()
      .from(memosWebhooks)
      .where(and(eq(memosWebhooks.id, id), eq(memosWebhooks.userId, user.id)))
      .get()) ?? undefined
  );
}

async function selectNotifications(
  db: FlareMoDb,
  where: ReturnType<typeof and>,
): Promise<NotificationWithSender[]> {
  return db
    .select({
      notification: memosNotifications,
      sender: users,
      senderUsername: authUsers.username,
      senderEmail: authUsers.email,
    })
    .from(memosNotifications)
    .innerJoin(users, eq(users.id, memosNotifications.senderId))
    .leftJoin(authUserLinks, eq(authUserLinks.flaremoUserId, users.id))
    .leftJoin(authUsers, eq(authUsers.id, authUserLinks.authUserId))
    .where(where)
    .orderBy(desc(memosNotifications.createdAt), desc(memosNotifications.id))
    .limit(MAX_NOTIFICATION_PAGE_SIZE + 1);
}

async function getNotification(
  db: FlareMoDb,
  user: UserRow,
  id: number,
): Promise<NotificationWithSender | undefined> {
  return (
    (
      await selectNotifications(
        db,
        and(
          eq(memosNotifications.id, id),
          eq(memosNotifications.receiverId, user.id),
        ),
      )
    )[0] ?? undefined
  );
}

async function notificationToDto(
  db: FlareMoDb,
  user: UserRow,
  row: NotificationWithSender,
): Promise<UserNotificationDto | undefined> {
  const notification = row.notification;
  const memo = await db.query.memos.findFirst({
    where: eq(memos.id, notification.memoId),
  });
  if (!memo || !canReadNotificationMemo(user, memo)) return undefined;
  const relatedMemo = notification.relatedMemoId
    ? await db.query.memos.findFirst({
        where: eq(memos.id, notification.relatedMemoId),
      })
    : undefined;
  if (
    notification.relatedMemoId &&
    (!relatedMemo || !canReadNotificationMemo(user, relatedMemo))
  ) {
    return undefined;
  }
  return {
    name: `${notification.receiverId}/notifications/${notification.id}`,
    sender: row.sender.id,
    senderUser: row.sender,
    senderUsername: row.senderUsername,
    senderEmail: row.senderEmail,
    status: notification.status,
    createTime: notification.createdAt,
    type: notification.type,
    memo: notification.memoId,
    ...(notification.relatedMemoId
      ? { relatedMemo: notification.relatedMemoId }
      : {}),
    memoSnippet: notificationSnippet(memo.content),
    relatedMemoSnippet: relatedMemo
      ? notificationSnippet(relatedMemo.content)
      : "",
  };
}

function canReadNotificationMemo(
  user: UserRow,
  memo: { userId: string; visibility: string },
) {
  if (memo.visibility === "private") return memo.userId === user.id;
  // Protected and public memos are readable by an authenticated notification
  // owner. The broader multi-user memo ACL remains a separate tranche.
  return memo.visibility === "protected" || memo.visibility === "public";
}

function notificationSnippet(content: string) {
  const normalized = content.replace(/\s+/gu, " ").trim();
  return normalized.length > 200
    ? `${normalized.slice(0, 197)}...`
    : normalized;
}

function parseUserChildResourceName(
  name: string,
  user: UserRow,
  collection: "webhooks" | "notifications",
) {
  const parts = name.split("/").filter(Boolean);
  const userParts = user.id.split("/").filter(Boolean);
  if (
    parts.length !== 4 ||
    parts[0] !== "users" ||
    parts[2] !== collection ||
    !parts[3]
  ) {
    throw new ValidationError(`Invalid ${collection} resource name`);
  }
  if (parts[1] !== userParts[1]) {
    throw new ForbiddenError(
      `Only the current user's ${collection} are available`,
    );
  }
  return parts[3];
}

function parseNotificationResourceId(name: string, user: UserRow) {
  const value = parseUserChildResourceName(name, user, "notifications");
  if (!/^\d+$/u.test(value)) {
    throw new ValidationError("Invalid notification name");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new ValidationError("Invalid notification name");
  }
  return id;
}

function validateWebhookUrl(value: string) {
  const url = value.trim();
  if (!url || url.length > MAX_WEBHOOK_URL_LENGTH) {
    throw new ValidationError(
      "Webhook URL is required and must be <= 2048 characters",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(
      "Webhook URL must be an absolute http or https URL",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("Webhook URL must use http or https");
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    throw new ValidationError(
      "Webhook URL contains unsupported credentials or fragment",
    );
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isReservedIpLiteral(hostname)
  ) {
    throw new ValidationError(
      "Webhook URL must not target a local or private host",
    );
  }
  return url;
}

function isReservedIpLiteral(hostname: string) {
  if (hostname.includes(":")) {
    return (
      hostname === "::" ||
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe8") ||
      hostname.startsWith("fe9") ||
      hostname.startsWith("fea") ||
      hostname.startsWith("feb")
    );
  }
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }
  const first = Number(parts[0]);
  const second = Number(parts[1]);
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function validateWebhookDisplayName(value: string) {
  const displayName = value.trim();
  if (displayName.length > MAX_WEBHOOK_DISPLAY_NAME_LENGTH) {
    throw new ValidationError("Webhook display name is too long");
  }
  return displayName;
}

function normalizeSigningSecret(value: string | undefined, generate: boolean) {
  const secret = value?.trim() ?? "";
  if (!secret && generate) return generateSigningSecret();
  if (
    secret.length > 512 ||
    [...secret].some((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f || codePoint > 0x7e;
    })
  ) {
    throw new ValidationError(
      "Webhook signing secret contains invalid characters",
    );
  }
  if (secret.startsWith("whsec_")) {
    const encoded = secret.slice("whsec_".length);
    if (
      !encoded ||
      encoded.length % 4 === 1 ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)
    ) {
      throw new ValidationError(
        "Webhook signing secret has invalid whsec_ encoding",
      );
    }
    try {
      if (atob(encoded).length < 24) {
        throw new Error("too short");
      }
    } catch {
      throw new ValidationError(
        "Webhook signing secret has invalid whsec_ encoding",
      );
    }
  }
  return secret;
}

function generateSigningSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `whsec_${btoa(binary)}`;
}

function createWebhookId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function normalizeUpdateMask(value: string[] | undefined) {
  if (!value || value.length === 0) return undefined;
  return value.map((field) => {
    const normalized = field
      .trim()
      .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (!["url", "display_name", "signing_secret"].includes(normalized)) {
      throw new ValidationError(`Unsupported webhook update field: ${field}`);
    }
    return normalized as "url" | "display_name" | "signing_secret";
  });
}

function normalizeNotificationPageSize(value: number | undefined) {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError(
      "Notification page size must be a positive integer",
    );
  }
  return Math.min(value, MAX_NOTIFICATION_PAGE_SIZE);
}

function parseNotificationFilter(value: string | undefined) {
  const filter = value?.trim() ?? "";
  if (!filter)
    return {} as {
      status?: UserNotificationStatus;
      type?: UserNotificationType;
    };
  const result: {
    status?: UserNotificationStatus;
    type?: UserNotificationType;
  } = {};
  for (const term of filter.split(/\s+&&\s+/u)) {
    const match = term.match(
      /^\s*(status|type)\s*==\s*["']?([A-Z_]+)["']?\s*$/u,
    );
    if (!match) throw new ValidationError("Unsupported notification filter");
    if (match[1] === "status") {
      if (match[2] === "UNREAD") result.status = "unread";
      else if (match[2] === "ARCHIVED") result.status = "archived";
      else throw new ValidationError("Unsupported notification status filter");
    } else if (match[2] === "MEMO_COMMENT") {
      result.type = "memo_comment";
    } else if (match[2] === "MEMO_MENTION") {
      result.type = "memo_mention";
    } else {
      throw new ValidationError("Unsupported notification type filter");
    }
  }
  return result;
}

function encodeNotificationPageToken(cursor: NotificationCursor) {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function decodeNotificationPageToken(value: string): NotificationCursor {
  try {
    const padded = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const decoded = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)),
      ),
    ) as Partial<NotificationCursor>;
    if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "number")
      throw new Error("invalid cursor");
    return { createdAt: decoded.createdAt, id: decoded.id };
  } catch {
    throw new ValidationError("Invalid notification page token");
  }
}

function normalizeNotificationUpdateMask(value: string[] | undefined) {
  if (!value || value.length === 0) {
    throw new ValidationError("Notification updateMask is required");
  }
  return value.map((field) => {
    const normalized = field
      .trim()
      .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (normalized !== "status")
      throw new ValidationError(
        `Unsupported notification update field: ${field}`,
      );
    return normalized;
  });
}
