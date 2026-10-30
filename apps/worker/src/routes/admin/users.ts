import {
  assertMemberQuota,
  createFlaremoMemberWithLink,
  deriveUniqueUsername,
  listFlaremoUsersWithMemberships,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import {
  type getBrowserRequestContext,
  type HonoBindings,
  loadAuthFactory,
} from "../../context";
import { jsonError } from "../../http";
import { createUserSchema, readerExpiresAt, teamAdminContext } from "./context";

/**
 * Create a Better Auth identity, the domain user, the link, and the default
 * team membership in one shot. Administrators never choose or receive a
 * member password: the one-time reset token doubles as the activation
 * credential. Shared by the manual add-member endpoint and the machine
 * provisioning endpoint so both paths stay identical.
 */
export async function createMemberAccount(
  c: Parameters<typeof getBrowserRequestContext>[0],
  context: Awaited<ReturnType<typeof teamAdminContext>>,
  input: { email: string; name: string },
): Promise<{
  member: Awaited<ReturnType<typeof createFlaremoMemberWithLink>>;
  authUserId: string;
  username: string;
  activationToken: string;
}> {
  const email = input.email;
  const username = await deriveUniqueUsername(context.db, email);
  // Check before Better Auth creates an identity so quota failures cannot
  // leave an orphaned login account.
  await assertMemberQuota(context.db, context.limits);
  const { createFlareMoAuth } = await loadAuthFactory();
  const auth = createFlareMoAuth(c.env, context.db, {
    allowBootstrapSignUp: true,
  });
  const result = await auth.api.signUpEmail({
    body: {
      email,
      name: input.name,
      password: `${crypto.randomUUID()}-${crypto.randomUUID()}Aa1!`,
      username,
      displayUsername: input.name,
    },
  });
  const member = await createFlaremoMemberWithLink(
    context.db,
    {
      authUserId: result.user.id,
      email,
      name: input.name,
    },
    context.limits,
  );
  const activationToken = await auth.createPasswordResetToken(result.user.id);
  return { member, authUserId: result.user.id, username, activationToken };
}

export function registerUsersRoutes(app: Hono<HonoBindings>) {
  app.get("/users", async (c) => {
    try {
      const { db } = await teamAdminContext(c);
      const members = await listFlaremoUsersWithMemberships(db);
      const rows = members.map(({ user: member, authUser, membership }) => ({
        id: member.id,
        email: authUser?.email ?? member.email,
        name: member.name,
        username: authUser?.username ?? member.id.replace(/^users\//, ""),
        // The uploaded avatar, so a member's row shows the face they see on
        // their own sidebar; without one both fall back to the same
        // name-seeded generated avatar.
        avatar_url: member.avatarUrl ?? null,
        role: membership?.role ?? null,
        reader_expires_at: membership
          ? readerExpiresAt(membership.expiresAt)
          : null,
        status: member.status,
        created_at: member.createdAt,
      }));
      return c.json({ users: rows });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/users", zValidator("json", createUserSchema), async (c) => {
    try {
      const context = await teamAdminContext(c);
      const input = c.req.valid("json");
      const { member, username, activationToken } = await createMemberAccount(
        c,
        context,
        {
          email: input.email,
          name: input.name,
        },
      );
      return c.json(
        {
          id: member.id,
          email: member.email,
          name: member.name,
          username,
          role: "member" as const,
          status: member.status,
          created_at: member.createdAt,
          activation_path: `/reset?token=${encodeURIComponent(activationToken)}`,
          activation_expires_in_seconds: 60 * 60,
        },
        201,
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });
}
