import { createDb, type UserRow } from "@flaremo/db";
import {
  bindMemoAttachments,
  createAttachmentMetadata,
  createMemo,
  createMemoShare,
  type DomainError,
  finalizeAttachmentDelete,
  getAttachmentById,
  getAuthUserById,
  getFlaremoUserByAuthSessionToken,
  getFlaremoUserById,
  type getMemoById,
  getMemoByIdForViewer,
  getMemosPersonalAccessToken,
  getPublicShareByToken,
  hardDeleteMemo,
  listAttachments,
  listAttachmentsForMemosForViewer,
  listMemoAttachmentsForViewer,
  listMemoRelationsForViewer,
  listMemoShares,
  listMemosForViewer,
  listMemosPersonalAccessTokens,
  markAttachmentDeleting,
  moveMemoToTrash,
  replaceMemoRelations,
  revokeAuthSessionByToken,
  revokeMemoShare,
  updateMemo,
} from "@flaremo/domain";
import {
  currentAttachmentToDto,
  currentMemoToDto,
  currentRelationToDto,
  currentShareToDto,
  currentUserToDto,
  legacyMemoState,
} from "@flaremo/memos";
import { Hono } from "hono";
import { z } from "zod";
import {
  createAttachmentObjectKey,
  MAX_ATTACHMENT_BYTES,
} from "../attachment-http";
import { createFlareMoAuth } from "../auth";
import {
  assertTrustedCookieMutation,
  getOptionalRequestContext,
  getRequestContext,
  type HonoBindings,
} from "../context";
import {
  authenticateMemosAccessToken,
  clearMemosRefreshCookie,
  getMemosRefreshToken,
  issueMemosNativeTokens,
  type MemosNativeRefreshResult,
  revokeMemosRefreshToken,
  rotateMemosRefreshToken,
} from "../memos-native-auth";

export const memosCurrentApi = new Hono<HonoBindings>();

