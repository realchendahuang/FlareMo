import type { MemoRow, UserRow } from "@flaremo/db";
import { describe, expect, it } from "vitest";
import { canEditMemo, canReadMemo } from "./team-permissions";

function user(id: string, role: UserRow["role"]): UserRow {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    avatarUrl: null,
    role,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function memo(visibility: MemoRow["visibility"]): MemoRow {
  return {
    id: "memos/a",
    userId: "users/a",
    content: "content",
    visibility,
    status: "normal",
    pinned: false,
    source: "web",
    clientId: null,
    payload: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    embeddingStatus: "not_indexed",
    embeddingVersion: null,
    embeddedAt: null,
    embeddingError: null,
  };
}

describe("team memo permissions", () => {
  const author = user("users/a", "member");
  const member = user("users/b", "member");
  const admin = user("users/admin", "admin");

  it("keeps private memos private even from a team administrator", () => {
    expect(canReadMemo(author, memo("private"))).toBe(true);
    expect(canReadMemo(member, memo("private"))).toBe(false);
    expect(canReadMemo(admin, memo("private"))).toBe(false);
    expect(canEditMemo(admin, memo("private"))).toBe(false);
  });

  it("makes team memos read-only for members and manageable by admins", () => {
    expect(canReadMemo(member, memo("protected"))).toBe(true);
    expect(canEditMemo(member, memo("protected"))).toBe(false);
    expect(canReadMemo(admin, memo("protected"))).toBe(true);
    expect(canEditMemo(admin, memo("protected"))).toBe(true);
  });

  it("rejects removed members", () => {
    const removed = { ...member, status: "removed" as const };
    expect(canReadMemo(removed, memo("protected"))).toBe(false);
    expect(canEditMemo(removed, memo("protected"))).toBe(false);
  });
});
