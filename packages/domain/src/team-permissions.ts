import type { MemoRow, UserRow } from "@flaremo/db";
import { memos } from "@flaremo/db";
import { and, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { ForbiddenError } from "./errors";

export function isActiveTeamMember(user: UserRow | null): user is UserRow {
  return Boolean(user && user.status === "active");
}

export function isTeamAdmin(user: UserRow | null): boolean {
  return Boolean(
    isActiveTeamMember(user) &&
      (user.role === "owner" || user.role === "admin"),
  );
}

/**
 * SQL authorization boundary for memo list and search queries.
 *
 * Resource owners retain access to their own non-deleted states. Other active
 * members only receive normal team/public rows; administrators may also load
 * non-private archived/trashed rows so they can manage them.
 */
export function memoReadScope(user: UserRow | null): SQL {
  if (!isActiveTeamMember(user)) {
    return user
      ? sql`0 = 1`
      : (and(eq(memos.visibility, "public"), eq(memos.status, "normal")) ??
          sql`0 = 1`);
  }

  if (isTeamAdmin(user)) {
    return (
      or(
        eq(memos.userId, user.id),
        inArray(memos.visibility, ["protected", "public"]),
      ) ?? sql`0 = 1`
    );
  }

  return (
    or(
      eq(memos.userId, user.id),
      and(
        eq(memos.status, "normal"),
        inArray(memos.visibility, ["protected", "public"]),
      ),
    ) ?? sql`0 = 1`
  );
}

export function canReadMemo(user: UserRow | null, memo: MemoRow): boolean {
  if (!isActiveTeamMember(user)) {
    return !user && memo.visibility === "public" && memo.status === "normal";
  }
  if (memo.userId === user.id) return true;
  if (memo.visibility === "private") return false;
  return isTeamAdmin(user) || memo.status === "normal";
}

export function canEditMemo(user: UserRow, memo: MemoRow): boolean {
  if (!isActiveTeamMember(user)) return false;
  return (
    memo.userId === user.id ||
    (isTeamAdmin(user) && memo.visibility !== "private")
  );
}

export const canDeleteMemo = canEditMemo;

export function assertCanEditMemo(user: UserRow, memo: MemoRow): void {
  if (!canEditMemo(user, memo)) {
    throw new ForbiddenError("You do not have permission to edit this memo.");
  }
}

export function assertCanDeleteMemo(user: UserRow, memo: MemoRow): void {
  if (!canDeleteMemo(user, memo)) {
    throw new ForbiddenError("You do not have permission to delete this memo.");
  }
}
