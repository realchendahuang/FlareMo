import type { FlareMoDb } from "@flaremo/db";
import {
  ForbiddenError,
  getAuthUserIdByFlaremoUserId,
  getMembershipState,
  isInstanceOwner,
  isTeamAdmin,
} from "@flaremo/domain";
import { z } from "zod";
import { getBrowserRequestContext, getRequestContext } from "../../context";

export const updateSettingsSchema = z.object({
  registration_open: z.boolean(),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(320),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

/**
 * Machine provisioning enters the admin surface through the same credential
 * resolver the rest of the API uses: a `Bearer memos_pat_*` token resolves to
 * its owner (with the team role), while browser requests keep the strict
 * session-only path. The PAT therefore carries exactly its owner's powers —
 * no more — and the per-endpoint role checks below stay in charge.
 */
async function adminCredentialContext(
  c: Parameters<typeof getBrowserRequestContext>[0],
) {
  return c.req.raw.headers.has("authorization")
    ? await getRequestContext(c)
    : await getBrowserRequestContext(c);
}

export async function teamAdminContext(
  c: Parameters<typeof getBrowserRequestContext>[0],
) {
  const context = await adminCredentialContext(c);
  if (!isTeamAdmin(context.user)) {
    throw new ForbiddenError("Team administrator access is required.");
  }
  return context;
}

/**
 * Credential-minting endpoints (creating a member, issuing an activation or
 * password-reset link) are browser-only. A leaked PAT must not be able to take
 * over a member account, even when its owner is an administrator. The rest of
 * the admin surface keeps the PAT path for machine provisioning.
 */
export async function teamAdminSessionContext(
  c: Parameters<typeof getBrowserRequestContext>[0],
) {
  const context = await getBrowserRequestContext(c);
  if (!isTeamAdmin(context.user)) {
    throw new ForbiddenError("Team administrator access is required.");
  }
  return context;
}

export async function ownerContext(
  c: Parameters<typeof getBrowserRequestContext>[0],
) {
  const context = await adminCredentialContext(c);
  if (!isInstanceOwner(context.user)) {
    throw new ForbiddenError("Owner access is required.");
  }
  return context;
}

/**
 * Resolve a member's team membership (role + reader expiry) through their
 * Better Auth identity. Removed members have no membership row and surface
 * with null.
 */
export async function teamMembershipInfo(
  db: FlareMoDb,
  flaremoUserId: string,
): Promise<{
  role: "owner" | "admin" | "member" | "reader";
  expiresAt: Date | null;
} | null> {
  const authUserId = await getAuthUserIdByFlaremoUserId(db, flaremoUserId);
  if (!authUserId) return null;
  const state = await getMembershipState(db, authUserId);
  if (!state) return null;
  return { role: state.role, expiresAt: state.expiresAt };
}

/** Serialize reader expiry as an ISO string for the admin user DTO. */
export function readerExpiresAt(expiresAt: Date | null): string | null {
  return expiresAt ? expiresAt.toISOString() : null;
}
