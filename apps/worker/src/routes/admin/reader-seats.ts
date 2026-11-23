import {
  ConflictError,
  ForbiddenError,
  getAuthUserById,
  getAuthUserIdByFlaremoUserId,
  getFlaremoUserByAuthUserId,
  getFlaremoUserById,
  grantTeamReader,
  isTeamOwner,
  NotFoundError,
  revokeTeamReader,
  updateTeamMemberRole,
  ValidationError,
} from "@flaremo/domain";
import type { Hono } from "hono";
import { z } from "zod";
import { getFlareMoAuth, type HonoBindings } from "../../context";
import { jsonError } from "../../http";
import { zValidator } from "../../validated";
import {
  readerExpiresAt,
  teamAdminContext,
  teamMembershipInfo,
  updateUserRoleSchema,
} from "./context";
import { createMemberAccount } from "./users";

const provisionReaderSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(80).optional(),
  // Absolute expiry timestamp (ISO-8601); null = a reader seat without an
  // expiry. Renewal arithmetic stays with the caller.
  expires_at: z.string().min(1).nullable(),
});

const setReaderSchema = z.object({
  // Absolute expiry timestamp (ISO-8601); null = a reader seat without an
  // expiry. Renewal arithmetic (extend from max(now, current expiry)) is the
  // admin UI's job — this endpoint stores the computed date.
  expires_at: z.string().min(1).nullable(),
});

