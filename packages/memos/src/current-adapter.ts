import type {
  AttachmentRow,
  AuthUserRow,
  MemoRow,
  ReactionRow,
  ShareRow,
  ShortcutRow,
  UserRow,
} from "@flaremo/db";

type CurrentMemoRelationRow = {
  memoId: string;
  relatedMemoId: string;
  type: "reference" | "comment";
  createdAt: string;
};

export type CurrentMemoRelation = {
  memo: { name: string; snippet?: string };
  relatedMemo: { name: string; snippet?: string };
  type: "TYPE_UNSPECIFIED" | "REFERENCE" | "COMMENT";
};

export function currentMemoToDto(
  memo: MemoRow,
  user: UserRow,
  options: {
    attachments?: AttachmentRow[];
    relations?: CurrentMemoRelation[];
    reactions?: ReactionRow[];
    parent?: string | null;
  } = {},
) {
  const payload = isRecord(memo.payload) ? memo.payload : {};
  const property = currentProperty(payload.property);
  const location = currentLocation(payload.location);

  return {
    name: memo.id,
    state: currentMemoState(memo.status),
    creator: user.id,
    createTime: memo.createdAt,
    updateTime: memo.updatedAt,
    content: memo.content,
    visibility: currentVisibility(memo.visibility),
    tags: Array.isArray(payload.tags)
      ? payload.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    pinned: memo.pinned,
    ...(options.attachments
      ? { attachments: options.attachments.map(currentAttachmentToDto) }
      : {}),
    ...(options.relations ? { relations: options.relations } : {}),
    reactions: (options.reactions ?? []).map(currentReactionToDto),
    ...(property ? { property } : {}),
    ...(options.parent ? { parent: options.parent } : {}),
    snippet: memoSnippet(memo.content),
    ...(location ? { location } : {}),
  };
}

export function currentMemosToListResponse(input: {
  memos: MemoRow[];
  user: UserRow;
  attachmentsByMemo?: ReadonlyMap<string, AttachmentRow[]>;
  reactionsByMemo?: ReadonlyMap<string, ReactionRow[]>;
  parentsByMemo?: ReadonlyMap<string, string>;
  nextPageToken?: string;
}) {
  return {
    memos: input.memos.map((memo) =>
      currentMemoToDto(memo, input.user, {
        ...(input.attachmentsByMemo
          ? { attachments: input.attachmentsByMemo.get(memo.id) ?? [] }
          : {}),
        ...(input.reactionsByMemo
          ? { reactions: input.reactionsByMemo.get(memo.id) ?? [] }
          : {}),
        ...(input.parentsByMemo
          ? { parent: input.parentsByMemo.get(memo.id) }
          : {}),
      }),
    ),
    ...(input.nextPageToken ? { nextPageToken: input.nextPageToken } : {}),
  };
}

export function currentMemoCommentsToListResponse(input: {
  memos: MemoRow[];
  user: UserRow;
  attachmentsByMemo?: ReadonlyMap<string, AttachmentRow[]>;
  reactionsByMemo?: ReadonlyMap<string, ReactionRow[]>;
  parentsByMemo?: ReadonlyMap<string, string>;
  nextPageToken?: string;
}) {
  return currentMemosToListResponse(input);
}

export function currentAttachmentToDto(attachment: AttachmentRow) {
  return {
    name: attachment.id,
    createTime: attachment.createdAt,
    filename: attachment.filename,
    type: attachment.contentType ?? "application/octet-stream",
    // Protobuf JSON encodes int64 as a decimal string.
    size: String(attachment.size),
    ...(attachment.memoId ? { memo: attachment.memoId } : {}),
  };
}

