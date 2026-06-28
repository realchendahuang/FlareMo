import type {
  AttachmentDto,
  ListMemosResponse,
  MemoDto,
  MemoRelationDto,
  ShareDto,
} from "@flaremo/contracts";
import type {
  AttachmentRow,
  MemoPayload,
  MemoRow,
  ShareRow,
  UserRow,
} from "@flaremo/db";

type MemoRelationRow = {
  memoId: string;
  relatedMemoId: string;
  type: "reference" | "comment";
  createdAt: string;
};

export function memoToDto(memo: MemoRow, user: UserRow): MemoDto {
  return {
    name: memo.id,
    id: memo.id.replace(/^memos\//, ""),
    content: memo.content,
    visibility: memo.visibility,
    state: memo.status,
    pinned: memo.pinned,
    payload: (memo.payload ?? {}) as MemoPayload,
    create_time: memo.createdAt,
    update_time: memo.updatedAt,
    display_time: memo.createdAt,
    creator: user.id,
  };
}

export function attachmentToDto(attachment: AttachmentRow): AttachmentDto {
  return {
    name: attachment.id,
    id: attachment.id.replace(/^attachments\//, ""),
    memo: attachment.memoId,
    filename: attachment.filename,
    content_type: attachment.contentType,
    size: attachment.size,
    payload: attachment.payload ?? {},
    create_time: attachment.createdAt,
    update_time: attachment.updatedAt,
    download_url: `/api/v1/${attachment.id}/blob`,
  };
}

export function memoRelationToDto(relation: MemoRelationRow): MemoRelationDto {
  return {
    memo: relation.memoId,
    related_memo: relation.relatedMemoId,
    type: relation.type,
    create_time: relation.createdAt,
  };
}

export function shareToDto(share: ShareRow): ShareDto {
  return {
    name: share.id,
    id: share.id.replace(/^shares\//, ""),
    memo: share.memoId,
    token: share.token,
    expires_at: share.expiresAt,
    create_time: share.createdAt,
  };
}

export function memosToListResponse(input: {
  memos: MemoRow[];
  user: UserRow;
  nextPageToken?: string;
}): ListMemosResponse {
  return {
    memos: input.memos.map((memo) => memoToDto(memo, input.user)),
    ...(input.nextPageToken ? { next_page_token: input.nextPageToken } : {}),
  };
}

export function parseMemosResourceName(name: string) {
  return parseResourceName(name, "memos");
}

export function parseAttachmentsResourceName(name: string) {
  return parseResourceName(name, "attachments");
}

export function parseSharesResourceName(name: string) {
  return parseResourceName(name, "shares");
}

function parseResourceName(
  name: string,
  prefix: "attachments" | "memos" | "shares",
) {
  if (name.startsWith(`${prefix}/`)) {
    return name;
  }
  return `${prefix}/${name}`;
}
