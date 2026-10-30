import {
  authMembers,
  authOrganizations,
  authUserLinks,
  authUsers,
  type FlareMoDb,
  type MemosNotificationRow,
  memos,
  memosNotifications,
  type UserRow,
  users,
} from "@flaremo/db";
import { and, desc, eq, inArray, lt, notInArray, or } from "drizzle-orm";
import { isMembershipActive } from "./auth";
import { chunkForD1, d1IdsPerStatement } from "./d1-limits";
import { NotFoundError, ValidationError } from "./errors";
import { parseUserChildResourceName } from "./memos-user-shared";
import {
  canReadMemo,
  type TeamRole,
  type TeamViewer,
} from "./team-permissions";
import { DEFAULT_TEAM_SLUG } from "./users";

const MAX_NOTIFICATION_PAGE_SIZE = 1_000;

export type UserNotificationType =
  | "memo_comment"
  | "memo_mention"
  | "daily_review"
  | "task_overdue"
  | "task_due";
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
  // Task-overdue rows have no memo anchor.
  memo: string | null;
  relatedMemo?: string;
  memoSnippet: string;
  relatedMemoSnippet: string;
};

export type ListUserNotificationsInput = {
  pageSize?: number;
  pageToken?: string;
  filter?: string;
  // FlareMo-only notification kinds (e.g. daily_review) have no upstream
  // Memos type mapping; compatible surfaces exclude them at the SQL level so
  // pagination stays correct and clients never see an unknown type.
  excludeTypes?: UserNotificationType[];
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
  /** Memo anchor, required for memo events; task events carry a snippet. */
  memoId?: string | null;
  relatedMemoId?: string | null;
  /** Task-overdue rows store the task title here (reusing memo_id storage). */
  snippet?: string | null;
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

export function userNotificationName(user: UserRow, id: string) {
  return `${user.id}/notifications/${id}`;
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
  if (input.excludeTypes && input.excludeTypes.length > 0) {
    filters.push(notInArray(memosNotifications.type, input.excludeTypes));
  }
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

  // Batch-prefetch every memo the page may reference (one query instead of
  // up to two point lookups per row), then build DTOs from the map.
  //
  // The window does not have to be the whole 1000-row maximum: the page is
  // usually 50 rows, and joining senders for 1001 rows to render 50 was the
  // dominant cost of opening the inbox. Four rows per requested row leaves
  // headroom for DTO-level filtering without re-reading the deep history.
  const windowSize = Math.min(
    MAX_NOTIFICATION_PAGE_SIZE + 1,
    Math.max(limit * 4, 60) + 1,
  );
  const rows = await selectNotifications(db, and(...filters), windowSize);
  const memoById = new Map<string, typeof memos.$inferSelect>();
  await prefetchNotificationMemos(
    db,
    memoById,
    rows.map((row) => row.notification),
  );

  const page: UserNotificationDto[] = [];
  let scanned = 0;
  let lastScanned: NotificationWithSender | undefined;
  for (const row of rows) {
    scanned += 1;
    lastScanned = row;
    const dto = notificationToDto(user, row, memoById);
    if (dto) page.push(dto);
    if (page.length >= limit) break;
  }
  // Rows can be filtered out at DTO time (memo deleted or no longer
  // readable). When the scan window runs out before the page is full, keep
  // pulling further windows so filtered rows do not silently truncate the
  // notification stream.
  let cursorState = cursor;
  while (
    page.length < limit &&
    scanned >= rows.length &&
    rows.length === windowSize &&
    lastScanned
  ) {
    cursorState = {
      createdAt: lastScanned.notification.createdAt,
      id: lastScanned.notification.id,
    };
    const windowFilters = [
      eq(memosNotifications.receiverId, user.id),
      ...(input.excludeTypes && input.excludeTypes.length > 0
        ? [notInArray(memosNotifications.type, input.excludeTypes)]
        : []),
      ...(filter.status ? [eq(memosNotifications.status, filter.status)] : []),
      ...(filter.type ? [eq(memosNotifications.type, filter.type)] : []),
      or(
        lt(memosNotifications.createdAt, cursorState.createdAt),
        and(
          eq(memosNotifications.createdAt, cursorState.createdAt),
          lt(memosNotifications.id, cursorState.id),
        ),
      ),
    ];
    const more = await selectNotifications(
      db,
      and(...windowFilters),
      windowSize,
    );
    await prefetchNotificationMemos(
      db,
      memoById,
      more.map((row) => row.notification),
    );
    for (const row of more) {
      scanned += 1;
      lastScanned = row;
      const dto = notificationToDto(user, row, memoById);
      if (dto) page.push(dto);
      if (page.length >= limit) break;
    }
    if (more.length === 0) break;
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
  const memo = row.notification.memoId
    ? await db.query.memos.findFirst({
        where: eq(memos.id, row.notification.memoId),
      })
    : undefined;
  const relatedMemo = row.notification.relatedMemoId
    ? await db.query.memos.findFirst({
        where: eq(memos.id, row.notification.relatedMemoId),
      })
    : undefined;
  const memoById = new Map(
    [...(memo ? [memo] : []), ...(relatedMemo ? [relatedMemo] : [])].map(
      (item) => [item.id, item] as const,
    ),
  );
  const dto = notificationToDto(user, row, memoById);
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
      memoId: input.snippet ? null : (input.memoId ?? null),
      relatedMemoId: input.relatedMemoId ?? null,
      // Task-overdue rows carry the task title instead of a memo anchor.
      snippet: input.snippet ?? null,
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
): Promise<TeamViewer[]> {
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
  // D1 caps a single statement at 100 bound parameters; chunk the lookup so a
  // mention-heavy memo fails with a validation error, never a query limit.
  const rows = [];
  for (let offset = 0; offset < usernames.length; offset += 90) {
    rows.push(
      ...(await db
        .select({
          user: users,
          username: authUsers.username,
          role: authMembers.role,
          expiresAt: authMembers.expiresAt,
          organizationId: authOrganizations.id,
        })
        .from(authUsers)
        .innerJoin(authUserLinks, eq(authUserLinks.authUserId, authUsers.id))
        .innerJoin(users, eq(users.id, authUserLinks.flaremoUserId))
        // The team membership travels with the user: the caller checks read
        // access on a team memo, and a bare user row reads as "not a member",
        // which silently dropped every team mention.
        .leftJoin(
          authOrganizations,
          eq(authOrganizations.slug, DEFAULT_TEAM_SLUG),
        )
        .leftJoin(
          authMembers,
          and(
            eq(authMembers.userId, authUsers.id),
            eq(authMembers.organizationId, authOrganizations.id),
          ),
        )
        .where(
          inArray(authUsers.username, usernames.slice(offset, offset + 90)),
        )),
    );
  }
  const seen = new Set<string>();
  const result = [];
  for (const row of rows) {
    if (!row.username || excludedUserIds.includes(row.user.id)) continue;
    if (seen.has(row.user.id)) continue;
    seen.add(row.user.id);
    const role = (row.role ?? null) as TeamRole | null;
    const active = role && isMembershipActive(role, row.expiresAt ?? null);
    result.push({
      ...row.user,
      teamRole: active ? role : null,
      teamOrganizationId: active ? (row.organizationId ?? null) : null,
    });
  }
  return result;
}

async function selectNotifications(
  db: FlareMoDb,
  where: ReturnType<typeof and>,
  windowSize: number = MAX_NOTIFICATION_PAGE_SIZE + 1,
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
    .limit(windowSize);
}

/**
 * Fill `memoById` with every memo a notification window points at. The window
 * can carry two ids per row (up to 2000 bindings if the inbox window is at its
 * maximum), so the ids are chunked before they reach D1.
 */
async function prefetchNotificationMemos(
  db: FlareMoDb,
  memoById: Map<string, typeof memos.$inferSelect>,
  notifications: readonly MemosNotificationRow[],
) {
  const missing = new Set<string>();
  for (const notification of notifications) {
    if (notification.memoId && !memoById.has(notification.memoId)) {
      missing.add(notification.memoId);
    }
    if (
      notification.relatedMemoId &&
      !memoById.has(notification.relatedMemoId)
    ) {
      missing.add(notification.relatedMemoId);
    }
  }
  for (const idChunk of chunkForD1([...missing], d1IdsPerStatement())) {
    const rows = await db
      .select()
      .from(memos)
      .where(inArray(memos.id, idChunk));
    for (const memo of rows) memoById.set(memo.id, memo);
  }
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

function notificationToDto(
  user: UserRow,
  row: NotificationWithSender,
  memoById: Map<string, typeof memos.$inferSelect>,
): UserNotificationDto | undefined {
  const notification = row.notification;
  // Task-overdue rows carry a title snippet instead of a memo anchor.
  if (
    notification.type === "task_overdue" ||
    notification.type === "task_due"
  ) {
    return {
      name: `${notification.receiverId}/notifications/${notification.id}`,
      sender: row.sender.id,
      senderUser: row.sender,
      senderUsername: row.senderUsername,
      senderEmail: row.senderEmail,
      status: notification.status,
      createTime: notification.createdAt,
      type: notification.type,
      memo: null,
      memoSnippet: notification.snippet ?? "",
      relatedMemoSnippet: "",
    };
  }
  const memo = notification.memoId
    ? memoById.get(notification.memoId)
    : undefined;
  if (!memo || !canReadNotificationMemo(user, memo)) return undefined;
  const relatedMemo = notification.relatedMemoId
    ? memoById.get(notification.relatedMemoId)
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

/**
 * Notification visibility mirrors the memo read boundary: private memos stay
 * author-only and team memos are readable only inside their organization, so
 * a mention in someone else's protected memo can never leak a content
 * snippet across organizations.
 */
function canReadNotificationMemo(
  user: UserRow,
  memo: {
    userId: string;
    visibility: string;
    teamId: string | null;
    status: string;
  },
) {
  return canReadMemo(
    user,
    memo as unknown as Parameters<typeof canReadMemo>[1],
  );
}

function notificationSnippet(content: string) {
  const normalized = content.replace(/\s+/gu, " ").trim();
  return normalized.length > 200
    ? `${normalized.slice(0, 197)}...`
    : normalized;
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

/**
 * The people a team member can @mention: active members of the deployment
 * team, as username and display name only (never emails). Empty for a
 * viewer outside the team, since a mention can only reach someone who reads
 * the same team space.
 */
export async function listMentionableTeamMembers(
  db: FlareMoDb,
  viewer: TeamViewer,
): Promise<{ username: string; displayName: string }[]> {
  if (!viewer.teamRole) return [];
  const rows = await db
    .select({
      userId: users.id,
      username: authUsers.username,
      name: authUsers.name,
      role: authMembers.role,
      expiresAt: authMembers.expiresAt,
    })
    .from(authMembers)
    .innerJoin(
      authOrganizations,
      and(
        eq(authOrganizations.id, authMembers.organizationId),
        eq(authOrganizations.slug, DEFAULT_TEAM_SLUG),
      ),
    )
    .innerJoin(authUsers, eq(authUsers.id, authMembers.userId))
    .innerJoin(authUserLinks, eq(authUserLinks.authUserId, authUsers.id))
    .innerJoin(users, eq(users.id, authUserLinks.flaremoUserId));
  return rows
    .filter(
      (row) =>
        row.username &&
        row.userId !== viewer.id &&
        isMembershipActive(row.role as TeamRole, row.expiresAt ?? null),
    )
    .map((row) => ({
      username: row.username as string,
      displayName: row.name || (row.username as string),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