export function currentReactionToDto(reaction: ReactionRow) {
  const contentId = reaction.contentId.startsWith("memos/")
    ? reaction.contentId
    : `memos/${reaction.contentId}`;
  const reactionId = reaction.id
    .replace(/^reactions\//, "")
    .split("/")
    .at(-1);
  return {
    name: `${contentId}/reactions/${reactionId ?? reaction.id}`,
    creator: reaction.creatorId,
    contentId,
    reactionType: reaction.reactionType,
    createTime: reaction.createdAt,
  };
}

export function currentShortcutToDto(shortcut: ShortcutRow) {
  const shortcutId = shortcut.id
    .replace(/^shortcuts\//, "")
    .split("/")
    .at(-1);
  return {
    name: `${shortcut.userId}/shortcuts/${shortcutId ?? shortcut.id}`,
    title: shortcut.title,
    ...(shortcut.filter ? { filter: shortcut.filter } : {}),
  };
}

export function currentShortcutsToListResponse(shortcuts: ShortcutRow[]) {
  return { shortcuts: shortcuts.map(currentShortcutToDto) };
}

export function currentAttachmentsToListResponse(
  attachments: AttachmentRow[],
  options: { nextPageToken?: string; totalSize?: number } = {},
) {
  return {
    attachments: attachments.map(currentAttachmentToDto),
    ...(options.nextPageToken ? { nextPageToken: options.nextPageToken } : {}),
    ...(options.totalSize === undefined
      ? {}
      : { totalSize: options.totalSize }),
  };
}

export function currentShareToDto(share: ShareRow) {
  return {
    name: `${share.memoId}/shares/${share.token}`,
    createTime: share.createdAt,
    ...(share.expiresAt ? { expireTime: share.expiresAt } : {}),
  };
}

export function currentRelationToDto(
  relation: CurrentMemoRelationRow,
  memo: MemoRow,
  relatedMemo: MemoRow,
): CurrentMemoRelation {
  return {
    memo: {
      name: memo.id,
      snippet: memoSnippet(memo.content),
    },
    relatedMemo: {
      name: relatedMemo.id,
      snippet: memoSnippet(relatedMemo.content),
    },
    type: currentRelationType(relation.type),
  };
}

export function currentUserToDto(user: UserRow, authUser?: AuthUserRow | null) {
  return {
    name: user.id,
    role: user.role === "owner" ? "ADMIN" : "USER",
    username: authUser?.username ?? user.id.replace(/^users\//, ""),
    email: authUser?.email ?? user.email,
    displayName: user.name,
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    state: "NORMAL",
    createTime: user.createdAt,
    updateTime: user.updatedAt,
  };
}

export function publicUserToDto(user: UserRow, username?: string) {
  return {
    name: user.id,
    role: user.role === "owner" ? "ADMIN" : "USER",
    username: username ?? user.id.replace(/^users\//, ""),
    displayName: user.name,
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    state: "NORMAL",
    createTime: user.createdAt,
    updateTime: user.updatedAt,
  };
}

export function currentMemoState(
  value: MemoRow["status"],
): "STATE_UNSPECIFIED" | "NORMAL" | "ARCHIVED" {
  // FlareMo keeps a separate trash state. Current Memos has only NORMAL and
  // ARCHIVED in its public proto, so deleted rows are surfaced as ARCHIVED
  // only when a caller explicitly asks for deleted rows.
  return value === "normal" ? "NORMAL" : "ARCHIVED";
}

export function currentVisibility(
  value: MemoRow["visibility"],
): "VISIBILITY_UNSPECIFIED" | "PRIVATE" | "PROTECTED" | "PUBLIC" {
  if (value === "private") return "PRIVATE";
  if (value === "protected") return "PROTECTED";
  return "PUBLIC";
}

export function currentRelationType(
  value: "reference" | "comment",
): "REFERENCE" | "COMMENT" {
  return value === "comment" ? "COMMENT" : "REFERENCE";
}

export function legacyMemoState(
  value: unknown,
): "normal" | "archived" | "trashed" | "deleted" | undefined {
  if (value === "NORMAL") return "normal";
  if (value === "ARCHIVED") return "archived";
  if (
    value === "normal" ||
    value === "archived" ||
    value === "trashed" ||
    value === "deleted"
  ) {
    return value;
  }
  return undefined;
}

function currentProperty(value: unknown) {
  if (!isRecord(value)) return undefined;
  const property = {
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.has_link === "boolean" ? { hasLink: value.has_link } : {}),
    ...(typeof value.has_task_list === "boolean"
      ? { hasTaskList: value.has_task_list }
      : {}),
    ...(typeof value.has_code === "boolean" ? { hasCode: value.has_code } : {}),
    ...(typeof value.has_incomplete_tasks === "boolean"
      ? { hasIncompleteTasks: value.has_incomplete_tasks }
      : {}),
  };
  return Object.keys(property).length > 0 ? property : undefined;
}

function currentLocation(value: unknown) {
  if (!isRecord(value)) return undefined;
  const location = {
    ...(typeof value.placeholder === "string"
      ? { placeholder: value.placeholder }
      : {}),
    ...(typeof value.latitude === "number" ? { latitude: value.latitude } : {}),
    ...(typeof value.longitude === "number"
      ? { longitude: value.longitude }
      : {}),
  };
  return Object.keys(location).length > 0 ? location : undefined;
}

function memoSnippet(content: string) {
  const plain = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*`_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