export function registerReaderSeatsRoutes(app: Hono<HonoBindings>) {
  /**
   * Idempotent machine provisioning: grant (or renew) the reader seat by
   * email. Unknown emails get a fresh account with an activation link, so one
   * external call — a payment webhook, a script — opens a seat end to end.
   * Account creation stays strictly additive; anything that would demote an
   * administrator or the owner is rejected like the per-user endpoint.
   */
  app.put(
    "/team/reader",
    zValidator("json", provisionReaderSchema),
    async (c) => {
      try {
        const context = await teamAdminContext(c);
        const input = c.req.valid("json");
        const email = input.email.toLowerCase();
        let expiresAt: Date | null = null;
        if (input.expires_at) {
          expiresAt = new Date(input.expires_at);
          if (Number.isNaN(expiresAt.getTime())) {
            throw new ValidationError("expires_at must be a valid date.");
          }
        }

        const auth = await getFlareMoAuth(c.env);
        const existingAuthUser = await auth.findAuthUserByEmail(email);
        const memberRow = existingAuthUser
          ? await getFlaremoUserByAuthUserId(context.db, existingAuthUser.id)
          : null;

        if (existingAuthUser && !memberRow) {
          // The auth identity exists without a domain user (or was removed):
          // machine provisioning never resurrects removed accounts.
          throw new ConflictError(
            "No active FlareMo account matches this email.",
          );
        }
        if (memberRow && memberRow.status !== "active") {
          throw new ConflictError(
            "No active FlareMo account matches this email.",
          );
        }

        let created = false;
        let memberId: string;
        let memberName: string;
        let username: string;
        let activationToken: string | undefined;
        let memberCreatedAt: string;
        let memberStatus: string;

        if (!memberRow) {
          created = true;
          const account = await createMemberAccount(c, context, {
            email,
            name: input.name ?? email.split("@")[0] ?? email,
          });
          memberId = account.member.id;
          memberName = account.member.name;
          username = account.username;
          activationToken = account.activationToken;
          memberCreatedAt = account.member.createdAt;
          memberStatus = account.member.status;
          await grantTeamReader(context.db, {
            authUserId: account.authUserId,
            expiresAt,
          });
        } else {
          const membership = await teamMembershipInfo(context.db, memberRow.id);
          if (membership?.role === "owner" || membership?.role === "admin") {
            throw new ForbiddenError(
              "Administrators and the owner cannot become readers.",
            );
          }
          const authUserId = await getAuthUserIdByFlaremoUserId(
            context.db,
            memberRow.id,
          );
          if (!authUserId) {
            throw new NotFoundError("Active member not found");
          }
          username = await getAuthUserById(context.db, authUserId).then(
            (user) => user?.username ?? memberRow.id.replace(/^users\//, ""),
          );
          memberId = memberRow.id;
          memberName = memberRow.name;
          memberCreatedAt = memberRow.createdAt;
          memberStatus = memberRow.status;
          await grantTeamReader(context.db, { authUserId, expiresAt });
        }

        return c.json(
          {
            id: memberId,
            email,
            name: memberName,
            username,
            role: "reader" as const,
            reader_expires_at: readerExpiresAt(expiresAt),
            status: memberStatus,
            created_at: memberCreatedAt,
            created,
            ...(created && activationToken
              ? {
                  activation_path: `/reset?token=${encodeURIComponent(activationToken)}`,
                  activation_expires_in_seconds: 60 * 60,
                }
              : {}),
          },
          created ? 201 : 200,
        );
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.patch(
    "/users/:id/role",
    zValidator("json", updateUserRoleSchema),
    async (c) => {
      try {
        const context = await teamAdminContext(c);
        const id = c.req.param("id");
        const authUserId = await getAuthUserIdByFlaremoUserId(context.db, id);
        if (!authUserId) {
          throw new NotFoundError("Active member not found");
        }
        // Only the team owner elevates or demotes members — administrators
        // manage members but never change roles (peer-protection rule). The
        // owner-target guard comes first so a non-owner administrator sees the
        // same owner-immutability error the domain enforces.
        const targetRole =
          (await teamMembershipInfo(context.db, id))?.role ?? null;
        if (targetRole === "owner") {
          throw new ForbiddenError("The owner role cannot be changed.");
        }
        if (!isTeamOwner(context.user)) {
          throw new ForbiddenError("Only the team owner can change roles.");
        }
        await updateTeamMemberRole(
          context.db,
          authUserId,
          c.req.valid("json").role,
        );
        const member = await getFlaremoUserById(context.db, id);
        if (!member) {
          throw new NotFoundError("Active member not found");
        }
        const authUser = await getAuthUserById(context.db, authUserId);
        return c.json({
          id: member.id,
          email: authUser?.email ?? member.email,
          name: member.name,
          username: authUser?.username ?? member.id.replace(/^users\//, ""),
          role: c.req.valid("json").role,
          status: member.status,
          created_at: member.createdAt,
        });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.put(
    "/users/:id/reader",
    zValidator("json", setReaderSchema),
    async (c) => {
      try {
        const context = await teamAdminContext(c);
        const id = c.req.param("id");
        const authUserId = await getAuthUserIdByFlaremoUserId(context.db, id);
        if (!authUserId) {
          throw new NotFoundError("Active member not found");
        }
        // Peer protection: reader is a downgrade — it can be granted to plain
        // members or to users outside the team, never to administrators or the
        // owner (whose role is immutable anyway).
        const targetRole =
          (await teamMembershipInfo(context.db, id))?.role ?? null;
        if (targetRole === "owner" || targetRole === "admin") {
          throw new ForbiddenError(
            "Administrators and the owner cannot become readers.",
          );
        }
        const rawExpiresAt = c.req.valid("json").expires_at;
        let expiresAt: Date | null = null;
        if (rawExpiresAt) {
          expiresAt = new Date(rawExpiresAt);
          if (Number.isNaN(expiresAt.getTime())) {
            throw new ValidationError("expires_at must be a valid date.");
          }
        }
        await grantTeamReader(context.db, { authUserId, expiresAt });
        const member = await getFlaremoUserById(context.db, id);
        if (!member) {
          throw new NotFoundError("Active member not found");
        }
        const authUser = await getAuthUserById(context.db, authUserId);
        return c.json({
          id: member.id,
          email: authUser?.email ?? member.email,
          name: member.name,
          username: authUser?.username ?? member.id.replace(/^users\//, ""),
          role: "reader" as const,
          reader_expires_at: readerExpiresAt(expiresAt),
          status: member.status,
          created_at: member.createdAt,
        });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.delete("/users/:id/reader", async (c) => {
    try {
      const context = await teamAdminContext(c);
      const id = c.req.param("id");
      const authUserId = await getAuthUserIdByFlaremoUserId(context.db, id);
      if (!authUserId) {
        throw new NotFoundError("Active member not found");
      }
      const membership = await teamMembershipInfo(context.db, id);
      if (membership?.role !== "reader") {
        throw new NotFoundError("Reader seat not found");
      }
      await revokeTeamReader(context.db, authUserId);
      const member = await getFlaremoUserById(context.db, id);
      if (!member) {
        throw new NotFoundError("Active member not found");
      }
      const authUser = await getAuthUserById(context.db, authUserId);
      return c.json({
        id: member.id,
        email: authUser?.email ?? member.email,
        name: member.name,
        username: authUser?.username ?? member.id.replace(/^users\//, ""),
        role: null,
        reader_expires_at: null,
        status: member.status,
        created_at: member.createdAt,
      });
    } catch (error) {
      return jsonError(c, error);
    }
  });
}
