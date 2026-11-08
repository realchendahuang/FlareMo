import type { MemoRow } from "@flaremo/db";
import { describe, expect, it } from "vitest";
import {
  canDeleteMemo,
  canEditMemo,
  canGovernMemo,
  canPublishTeamMemo,
  canReadMemo,
  type TeamViewer,
} from "./team-permissions";

function user(
  id: string,
  role: "owner" | "admin" | "member" | "reader",
): TeamViewer {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    avatarUrl: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    teamRole: role,
    teamOrganizationId: "orgs/team",
  };
}

function userOutsideTeam(id: string): TeamViewer {
  return { ...user(id, "member"), teamRole: null, teamOrganizationId: null };
}

function memo(
  visibility: MemoRow["visibility"],
  overrides: Partial<Pick<MemoRow, "teamId" | "status">> = {},
): MemoRow {
  return {
    id: "memos/a",
    userId: "users/a",
    teamId: visibility === "private" ? null : "orgs/team",
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
    embeddingChunks: null,
    version: 1,
    ...overrides,
  };
}

describe("team memo permissions", () => {
  const author = user("users/a", "member");
  const member = user("users/b", "member");
  const admin = user("users/admin", "admin");
  const owner = user("users/owner2", "owner");

  it("keeps personal memos private from everyone but the author", () => {
    expect(canReadMemo(author, memo("private"))).toBe(true);
    expect(canReadMemo(member, memo("private"))).toBe(false);
    expect(canReadMemo(admin, memo("private"))).toBe(false);
    expect(canReadMemo(owner, memo("private"))).toBe(false);
    expect(canEditMemo(admin, memo("private"))).toBe(false);
    expect(canEditMemo(owner, memo("private"))).toBe(false);
    expect(canGovernMemo(admin, memo("private"))).toBe(false);
  });

  it("keeps memberless viewers out of team content", () => {
    const outsider = userOutsideTeam("users/out");
    expect(canReadMemo(outsider, memo("protected"))).toBe(false);
    expect(canReadMemo(outsider, memo("public"))).toBe(true);
  });

  it("makes team memos read-only for members and governable by admins", () => {
    expect(canReadMemo(member, memo("protected"))).toBe(true);
    expect(canEditMemo(member, memo("protected"))).toBe(false);
    expect(canGovernMemo(member, memo("protected"))).toBe(false);
    expect(canReadMemo(admin, memo("protected"))).toBe(true);
    expect(canEditMemo(admin, memo("protected"))).toBe(false);
    expect(canGovernMemo(admin, memo("protected"))).toBe(true);
  });

  it("never lets anyone but the author edit, while the owner keeps hard delete", () => {
    // Content authority (docs/content-authority.md): rewriting another
    // author's words is authorship, so even the team owner cannot edit —
    // but the irreversible governance end (hard delete) stays owner-level.
    expect(canEditMemo(owner, memo("protected"))).toBe(false);
    expect(canGovernMemo(owner, memo("protected"))).toBe(true);
    expect(canDeleteMemo(owner, memo("protected"))).toBe(true);
    expect(canDeleteMemo(admin, memo("protected"))).toBe(false);
    expect(canDeleteMemo(member, memo("protected"))).toBe(false);
    expect(canEditMemo(owner, memo("private"))).toBe(false);
    expect(canDeleteMemo(owner, memo("private"))).toBe(false);
    expect(canEditMemo(admin, memo("public"))).toBe(false);
    expect(canDeleteMemo(owner, memo("public"))).toBe(true);
  });

  it("gives the author every power over their own memo", () => {
    expect(canEditMemo(author, memo("private"))).toBe(true);
    expect(canEditMemo(author, memo("protected"))).toBe(true);
    expect(canGovernMemo(author, memo("protected"))).toBe(true);
  });

  it("lets readers read team memos but never publish, govern, or edit", () => {
    const reader = user("users/reader", "reader");
    expect(canReadMemo(reader, memo("protected"))).toBe(true);
    expect(canReadMemo(reader, memo("public"))).toBe(true);
    // The read-only seat: publishing is denied at resolveMemoTeamId, and the
    // governance ladder stays closed because a reader is never an admin.
    expect(canPublishTeamMemo(reader)).toBe(false);
    expect(canEditMemo(reader, memo("protected"))).toBe(false);
    expect(canGovernMemo(reader, memo("protected"))).toBe(false);
    expect(canDeleteMemo(reader, memo("protected"))).toBe(false);
    // Authorship is unaffected: a reader's own personal notes stay theirs.
    expect(canEditMemo(user("users/a", "reader"), memo("private"))).toBe(true);
  });

  it("keeps publishing open for every non-reader member", () => {
    for (const actor of [author, member, admin, owner]) {
      expect(canPublishTeamMemo(actor)).toBe(true);
    }
    // The predicate is role-level only; a non-member's team publish attempt
    // still fails in resolveMemoTeamId because no membership resolves a team.
    expect(canPublishTeamMemo(userOutsideTeam("users/out"))).toBe(true);
  });

  it("rejects removed members", () => {
    const removed = { ...member, status: "removed" as const };
    expect(canReadMemo(removed, memo("protected"))).toBe(false);
    expect(canEditMemo(removed, memo("protected"))).toBe(false);
    expect(canGovernMemo(removed, memo("protected"))).toBe(false);
  });

  it("hides archived and trashed team memos from members, shows them to admins", () => {
    const archived = memo("protected", { status: "archived" });
    expect(canReadMemo(member, archived)).toBe(false);
    expect(canReadMemo(admin, archived)).toBe(true);
    const trashed = memo("protected", { status: "trashed" });
    expect(canReadMemo(member, trashed)).toBe(false);
    expect(canReadMemo(admin, trashed)).toBe(true);
  });

  it("never lets another organization's owner/admin edit, govern, or delete its public memos", () => {
    const foreignMemo = memo("protected", { teamId: "orgs/other" });
    const foreignPublic = memo("public", { teamId: "orgs/other" });
    for (const actor of [owner, admin, member]) {
      // Read stays world-readable for public rows, but every write power is
      // confined to the memo's own organization.
      expect(canEditMemo(actor, foreignMemo)).toBe(false);
      expect(canGovernMemo(actor, foreignMemo)).toBe(false);
      expect(canDeleteMemo(actor, foreignMemo)).toBe(false);
      expect(canEditMemo(actor, foreignPublic)).toBe(false);
      expect(canGovernMemo(actor, foreignPublic)).toBe(false);
      expect(canDeleteMemo(actor, foreignPublic)).toBe(false);
    }
  });
});
