import {
  beginFlaremoMemberRemoval,
  ForbiddenError,
  finalizeFlaremoMemberRemoval,
  getMemosPersonalAccessToken,
  listFlaremoUsers,
  listMemosPersonalAccessTokens,
  NotFoundError,
} from "@flaremo/domain";
import type { Hono } from "hono";
import { cleanupFlaremoArtifacts } from "../../artifact-cleanup";
import {
  getRequestContext,
  type HonoBindings,
  loadAuthFactory,
} from "../../context";
import { getFlaremoUserCached } from "../../identity-cache";
import { currentJsonError } from "../../memos-compat/current-errors";
import { registerCompatMember } from "../../memos-compat/member-service";
import {
  createMemosPersonalAccessToken,
  personalAccessTokenToDto,
} from "../../memos-compat/pat";
import { memosCompatUserDto } from "../../memos-compat/user-dto";
import {
  assertCurrentUserPath,
  assertOwnerUser,
  assertSessionCredential,
  currentUserForContext,
  isLegacyWireRequest,
  normalizeUserName,
  noStoreResponse,
  readCurrentJsonObject,
} from "./helpers";
import { currentPatBodySchema, currentSignupSchema } from "./schemas";

export function registerUserRoutes(app: Hono<HonoBindings>) {
  app.get("/users", async (c, next) => {
    if (isLegacyWireRequest(c)) return next();
    try {
      const context = await getRequestContext(c);
      const users = await listFlaremoUsers(context.db);
      // Non-self entries keep their display fields but never the email — the
      // compatibility surface must not become an email directory.
      const dtos = await Promise.all(
        users.map((user) =>
          memosCompatUserDto(context.db, user, context.user.id),
        ),
      );
      return c.json({ users: dtos });
    } catch (error) {
      return currentJsonError(c, error);
    }
  });

  app.post("/users", async (c, next) => {
    if (isLegacyWireRequest(c)) return next();
    try {
      const context = await getRequestContext(c);
      assertOwnerUser(context);
      const body = currentSignupSchema.parse(await readCurrentJsonObject(c));
      const username = body.username.trim();
      const email = `${username}@flaremo.local`;
      const { authUserId, user } = await registerCompatMember({
        env: c.env,
        db: context.db,
        limits: context.limits,
        username,
        password: body.password,
        displayName: body.displayName?.trim() || username,
        email,
      });
      return c.json(
        await currentUserForContext({
          db: context.db,
          user,
          authUserId,
        }),
        201,
      );
    } catch (error) {
      return currentJsonError(c, error);
    }
  });

  app.get("/users/:user/personalAccessTokens", async (c, next) => {
    if (isLegacyWireRequest(c)) return next();
    try {
      const context = await getRequestContext(c);
      assertSessionCredential(context);
      assertCurrentUserPath(c.req.param("user"), context.user.id);
      const tokens = await listMemosPersonalAccessTokens(
        context.db,
        context.authUserId,
      );
      return c.json({
        personalAccessTokens: tokens.map((token) =>
          personalAccessTokenToDto(token, context.user.id),
        ),
      });
    } catch (error) {
      return currentJsonError(c, error);
    }
  });

  app.post("/users/:user/personalAccessTokens", async (c, next) => {
    if (isLegacyWireRequest(c)) return next();
    try {
      const context = await getRequestContext(c);
      assertSessionCredential(context);
      assertCurrentUserPath(c.req.param("user"), context.user.id);
      const body = currentPatBodySchema.parse(await readCurrentJsonObject(c));
      const { createFlareMoAuth } = await loadAuthFactory();
      const auth = createFlareMoAuth(c.env, context.db);
      const created = await createMemosPersonalAccessToken(auth, {
        userId: context.authUserId,
        name: body.description,
        // Compatibility clients used 0 for "no explicit lifetime". The helper
        // maps that legacy value to the same 90-day default as the account UI.
        expiresInDays: body.expiresInDays,
      });
      return noStoreResponse(
        c.json({
          personalAccessToken: personalAccessTokenToDto(
            created,
            context.user.id,
          ),
          token: created.key,
        }),
      );
    } catch (error) {
      return currentJsonError(c, error);
    }
  });

  app.delete("/users/:user/personalAccessTokens/:token", async (c, next) => {
    if (isLegacyWireRequest(c)) return next();
    try {
      const context = await getRequestContext(c);
      assertSessionCredential(context);
      assertCurrentUserPath(c.req.param("user"), context.user.id);
      const tokenId = c.req.param("token").split("/").at(-1) ?? "";
      const existing = await getMemosPersonalAccessToken(context.db, {
        authUserId: context.authUserId,
        keyId: tokenId,
      });
      if (!existing) throw new NotFoundError("Personal access token not found");
      const { createFlareMoAuth } = await loadAuthFactory();
      await createFlareMoAuth(c.env, context.db).api.updateApiKey({
        body: {
          configId: "memos",
          keyId: existing.id,
          userId: context.authUserId,
          enabled: false,
        },
      });
      return c.body(null, 200);
    } catch (error) {
      return currentJsonError(c, error);
    }
  });

  app.get("/users/:user", async (c, next) => {
    if (isLegacyWireRequest(c)) return next();
    try {
      const context = await getRequestContext(c);
      const userId = normalizeUserName(c.req.param("user"));
      const user = await getFlaremoUserCached(context.db, userId);
      if (!user) throw new NotFoundError("User not found");
      return c.json(
        await memosCompatUserDto(context.db, user, context.user.id),
      );
    } catch (error) {
      return currentJsonError(c, error);
    }
  });

  app.delete("/users/:user", async (c, next) => {
    if (isLegacyWireRequest(c)) return next();
    try {
      const context = await getRequestContext(c);
      assertOwnerUser(context);
      const userId = normalizeUserName(c.req.param("user"));
      if (userId === context.user.id) {
        throw new ForbiddenError("You cannot delete your own account");
      }
      const artifacts = await beginFlaremoMemberRemoval(context.db, userId);
      await cleanupFlaremoArtifacts(c.env, artifacts);
      await finalizeFlaremoMemberRemoval(context.db, userId, artifacts);
      return c.body(null, 200);
    } catch (error) {
      return currentJsonError(c, error);
    }
  });
}
