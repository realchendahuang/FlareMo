import { FLAREMO_API_VERSION } from "@flaremo/contracts/constants";
import {
  canManageVoiceService,
  countOrganizationMembers,
  getBranding,
  getMembershipState,
  isInstanceOwner,
  updateFlaremoUserProfile,
  ValidationError,
} from "@flaremo/domain";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { z } from "zod";
import { getRequestContext, type HonoBindings } from "../../context";
import { jsonError } from "../../http";
import { getAuthUserCached } from "../../identity-cache";
import { normalizeGitHubRepository } from "./helpers";

const FLAREMO_RELEASES_URL =
  "https://github.com/realchendahuang/FlareMo/releases";
const FLAREMO_UPDATE_GUIDE_URL =
  "https://github.com/realchendahuang/FlareMo/blob/main/docs/update.md";

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  avatar_url: z.string().nullable().optional(),
});

export function registerMeRoutes(app: Hono<HonoBindings>) {
  app.get("/me", async (c) => {
    try {
      const { db, user, authUserId, authUser } = await getRequestContext(c);
      // Browser sessions carry the auth identity inside the (session-cached)
      // Better Auth session, so no extra D1 lookup is needed; non-browser
      // credentials fall back to the TTL-cached row read.
      const resolvedAuthUser =
        authUser ?? (await getAuthUserCached(db, authUserId));
      // Drives the workspace sidebar: the team space entry renders only when
      // the viewer holds an unexpired membership, labelled with the
      // organization name. team_expired distinguishes "membership lapsed"
      // (reader seat past its expiry) from "never joined" so the UI can show
      // a renewal notice instead of silently hiding the space, and
      // reader_expires_at lets the reader see their own seat's validity.
      const state = await getMembershipState(db, authUserId);
      const teamExpired =
        state?.role === "reader" &&
        state.expiresAt !== null &&
        state.expiresAt.getTime() <= Date.now();
      const memberCount =
        state && !teamExpired
          ? await countOrganizationMembers(db, state.organizationId)
          : 0;
      const avatarUrl = user.avatarUrl ?? resolvedAuthUser?.image ?? null;
      return c.json({
        id: user.id,
        role: user.teamRole,
        is_instance_owner: isInstanceOwner(user),
        can_manage_voice_service: canManageVoiceService(user),
        status: user.status,
        name: user.name,
        email: resolvedAuthUser?.email ?? user.email,
        username: resolvedAuthUser?.username ?? user.id.replace(/^users\//, ""),
        avatar_url: avatarUrl,
        team:
          state && !teamExpired
            ? {
                id: state.organizationId,
                name: state.organizationName,
                member_count: memberCount,
              }
            : null,
        team_expired: teamExpired,
        ...(state?.role === "reader"
          ? {
              reader_expires_at: state.expiresAt
                ? state.expiresAt.toISOString()
                : null,
            }
          : {}),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.patch("/me", zValidator("json", updateProfileSchema), async (c) => {
    try {
      const { db, user, authUserId } = await getRequestContext(c);
      const input = c.req.valid("json");
      const updatedUser = await updateFlaremoUserProfile(db, user, {
        name: input.name,
        avatarUrl: input.avatar_url,
        authUserId,
      });
      return c.json({
        ok: true,
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          avatar_url: updatedUser.avatarUrl,
        },
      });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.put("/me/avatar", async (c) => {
    try {
      const { db, user, authUserId } = await getRequestContext(c);
      const contentType = c.req.header("content-type") ?? null;
      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
      ];
      if (!contentType || !allowedTypes.includes(contentType.toLowerCase())) {
        throw new ValidationError(
          `Avatar must be one of: ${allowedTypes.join(", ")}.`,
        );
      }
      const bytes = await c.req.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) {
        throw new ValidationError("Avatar must be between 1 byte and 2MB.");
      }
      const bareUserId = user.id.replace(/^users\//, "");
      const ext = contentType.includes("webp")
        ? "webp"
        : contentType.includes("png")
          ? "png"
          : contentType.includes("gif")
            ? "gif"
            : "jpg";
      const key = `avatars/users/${bareUserId}.${ext}`;
      await c.env.ATTACHMENTS.put(key, bytes, {
        httpMetadata: { contentType },
      });
      const avatarUrl = `/api/app/avatar/${encodeURIComponent(bareUserId)}?v=${Date.now()}`;
      await updateFlaremoUserProfile(db, user, {
        avatarUrl,
        authUserId,
      });
      return c.json({ ok: true, avatar_url: avatarUrl });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.delete("/me/avatar", async (c) => {
    try {
      const { db, user, authUserId } = await getRequestContext(c);
      const bareUserId = user.id.replace(/^users\//, "");
      for (const ext of ["webp", "png", "gif", "jpg"]) {
        await c.env.ATTACHMENTS.delete(
          `avatars/users/${bareUserId}.${ext}`,
        ).catch(() => undefined);
      }
      await updateFlaremoUserProfile(db, user, {
        avatarUrl: null,
        authUserId,
      });
      return c.json({ ok: true, avatar_url: null });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/avatar/:userId", async (c) => {
    const userId = c.req.param("userId");
    for (const ext of ["webp", "png", "jpg", "gif"]) {
      const object = await c.env.ATTACHMENTS.get(
        `avatars/users/${userId}.${ext}`,
      );
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        headers.set("Cache-Control", "public, max-age=3600");
        return new Response(object.body, { headers });
      }
    }
    return c.json({ error: { message: "Avatar not found" } }, 404);
  });

  app.get("/health", async (c) => {
    try {
      const { db } = await getRequestContext(c);
      const repository = normalizeGitHubRepository(
        c.env.FLAREMO_DEPLOY_REPOSITORY,
      );
      const branding = await getBranding(db);
      return c.json({
        ok: true,
        product: branding.product,
        version: FLAREMO_API_VERSION,
        update_repository: repository,
        update_workflow_url: repository
          ? `https://github.com/${repository}/actions/workflows/flaremo-update.yml`
          : null,
        releases_url: FLAREMO_RELEASES_URL,
        update_guide_url: FLAREMO_UPDATE_GUIDE_URL,
        // Memo vector partition layout (see docs/vector-namespace-design.md).
        team_layout:
          (c.env.FLAREMO_VECTORIZE_TEAM_LAYOUT ?? "team").trim() === "solo"
            ? "solo"
            : "team",
        // Non-secret capability flags the UI needs (e.g. to explain that the
        // forgot-password flow is closed when no email provider is configured).
        email_provider: (c.env.FLAREMO_EMAIL_PROVIDER ?? "none").trim(),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  });
}