const currentMemoBodySchema = z
  .object({
    memo: z.record(z.string(), z.unknown()).optional(),
    memoId: z.string().optional(),
    updateMask: z.string().optional(),
    name: z.string().optional(),
    state: z.string().optional(),
    creator: z.string().optional(),
    createTime: z.string().optional(),
    updateTime: z.string().optional(),
    content: z.string().optional(),
    visibility: z.string().optional(),
    pinned: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    property: z.record(z.string(), z.unknown()).optional(),
    location: z.record(z.string(), z.unknown()).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    attachments: z.array(z.record(z.string(), z.unknown())).optional(),
    relations: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

const currentSigninSchema = z.object({
  passwordCredentials: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
});

const currentRelationBodySchema = z.object({
  name: z.string().optional(),
  relations: z.array(
    z.object({
      memo: z.record(z.string(), z.unknown()).optional(),
      relatedMemo: z.record(z.string(), z.unknown()).optional(),
      type: z.string().optional(),
      related_memo: z.string().optional(),
    }),
  ),
});

const currentShareBodySchema = z
  .object({
    memoShare: z.record(z.string(), z.unknown()).optional(),
    name: z.string().optional(),
    createTime: z.string().optional(),
    expireTime: z.string().datetime().nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .passthrough();

const currentAttachmentBodySchema = z
  .object({
    attachment: z.record(z.string(), z.unknown()).optional(),
    attachmentId: z.string().optional(),
    name: z.string().optional(),
    createTime: z.string().optional(),
    filename: z.string().trim().min(1).max(512).optional(),
    content: z.string().optional(),
    externalLink: z.string().url().optional(),
    type: z.string().trim().min(1).max(255).optional(),
    memo: z.string().nullable().optional(),
  })
  .passthrough();

const currentPatBodySchema = z.object({
  description: z.string().trim().min(1).max(32).optional(),
  expiresInDays: z.number().int().min(0).max(365).optional(),
});

const currentAttachmentPatchBodySchema = z
  .object({
    attachment: z.record(z.string(), z.unknown()).optional(),
    updateMask: z.string().optional(),
    name: z.string().optional(),
    memo: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * The default `/api/v1` representation is the current Memos protobuf-JSON
 * shape. The previous FlareMo snake_case surface remains available by sending
 * `X-FlareMo-Wire: legacy` (or the matching vendor Accept value); the route
 * then falls through to the original handler mounted after this app.
 */
export function isLegacyWireRequest(c: {
  req: { header(name: string): string | undefined };
}) {
  return (
    c.req.header("x-flaremo-wire")?.toLowerCase() === "legacy" ||
    c.req
      .header("accept")
      ?.toLowerCase()
      .includes("application/vnd.flaremo.legacy+json") === true
  );
}

memosCurrentApi.get("/auth/me", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getRequestContext(c);
    return c.json({ user: await currentUserForContext(context) });
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.post("/auth/signin", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    // This endpoint creates a browser cookie as well as returning the opaque
    // session-backed access token. Treat it as a cookie mutation even when a
    // Memos-compatible client chooses to use the bearer token afterward.
    assertTrustedCookieMutation(c);
    const credentials = currentSigninSchema.parse(
      await c.req.json(),
    ).passwordCredentials;
    const dbContext = await createAuthContext(c);
    const result = await dbContext.auth.api.signInUsername({
      body: {
        username: credentials.username,
        password: credentials.password,
        rememberMe: true,
      },
      headers: c.req.raw.headers,
      asResponse: false,
      returnHeaders: true,
    });
    const session = await getFlaremoUserByAuthSessionToken(
      dbContext.db,
      result.response.token,
    );
    if (!session) {
      throw new Error(
        "Better Auth returned a session that could not be resolved",
      );
    }
    const nativeTokens = await issueMemosNativeTokens({
      db: dbContext.db,
      env: c.env,
      authUserId: session.authUserId,
      user: session.user,
      request: c.req.raw,
    });
    const response = c.json(
      {
        user: await currentUserForContext({
          ...dbContext,
          user: session.user,
          authUserId: session.authUserId,
        }),
        accessToken: nativeTokens.accessToken,
        accessTokenExpiresAt: nativeTokens.accessTokenExpiresAt.toISOString(),
      },
      200,
    );
    copyHeaders(response.headers, result.headers);
    response.headers.append("set-cookie", nativeTokens.refreshCookie);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.post("/auth/refresh", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const authorization = c.req.header("authorization");
    if (authorization) {
      const token = parseBearerToken(authorization);
      const bearerContext = await getRequestContext(c);
      const nativeAccess = await authenticateMemosAccessToken({
        db: bearerContext.db,
        env: c.env,
        token,
      });
      if (nativeAccess) {
        // A native refresh is cookie-authenticated. If a caller also sends a
        // bearer token, it is only an optional user-binding check; the
        // refresh token itself must still be present in memos_refresh.
        if (c.req.raw.headers.get("cookie")) {
          assertTrustedCookieMutation(c);
        }
        if (getMemosRefreshToken(c.req.raw.headers)) {
          const rotated = await rotateMemosRefreshToken({
            db: bearerContext.db,
            env: c.env,
            request: c.req.raw,
            expectedAuthUserId: nativeAccess.authUserId,
          });
          if (!rotated) throw new UnauthorizedCurrentError();
          return nativeRefreshResponse(c, rotated);
        }

        // Preserve the previous FlareMo session-bearer facade for clients
        // that have not adopted the new refresh cookie yet. This compatibility
        // response is not a refresh operation and cannot mint a new token.
        const authContext = await createAuthContext(c);
        const session = await authContext.auth.api.getSession({
          headers: c.req.raw.headers,
          query: { disableCookieCache: true },
        });
        if (!session || session.user.id !== nativeAccess.authUserId) {
          throw new UnauthorizedCurrentError();
        }
        return noStoreResponse(
          c.json({
            accessToken: token,
            expiresAt: new Date(
              nativeAccess.claims.expiresAt * 1_000,
            ).toISOString(),
          }),
        );
      }

      // Existing opaque Better Auth session bearers remain accepted here for
      // compatibility. A Memos PAT is an application credential, not a
      // refreshable browser session.
      if (!bearerContext.bearerSession || !bearerContext.session) {
        throw new UnauthorizedCurrentError();
      }
      return noStoreResponse(
        c.json({
          accessToken: token,
          expiresAt: bearerContext.session.expiresAt.toISOString(),
        }),
      );
    }

    assertTrustedCookieMutation(c);
    const rotated = await rotateMemosRefreshToken({
      db: (await createAuthContext(c)).db,
      env: c.env,
      request: c.req.raw,
    });
    if (!rotated) throw new UnauthorizedCurrentError();
    return nativeRefreshResponse(c, rotated);
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.post("/auth/signout", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const authorization = c.req.header("authorization");
    if (authorization) {
      const token = parseBearerToken(authorization);
      const context = await getRequestContext(c);
      const hasCookie = Boolean(c.req.raw.headers.get("cookie"));
      if (hasCookie) assertTrustedCookieMutation(c);

      if (context.nativeAccessToken) {
        await revokeMemosRefreshToken({
          db: context.db,
          env: c.env,
          headers: c.req.raw.headers,
          expectedAuthUserId: context.authUserId,
        });
        if (hasCookie) {
          const response = await signOutCookieSession(c, context.db);
          return appendMemosRefreshClearCookie(response, c.req.raw);
        }
        return appendMemosRefreshClearCookie(c.body(null, 200), c.req.raw);
      }

      if (context.credential === "pat") {
        // A PAT does not have a browser session to revoke, but it still must
        // be valid. Do not return success for arbitrary bearer strings.
        if (hasCookie) {
          const response = await signOutCookieSession(c, context.db);
          return appendMemosRefreshClearCookie(response, c.req.raw);
        }
        return c.body(null, 200);
      }

      await revokeAuthSessionByToken(context.db, token);
      if (hasCookie) {
        const response = await signOutCookieSession(c, context.db);
        return appendMemosRefreshClearCookie(response, c.req.raw);
      }
      return c.body(null, 200);
    }

    const context = await getRequestContext(c);
    await revokeMemosRefreshToken({
      db: context.db,
      env: c.env,
      headers: c.req.raw.headers,
      expectedAuthUserId: context.authUserId,
    });
    const response = await signOutCookieSession(c, context.db);
    return appendMemosRefreshClearCookie(response, c.req.raw);
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.get("/memos", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getOptionalRequestContext(c);
    const result = await listMemosForViewer(
      context.db,
      context.user,
      currentListQuery(c),
    );
    const attachments = await listAttachmentsForMemosForViewer(
      context.db,
      context.user,
      result.memos.map((memo) => memo.id),
    );
    const byMemo = new Map<string, typeof attachments>();
    for (const attachment of attachments) {
      if (!attachment.memoId) continue;
      const values = byMemo.get(attachment.memoId) ?? [];
      values.push(attachment);
      byMemo.set(attachment.memoId, values);
    }
    return c.json({
      memos: await Promise.all(
        result.memos.map(async (memo) =>
          currentMemoToDto(memo, await currentMemoCreator(context, memo), {
            attachments: byMemo.get(memo.id) ?? [],
          }),
        ),
      ),
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    });
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.post("/memos", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const body = unwrapMemoBody(
      currentMemoBodySchema.parse(await c.req.json()),
    );
    if (body.memoId) {
      throw new ValidationCurrentError(
        "memoId is not supported; FlareMo generates memo resource names",
      );
    }
    if (typeof body.content !== "string" || !body.content.trim()) {
      throw new ValidationCurrentError("Memo content is required");
    }
    const context = await getRequestContext(c);
    const memo = await createMemo(context.db, context.user, {
      content: body.content.trim(),
      visibility: currentVisibilityToLegacy(body.visibility),
      payload: currentPayload(body),
      source: "memos-api",
    });
    return c.json(await currentMemoWithDetails(context, memo));
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.get("/memos/:memo", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getOptionalRequestContext(c);
    const memo = await getMemoByIdForViewer(
      context.db,
      context.user,
      normalizeMemoName(c.req.param("memo")),
    );
    return c.json(await currentMemoWithDetails(context, memo));
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.patch("/memos/:memo", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const body = unwrapMemoBody(
      currentMemoBodySchema.parse(await c.req.json()),
    );
    const updateMask = parseUpdateMask(
      c.req.query("updateMask") ?? body.updateMask,
    );
    const input = currentUpdateInput(body, updateMask);
    const context = await getRequestContext(c);
    const memo = await updateMemo(
      context.db,
      context.user,
      normalizeMemoName(c.req.param("memo")),
      input,
    );
    return c.json(await currentMemoWithDetails(context, memo));
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.delete("/memos/:memo", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getRequestContext(c);
    const name = normalizeMemoName(c.req.param("memo"));
    if (c.req.query("force") === "true") {
      await hardDeleteMemo(context.db, context.user, name);
    } else {
      await moveMemoToTrash(context.db, context.user, name);
    }
    return c.body(null, 200);
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.get("/memos/:memo/attachments", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getOptionalRequestContext(c);
    const attachments = await listMemoAttachmentsForViewer(
      context.db,
      context.user,
      normalizeMemoName(c.req.param("memo")),
    );
    return c.json({ attachments: attachments.map(currentAttachmentToDto) });
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.patch("/memos/:memo/attachments", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const body = unwrapMemoBody(
      currentMemoBodySchema.parse(await c.req.json()),
    );
    const names = (body.attachments ?? []).flatMap((attachment) =>
      typeof attachment.name === "string" ? [attachment.name] : [],
    );
    const context = await getRequestContext(c);
    await bindMemoAttachments(
      context.db,
      context.user,
      normalizeMemoName(c.req.param("memo")),
      names,
    );
    return c.body(null, 200);
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.get("/memos/:memo/relations", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getOptionalRequestContext(c);
    const relations = await currentRelations(
      context,
      normalizeMemoName(c.req.param("memo")),
    );
    return c.json({ relations });
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.patch("/memos/:memo/relations", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const body = currentRelationBodySchema.parse(await c.req.json());
    const memoName = normalizeMemoName(c.req.param("memo"));
    const relationInput = body.relations.flatMap((relation) => {
      const relatedName =
        relation.related_memo ??
        (isRecord(relation.relatedMemo) &&
        typeof relation.relatedMemo.name === "string"
          ? relation.relatedMemo.name
          : undefined);
      if (!relatedName) return [];
      return [
        {
          related_memo: relatedName,
          type: currentRelationToLegacy(relation.type),
        },
      ];
    });
    const context = await getRequestContext(c);
    await replaceMemoRelations(context.db, context.user, memoName, {
      relations: relationInput,
    });
    return c.body(null, 200);
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.get("/memos/:memo/shares", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getRequestContext(c);
    const shares = await listMemoShares(
      context.db,
      context.user,
      normalizeMemoName(c.req.param("memo")),
    );
    return c.json({ memoShares: shares.map(currentShareToDto) });
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.post("/memos/:memo/shares", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const body = unwrapShareBody(
      currentShareBodySchema.parse(await c.req.json()),
    );
    const context = await getRequestContext(c);
    const share = await createMemoShare(
      context.db,
      context.user,
      normalizeMemoName(c.req.param("memo")),
      {
        expires_at: body.expireTime ?? body.expiresAt ?? null,
      },
    );
    return c.json(currentShareToDto(share));
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.delete("/memos/:memo/shares/:share", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getRequestContext(c);
    await revokeMemoShare(context.db, context.user, c.req.param("share"));
    return c.body(null, 200);
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.get("/shares/:shareToken", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const db = (await createAuthContext(c)).db;
    const share = await getPublicShareByToken(db, c.req.param("shareToken"));
    return c.json(
      currentMemoToDto(share.memo, share.user, {
        attachments: share.attachments,
      }),
    );
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.get("/shares/:shareToken/memo", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const db = (await createAuthContext(c)).db;
    const share = await getPublicShareByToken(db, c.req.param("shareToken"));
    return c.json(
      currentMemoToDto(share.memo, share.user, {
        attachments: share.attachments,
      }),
    );
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.get("/attachments", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getRequestContext(c);
    const attachments = await listAttachments(context.db, context.user, {
      memoId: c.req.query("memo"),
      pageSize: parsePageSize(c.req.query("pageSize"), 50),
    });
    return c.json({ attachments: attachments.map(currentAttachmentToDto) });
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.post("/attachments", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  if (
    !c.req.header("content-type")?.toLowerCase().includes("application/json")
  ) {
    return next();
  }
  try {
    const body = unwrapAttachmentBody(
      currentAttachmentBodySchema.parse(await c.req.json()),
    );
    if (body.attachmentId) {
      throw new ValidationCurrentError(
        "attachmentId is not supported; FlareMo generates attachment resource names",
      );
    }
    if (body.externalLink) {
      throw new ValidationCurrentError(
        "External attachments are not supported by FlareMo",
      );
    }
    if (!body.content)
      throw new ValidationCurrentError("Attachment content is required");
    const filename = currentRequiredString(body.filename, "filename");
    const type = currentRequiredString(body.type, "type");
    const bytes = decodeBase64(body.content);
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeCurrentError(
        "Attachment exceeds the 25 MiB limit",
      );
    }
    const context = await getRequestContext(c);
    const objectKey = createAttachmentObjectKey(
      context.user.id,
      filename,
      "memos",
    );
    const object = await c.env.ATTACHMENTS.put(objectKey, bytes, {
      httpMetadata: { contentType: type },
    });
    try {
      const attachment = await createAttachmentMetadata(
        context.db,
        context.user,
        {
          memoId: body.memo ?? null,
          filename,
          contentType: type,
          size: bytes.byteLength,
          r2Key: objectKey,
          etag: object.httpEtag,
        },
      );
      return c.json(currentAttachmentToDto(attachment));
    } catch (error) {
      await c.env.ATTACHMENTS.delete(objectKey);
      throw error;
    }
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.get("/attachments/:attachment", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getRequestContext(c);
    const attachment = await getAttachmentById(
      context.db,
      context.user,
      normalizeAttachmentName(c.req.param("attachment")),
    );
    return c.json(currentAttachmentToDto(attachment));
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.patch("/attachments/:attachment", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const rawBody = currentAttachmentPatchBodySchema.parse(await c.req.json());
    const body = unwrapAttachmentPatchBody(rawBody);
    const updateMask = parseUpdateMask(
      c.req.query("updateMask") ?? rawBody.updateMask,
    );
    if (!updateMask.every((field) => field === "memo")) {
      throw new ValidationCurrentError(
        "Only the attachment memo field is mutable",
      );
    }
    if (!body.memo) throw new ValidationCurrentError("A memo is required");
    const context = await getRequestContext(c);
    const attachment = await getAttachmentById(
      context.db,
      context.user,
      normalizeAttachmentName(c.req.param("attachment")),
    );
    await bindMemoAttachments(context.db, context.user, body.memo, [
      attachment.id,
    ]);
    const updated = await getAttachmentById(
      context.db,
      context.user,
      attachment.id,
    );
    return c.json(currentAttachmentToDto(updated));
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.delete("/attachments/:attachment", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getRequestContext(c);
    const attachment = await markAttachmentDeleting(
      context.db,
      context.user,
      normalizeAttachmentName(c.req.param("attachment")),
    );
    await c.env.ATTACHMENTS.delete(attachment.r2Key);
    await finalizeAttachmentDelete(context.db, context.user, attachment.id);
    return c.body(null, 200);
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.get("/users", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getRequestContext(c);
    return c.json({ users: [await currentUserForContext(context)] });
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.get("/users/:user/personalAccessTokens", async (c, next) => {
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
        currentPatToDto(token, context.user.id),
      ),
    });
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.post("/users/:user/personalAccessTokens", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getRequestContext(c);
    assertSessionCredential(context);
    assertCurrentUserPath(c.req.param("user"), context.user.id);
    const body = currentPatBodySchema.parse(await c.req.json());
    const auth = createFlareMoAuth(c.env, context.db);
    const created = await auth.api.createApiKey({
      body: {
        configId: "memos",
        userId: context.authUserId,
        name: body.description ?? "Memos API token",
        expiresIn:
          body.expiresInDays === 0 || body.expiresInDays === undefined
            ? null
            : body.expiresInDays * 24 * 60 * 60,
      },
    });
    return noStoreResponse(
      c.json({
        personalAccessToken: currentPatToDto(created, context.user.id),
        token: created.key,
      }),
    );
  } catch (error) {
    return currentJsonError(c, error);
  }
});

memosCurrentApi.delete(
  "/users/:user/personalAccessTokens/:token",
  async (c, next) => {
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
      if (!existing)
        throw new NotFoundCurrentError("Personal access token not found");
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
  },
);

memosCurrentApi.get("/users/:user", async (c, next) => {
  if (isLegacyWireRequest(c)) return next();
  try {
    const context = await getRequestContext(c);
    assertCurrentUserPath(c.req.param("user"), context.user.id);
    return c.json(await currentUserForContext(context));
  } catch (error) {
    return currentJsonError(c, error);
  }
});

async function currentMemoWithDetails(
  context: Awaited<ReturnType<typeof getOptionalRequestContext>>,
  memo: Awaited<ReturnType<typeof getMemoById>>,
) {
  const [attachments, relations] = await Promise.all([
    listMemoAttachmentsForViewer(context.db, context.user, memo.id),
    currentRelations(context, memo.id),
  ]);
  return currentMemoToDto(memo, await currentMemoCreator(context, memo), {
    attachments,
    relations,
  });
}

async function currentRelations(
  context: Awaited<ReturnType<typeof getOptionalRequestContext>>,
  memoId: string,
) {
  await getMemoByIdForViewer(context.db, context.user, memoId, {
    includeDeleted: true,
  });
  const rows = await listMemoRelationsForViewer(
    context.db,
    context.user,
    memoId,
  );
  const related = await Promise.all(
    rows.map(async (relation) => {
      try {
        const [memo, relatedMemo] = await Promise.all([
          getMemoByIdForViewer(context.db, context.user, relation.memoId, {
            includeDeleted: true,
          }),
          getMemoByIdForViewer(
            context.db,
            context.user,
            relation.relatedMemoId,
            { includeDeleted: true },
          ),
        ]);
        return currentRelationToDto(relation, memo, relatedMemo);
      } catch {
        return null;
      }
    }),
  );
  return related.filter(
    (value): value is NonNullable<typeof value> => value !== null,
  );
}
async function currentMemoCreator(
  context: Awaited<ReturnType<typeof getOptionalRequestContext>>,
  memo: Awaited<ReturnType<typeof getMemoById>>,
) {
  if (context.user?.id === memo.userId) return context.user;
  const creator = await getFlaremoUserById(context.db, memo.userId);
  if (!creator) throw new Error("Memo creator not found");
  return creator;
}

async function currentUserForContext(context: {
  db: ReturnType<typeof createDb>;
  user: UserRow;
  authUserId: string;
}) {
  return currentUserToDto(
    context.user,
    await getAuthUserById(context.db, context.authUserId),
  );
}

async function createAuthContext(c: Parameters<typeof getRequestContext>[0]) {
  const db = createDb(c.env.DB);
  return { db, auth: createFlareMoAuth(c.env, db) };
}

function assertSessionCredential(
  context: Awaited<ReturnType<typeof getRequestContext>>,
) {
  // PATs authorize memo data, but a credential-management endpoint must not
  // let a leaked PAT mint or revoke additional PATs. Cookie sessions and the
  // opaque Better Auth session bearer returned by the auth facade are allowed.
  if (context.credential === "pat") throw new UnauthorizedCurrentError();
}

function currentListQuery(c: Parameters<typeof getRequestContext>[0]) {
  const rawOrderBy = c.req.query("orderBy") ?? "create_time desc";
  const orderBy = normalizeCurrentOrderBy(rawOrderBy);
  const rawState = c.req.query("state");
  const state = legacyMemoState(rawState);
  if (rawState && rawState !== "STATE_UNSPECIFIED" && !state) {
    throw new ValidationCurrentError(`Unsupported memo state: ${rawState}`);
  }
  if (state === "trashed" || state === "deleted") {
    throw new ValidationCurrentError(
      "Current Memos only exposes NORMAL and ARCHIVED list states",
    );
  }
  const filter = parseCurrentFilter(c.req.query("filter"));
  return {
    page_size: parsePageSize(c.req.query("pageSize"), 50),
    page_token: c.req.query("pageToken"),
    order_by: orderBy,
    ...(state ? { state } : {}),
    ...(filter.expression ? { filter: filter.expression } : {}),
    include_deleted: c.req.query("showDeleted") === "true",
  };
}

function parseCurrentFilter(filter: string | undefined) {
  return filter?.trim() ? { expression: filter.trim() } : {};
}

function currentPayload(body: z.infer<typeof currentMemoBodySchema>) {
  const payload = { ...(body.payload ?? {}) };
  if (body.tags) payload.tags = body.tags;
  if (body.property) {
    payload.property = {
      ...(typeof body.property.title === "string"
        ? { title: body.property.title }
        : {}),
      ...(typeof body.property.hasLink === "boolean"
        ? { has_link: body.property.hasLink }
        : {}),
      ...(typeof body.property.hasTaskList === "boolean"
        ? { has_task_list: body.property.hasTaskList }
        : {}),
      ...(typeof body.property.hasCode === "boolean"
        ? { has_code: body.property.hasCode }
        : {}),
      ...(typeof body.property.hasIncompleteTasks === "boolean"
        ? { has_incomplete_tasks: body.property.hasIncompleteTasks }
        : {}),
    };
  }
  if (body.location) payload.location = body.location;
  return payload;
}

function unwrapMemoBody(body: z.infer<typeof currentMemoBodySchema>) {
  const nested = isRecord(body.memo) ? body.memo : undefined;
  return {
    ...body,
    ...(nested ?? {}),
  };
}

function unwrapShareBody(body: z.infer<typeof currentShareBodySchema>) {
  const nested = isRecord(body.memoShare) ? body.memoShare : undefined;
  return {
    ...body,
    ...(nested ?? {}),
  };
}

function unwrapAttachmentBody(
  body: z.infer<typeof currentAttachmentBodySchema>,
) {
  const nested = isRecord(body.attachment) ? body.attachment : undefined;
  return {
    ...body,
    ...(nested ?? {}),
  };
}

function unwrapAttachmentPatchBody(
  body: z.infer<typeof currentAttachmentPatchBodySchema>,
) {
  const nested = isRecord(body.attachment) ? body.attachment : undefined;
  return {
    ...body,
    ...(nested ?? {}),
  };
}

function currentUpdateInput(
  body: z.infer<typeof currentMemoBodySchema>,
  updateMask: string[],
) {
  const fields = updateMask.includes("*")
    ? [
        "content",
        "visibility",
        "state",
        "pinned",
        "property",
        "location",
        "tags",
      ]
    : updateMask;
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    if (field === "content") {
      if (body.content === undefined)
        throw new ValidationCurrentError("content is required by updateMask");
      input.content = body.content;
    } else if (field === "visibility") {
      if (body.visibility === undefined)
        throw new ValidationCurrentError(
          "visibility is required by updateMask",
        );
      input.visibility = currentVisibilityToLegacy(body.visibility);
    } else if (field === "state") {
      if (body.state === undefined)
        throw new ValidationCurrentError("state is required by updateMask");
      const state = legacyMemoState(body.state);
      if (!state || state === "trashed" || state === "deleted") {
        throw new ValidationCurrentError(
          "Only NORMAL and ARCHIVED memo states are supported by current Memos",
        );
      }
      input.status = state;
    } else if (field === "pinned") {
      if (body.pinned === undefined)
        throw new ValidationCurrentError("pinned is required by updateMask");
      input.pinned = body.pinned;
    } else if (
      field === "property" ||
      field === "location" ||
      field === "tags" ||
      field === "payload"
    ) {
      input.payload = currentPayload(body);
    } else {
      throw new ValidationCurrentError(
        `Unsupported updateMask field: ${field}`,
      );
    }
  }
  if (Object.keys(input).length === 0)
    throw new ValidationCurrentError("updateMask is required");
  return input as Parameters<typeof updateMemo>[3];
}

function currentVisibilityToLegacy(value: string | undefined) {
  const normalized = (value ?? "PRIVATE").toLowerCase();
  if (
    normalized === "private" ||
    normalized === "protected" ||
    normalized === "public"
  ) {
    return normalized;
  }
  throw new ValidationCurrentError(`Unsupported memo visibility: ${value}`);
}

function currentRelationToLegacy(
  value: string | undefined,
): "reference" | "comment" {
  const normalized = (value ?? "REFERENCE").toLowerCase();
  if (normalized === "reference" || normalized === "comment") return normalized;
  throw new ValidationCurrentError(`Unsupported memo relation type: ${value}`);
}

function parseUpdateMask(value: string | undefined) {
  const fields = (value ?? "")
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.length === 0)
    throw new ValidationCurrentError("updateMask is required");
  return fields;
}

function normalizeCurrentOrderBy(value: string) {
  const match = /^(create_time|update_time)\s+(asc|desc)$/i.exec(value.trim());
  if (!match) {
    throw new ValidationCurrentError(
      "Only a single create_time or update_time order is supported",
    );
  }
  return `${match[1]?.toLowerCase().startsWith("update") ? "updated_at" : "created_at"} ${match[2]?.toLowerCase()}` as
    | "created_at asc"
    | "created_at desc"
    | "updated_at asc"
    | "updated_at desc";
}

function parsePageSize(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new ValidationCurrentError("pageSize must be a positive integer");
  return Math.min(parsed, 100);
}

function parseBearerToken(value: string) {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer" || !parts[1]) {
    throw new UnauthorizedCurrentError();
  }
  return parts[1];
}

function normalizeMemoName(value: string) {
  return value.startsWith("memos/") ? value : `memos/${value}`;
}

function normalizeAttachmentName(value: string) {
  return value.startsWith("attachments/") ? value : `attachments/${value}`;
}

function assertCurrentUserPath(value: string, currentUserId: string) {
  const expected = currentUserId.replace(/^users\//, "");
  const normalized = value.startsWith("users/")
    ? value.replace(/^users\//, "")
    : value;
  if (normalized !== expected)
    throw new ForbiddenCurrentError("Only the current user is available");
}

function currentPatToDto(
  token: {
    id: string;
    name: string | null;
    createdAt: Date;
    expiresAt: Date | null;
    lastRequest: Date | null;
  },
  userId: string,
) {
  return {
    name: `${userId}/personalAccessTokens/${token.id}`,
    ...(token.name ? { description: token.name } : {}),
    createdAt: token.createdAt.toISOString(),
    ...(token.expiresAt ? { expiresAt: token.expiresAt.toISOString() } : {}),
    ...(token.lastRequest
      ? { lastUsedAt: token.lastRequest.toISOString() }
      : {}),
  };
}

function decodeBase64(value: string) {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new ValidationCurrentError("Attachment content must be valid base64");
  }
}

function currentRequiredString(value: string | undefined, field: string) {
  if (!value?.trim()) {
    throw new ValidationCurrentError(`${field} is required`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyHeaders(target: Headers, source: Headers) {
  source.forEach((value, key) => {
    target.append(key, value);
  });
}

function noStoreResponse(response: Response) {
  response.headers.set("cache-control", "no-store");
  return response;
}

function nativeRefreshResponse(
  c: Parameters<typeof getRequestContext>[0],
  result: MemosNativeRefreshResult,
) {
  const response = noStoreResponse(
    c.json({
      accessToken: result.accessToken,
      expiresAt: result.accessTokenExpiresAt.toISOString(),
    }),
  );
  response.headers.append("set-cookie", result.refreshCookie);
  return response;
}

function appendMemosRefreshClearCookie(response: Response, request: Request) {
  response.headers.append("set-cookie", clearMemosRefreshCookie(request));
  return response;
}

async function signOutCookieSession(
  c: Parameters<typeof getRequestContext>[0],
  db: ReturnType<typeof createDb>,
): Promise<Response> {
  const headers = new Headers(c.req.raw.headers);
  headers.delete("authorization");
  const request = new Request(new URL("/api/auth/sign-out", c.req.url), {
    method: "POST",
    headers,
  });
  return await createFlareMoAuth(c.env, db).handler(request);
}

function currentJsonError(
  c: Parameters<typeof getRequestContext>[0],
  error: unknown,
) {
  const status = currentErrorStatus(error);
  const message = currentErrorMessage(error);
  return c.json(
    {
      code: currentErrorCode(status),
      message,
      details: [],
    },
    status as 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500,
  );
}

function currentErrorStatus(error: unknown) {
  if (error instanceof CurrentHttpError) return error.status;
  if (isDomainError(error)) return error.status;
  if (isBetterAuthCredentialError(error)) return 400;
  if (isRecord(error) && typeof error.statusCode === "number")
    return error.statusCode;
  if (isRecord(error) && typeof error.status === "number") return error.status;
  if (isRecord(error) && Array.isArray(error.issues)) return 400;
  console.error(
    JSON.stringify({
      level: "error",
      message: "Unhandled current Memos compatibility request error",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return 500;
}

function currentErrorMessage(error: unknown) {
  if (error instanceof CurrentHttpError) return error.message;
  if (isDomainError(error)) return error.message;
  if (isBetterAuthCredentialError(error))
    return "unmatched username and password";
  if (isRecord(error) && typeof error.message === "string")
    return error.message;
  if (isRecord(error) && Array.isArray(error.issues)) {
    return error.issues
      .map((issue) =>
        isRecord(issue) && typeof issue.message === "string"
          ? issue.message
          : "Invalid request",
      )
      .join("; ");
  }
  return "Internal server error";
}

function isBetterAuthCredentialError(error: unknown) {
  return isRecord(error) && error.code === "INVALID_USERNAME_OR_PASSWORD";
}

function currentErrorCode(status: number) {
  if (status === 400 || status === 422) return 3;
  if (status === 401) return 16;
  if (status === 403) return 7;
  if (status === 404) return 5;
  if (status === 409) return 6;
  if (status === 413) return 8;
  return 13;
}

function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
  );
}

class CurrentHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

class ValidationCurrentError extends CurrentHttpError {
  constructor(message: string) {
    super(message, 400);
  }
}

class UnauthorizedCurrentError extends CurrentHttpError {
  constructor(message = "Authentication required") {
    super(message, 401);
  }
}

class ForbiddenCurrentError extends CurrentHttpError {
  constructor(message: string) {
    super(message, 403);
  }
}

class NotFoundCurrentError extends CurrentHttpError {
  constructor(message: string) {
    super(message, 404);
  }
}

class PayloadTooLargeCurrentError extends CurrentHttpError {
  constructor(message: string) {
    super(message, 413);
  }
}
