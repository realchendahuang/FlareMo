/**
 * Personal access token scopes.
 *
 * A PAT is a machine credential for the Memos-compatible API, MCP and the
 * scripts that drive them. It used to inherit the owner's full powers with no
 * expiry, so a leaked token could also delete members and touch the admin
 * surface. New tokens default to the smaller notes scope and a finite lifetime;
 * notes-only machines may explicitly opt into a non-expiring token, while an
 * admin-scoped token always keeps a finite lifetime. The Worker checks the
 * scope on every PAT request.
 *
 * Scopes are deliberately coarse: notes covers the whole content API (read and
 * write, including MCP tool calls, which all travel over POST), and admin is an
 * additive scope for the owner-only management surface under /api/app/admin.
 */

export const MEMOS_PAT_SCOPES = ["notes", "admin"] as const;
export type MemosPatScope = (typeof MEMOS_PAT_SCOPES)[number];

export const DEFAULT_MEMOS_PAT_SCOPE: MemosPatScope = "notes";
/** Blank/omitted lifetime means one year, not an accidental permanent token. */
export const DEFAULT_MEMOS_PAT_EXPIRES_IN_DAYS = 365;
/** Explicit zero is the wire/UI spelling for a non-expiring notes-only PAT. */
export const PERMANENT_MEMOS_PAT_EXPIRES_IN_DAYS = 0;
/** Admin-scoped tokens are deliberately excluded from the permanent option. */
export const MAX_MEMOS_PAT_EXPIRES_IN_DAYS = 365;

/** Better Auth api-key permission statements: resource -> actions. */
const MEMOS_PAT_SCOPE_PERMISSIONS: Record<
  MemosPatScope,
  Record<string, string[]>
> = {
  notes: { memos: ["read", "write"] },
  admin: { memos: ["read", "write"], admin: ["manage"] },
};

/** Merge the statements of several scopes into one permission object. */
export function memosPatPermissionsFor(
  scopes: readonly MemosPatScope[],
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const scope of scopes) {
    for (const [resource, actions] of Object.entries(
      MEMOS_PAT_SCOPE_PERMISSIONS[scope],
    )) {
      const existing = merged[resource] ?? [];
      merged[resource] = [...new Set([...existing, ...actions])];
    }
  }
  return merged;
}

/**
 * Read the scopes back out of a stored permission object.
 *
 * Returns null when the token predates scopes (no permissions stored). Those
 * legacy tokens keep their original full access so existing scripts do not
 * break mid-flight; they are reported as notes + admin in the UI, which is
 * exactly what they can do.
 */
export function memosPatScopesFromPermissions(
  permissions: unknown,
): MemosPatScope[] | null {
  if (!permissions || typeof permissions !== "object") return null;
  const record = permissions as Record<string, unknown>;
  const memos = Array.isArray(record.memos) ? record.memos : [];
  const admin = Array.isArray(record.admin) ? record.admin : [];
  const hasAdmin = admin.includes("manage");
  const hasNotes = hasAdmin || memos.length > 0;
  if (!hasNotes) return null;
  return hasAdmin ? ["notes", "admin"] : ["notes"];
}

/**
 * Whether a PAT with these scopes may call this path. A null scope list means a
 * legacy unrestricted token. The admin surface is the only scope boundary: a
 * notes token may touch every non-admin route, an admin token may touch all.
 */
export function memosPatScopesAllowPath(
  scopes: readonly MemosPatScope[] | null,
  pathname: string,
): boolean {
  if (scopes === null) return true;
  const isAdminPath =
    pathname === "/api/app/admin" || pathname.startsWith("/api/app/admin/");
  if (isAdminPath) return scopes.includes("admin");
  return scopes.includes("notes") || scopes.includes("admin");
}
