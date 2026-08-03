import type { AttachmentRow, MemoRow, UserRow } from "@flaremo/db";
import { describe, expect, it } from "vitest";
import {
  currentAttachmentToDto,
  currentMemosToListResponse,
  currentMemoToDto,
  currentRelationToDto,
  currentShareToDto,
} from "./current-adapter";

const user = {
  id: "users/owner",
  role: "owner",
  email: "owner@example.com",
  name: "Owner",
  avatarUrl: null,
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
} as unknown as UserRow;

const memo = {
  id: "memos/one",
  userId: user.id,
  content: "# Heading\nA memo with [a link](https://example.com).",
  visibility: "protected",
  status: "normal",
  pinned: true,
  payload: {
    tags: ["one", "#two"],
    property: { has_link: true, has_code: false, title: "Heading" },
    location: { placeholder: "Shanghai", latitude: 31.2 },
  },
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:01:00.000Z",
} as unknown as MemoRow;

const attachment = {
  id: "attachments/file",
  userId: user.id,
  memoId: memo.id,
  filename: "note.txt",
  contentType: "text/plain",
  size: 5,
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
} as unknown as AttachmentRow;

describe("current Memos wire adapter", () => {
  it("maps memo fields to camelCase and uppercase enums", () => {
    expect(currentMemoToDto(memo, user)).toMatchObject({
      name: "memos/one",
      state: "NORMAL",
      visibility: "PROTECTED",
      createTime: memo.createdAt,
      updateTime: memo.updatedAt,
      tags: ["one", "#two"],
      pinned: true,
      property: { hasLink: true, hasCode: false, title: "Heading" },
      location: { placeholder: "Shanghai", latitude: 31.2 },
      snippet: "Heading A memo with a link.",
    });
  });

  it("uses protobuf JSON int64 strings for attachment size", () => {
    expect(currentAttachmentToDto(attachment)).toEqual({
      name: "attachments/file",
      createTime: attachment.createdAt,
      filename: "note.txt",
      type: "text/plain",
      size: "5",
      memo: "memos/one",
    });
  });

  it("maps nested relations, shares, and page tokens", () => {
    const relatedMemo = {
      ...memo,
      id: "memos/two",
      content: "related",
    } as MemoRow;
    const relation = {
      memoId: memo.id,
      relatedMemoId: relatedMemo.id,
      type: "comment",
      createdAt: "2026-08-03T00:02:00.000Z",
    } as const;
    expect(currentRelationToDto(relation, memo, relatedMemo)).toMatchObject({
      memo: { name: "memos/one" },
      relatedMemo: { name: "memos/two" },
      type: "COMMENT",
    });

    const share = {
      memoId: memo.id,
      token: "opaque-share",
      createdAt: "2026-08-03T00:00:00.000Z",
      expiresAt: null,
    } as never;
    expect(currentShareToDto(share)).toEqual({
      name: "memos/one/shares/opaque-share",
      createTime: "2026-08-03T00:00:00.000Z",
    });

    expect(
      currentMemosToListResponse({
        memos: [memo],
        user,
        attachmentsByMemo: new Map([[memo.id, [attachment]]]),
        nextPageToken: "next",
      }),
    ).toMatchObject({
      nextPageToken: "next",
      memos: [{ attachments: [{ size: "5" }] }],
    });
  });
});
