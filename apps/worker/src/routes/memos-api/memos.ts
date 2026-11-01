import {
  bindMemoAttachmentsSchema,
  createMemoSchema,
  createShareSchema,
  listAttachmentsQuerySchema,
  listMemosQuerySchema,
  patchMemoRelationsSchema,
  restoreMemoRevisionSchema,
  updateMemoSchema,
} from "@flaremo/contracts";
import {
  THUMBNAIL_CONTENT_TYPE,
  thumbnailKeyFor,
} from "@flaremo/contracts/constants";
import {
  assertAttachmentStorageQuota,
  bindMemoAttachments,
  createAttachmentMetadata,
  createMemo,
  createMemoShare,
  getAttachmentByClientId,
  getAttachmentById,
  getMemoById,
  getShareByIdOrToken,
  listAttachments,
  listMemoAttachments,
  listMemoRelations,
  listMemoRevisions,
  listMemoShares,
  listMemos,
  moveMemoToTrash,
  normalizeAttachmentClientId,
  parseAttachmentDimensions,
  parseAttachmentDuration,
  replaceMemoRelations,
  restoreMemoRevision,
  revokeMemoShare,
  updateMemo,
} from "@flaremo/domain";
import {
  attachmentToDto,
  memoRelationToDto,
  memoRevisionToDto,
  memosToListResponse,
  memoToDto,
  parseAttachmentsResourceName,
  parseMemosResourceName,
  shareToDto,
} from "@flaremo/memos";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import {
  attachmentObjectResponse,
  createAttachmentObjectKey,
  MAX_ATTACHMENT_BYTES,
  MAX_THUMBNAIL_BYTES,
} from "../../attachment-http";
import { getRequestContext, type HonoBindings } from "../../context";
import { jsonError } from "../../http";
import { buildMemoContext } from "../../memo-context";
import { hardDeleteMemoWithAttachments } from "../../memo-hard-delete";
import { deleteMemosAttachment } from "../../memos-compat/attachment-delete";

export function registerMemosRoutes(app: Hono<HonoBindings>) {
  app.get("/memos", zValidator("query", listMemosQuerySchema), async (c) => {
    try {
      const { db, user, memoFilterScanLimit } = await getRequestContext(c);
      // `space` is a FlareMo app-API concept; the Memos-compatible surface stays
      // unchanged, so a client that cannot know about it never sends it and the
      // shared schema does not widen this endpoint's behavior.
      const { space: _space, ...query } = c.req.valid("query");
      const result = await listMemos(db, user, query, {
        celScanLimit: memoFilterScanLimit,
      });
      return c.json(memosToListResponse({ ...result, user }));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post("/memos", zValidator("json", createMemoSchema), async (c) => {
    try {
      const { db, user, userLimits } = await getRequestContext(c);
      const memo = await createMemo(db, user, c.req.valid("json"), {
        userLimits,
        userId: user.id,
      });
      return c.json(memoToDto(memo, user), 201);
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/memos/:id", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const memo = await getMemoById(
        db,
        user,
        parseMemosResourceName(c.req.param("id")),
      );
      return c.json(memoToDto(memo, user));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.patch("/memos/:id", zValidator("json", updateMemoSchema), async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const memo = await updateMemo(
        db,
        user,
        parseMemosResourceName(c.req.param("id")),
        c.req.valid("json"),
      );
      return c.json(memoToDto(memo, user));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/memos/:id/relation-context", async (c) => {
    try {
      const context = await getRequestContext(c);
      const memoId = parseMemosResourceName(c.req.param("id"));
      const memoContext = await buildMemoContext(context, memoId);
      return c.json({
        relations: memoContext.relations,
        backlinks: memoContext.backlinks,
      });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/memos/:id/context", async (c) => {
    try {
      const context = await getRequestContext(c);
      return c.json(
        await buildMemoContext(
          context,
          parseMemosResourceName(c.req.param("id")),
        ),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/memos/:id/revisions", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const revisions = await listMemoRevisions(
        db,
        user,
        parseMemosResourceName(c.req.param("id")),
      );
      return c.json({ revisions: revisions.map(memoRevisionToDto) });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.post(
    "/memos/:id/revisions/restore",
    zValidator("json", restoreMemoRevisionSchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const memo = await restoreMemoRevision(
          db,
          user,
          parseMemosResourceName(c.req.param("id")),
          c.req.valid("json").revision,
        );
        return c.json(memoToDto(memo, user));
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.delete("/memos/:id", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const name = parseMemosResourceName(c.req.param("id"));
      if (c.req.query("hard") === "true") {
        await hardDeleteMemoWithAttachments(c.env, db, user, name);
        return c.json({ ok: true });
      }
      const memo = await moveMemoToTrash(db, user, name);
      return c.json(memoToDto(memo, user));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/memos/:id/attachments", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const attachments = await listMemoAttachments(
        db,
        user,
        parseMemosResourceName(c.req.param("id")),
      );
      return c.json({ attachments: attachments.map(attachmentToDto) });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.patch(
    "/memos/:id/attachments",
    zValidator("json", bindMemoAttachmentsSchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const attachments = await bindMemoAttachments(
          db,
          user,
          parseMemosResourceName(c.req.param("id")),
          c.req.valid("json").attachments,
        );
        return c.json({ attachments: attachments.map(attachmentToDto) });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.get("/memos/:id/relations", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const relations = await listMemoRelations(
        db,
        user,
        parseMemosResourceName(c.req.param("id")),
      );
      return c.json({ relations: relations.map(memoRelationToDto) });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.patch(
    "/memos/:id/relations",
    zValidator("json", patchMemoRelationsSchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const relations = await replaceMemoRelations(
          db,
          user,
          parseMemosResourceName(c.req.param("id")),
          c.req.valid("json"),
        );
        return c.json({ relations: relations.map(memoRelationToDto) });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.post(
    "/memos/:id/shares",
    zValidator("json", createShareSchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const share = await createMemoShare(
          db,
          user,
          parseMemosResourceName(c.req.param("id")),
          c.req.valid("json"),
        );
        return c.json(shareToDto(share), 201);
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.get("/memos/:id/shares", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const shareRows = await listMemoShares(
        db,
        user,
        parseMemosResourceName(c.req.param("id")),
      );
      return c.json({ shares: shareRows.map(shareToDto) });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/shares/:share_id", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const share = await getShareByIdOrToken(
        db,
        user,
        c.req.param("share_id"),
      );
      return c.json(shareToDto(share));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.delete("/shares/:share_id", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const share = await revokeMemoShare(db, user, c.req.param("share_id"));
      return c.json(shareToDto(share));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get(
    "/attachments",
    zValidator("query", listAttachmentsQuerySchema),
    async (c) => {
      try {
        const { db, user } = await getRequestContext(c);
        const query = c.req.valid("query");
        const attachments = await listAttachments(db, user, {
          memoId: query.memo,
          pageSize: query.page_size,
        });
        return c.json({ attachments: attachments.map(attachmentToDto) });
      } catch (error) {
        return jsonError(c, error);
      }
    },
  );

  app.post("/attachments", async (c) => {
    try {
      const { db, user, limits, userLimits } = await getRequestContext(c);
      const formData = await c.req.formData();
      const file = formData.get("file");
      const memo = formData.get("memo");
      // Article-editor uploads bind to the article draft that owns the
      // editing session (same lifecycle contract as `memo`).
      const article = formData.get("article");
      const clientId = normalizeAttachmentClientId(formData.get("client_id"));
      // Both parsers are decoration-not-contract: absent or invalid fields
      // simply leave the payload keys out.
      const payload = {
        ...parseAttachmentDuration(formData.get("duration")),
        ...parseAttachmentDimensions({
          width: formData.get("width"),
          height: formData.get("height"),
        }),
      };
      if (!(file instanceof File)) {
        return c.json({ error: { message: "file is required" } }, 400);
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        return c.json(
          { error: { message: "Attachment exceeds the 25 MiB limit" } },
          413,
        );
      }

      if (clientId) {
        const existing = await getAttachmentByClientId(db, user, clientId);
        if (existing) return c.json(attachmentToDto(existing));
      }

      const thumbnailPart = formData.get("thumbnail");
      const hasThumbnail =
        thumbnailPart instanceof File &&
        thumbnailPart.size > 0 &&
        thumbnailPart.type.startsWith("image/");
      if (hasThumbnail && thumbnailPart.size > MAX_THUMBNAIL_BYTES) {
        return c.json(
          { error: { message: "Thumbnail exceeds the 1 MiB limit" } },
          413,
        );
      }
      const thumbnailBytes = hasThumbnail ? thumbnailPart.size : 0;

      await assertAttachmentStorageQuota(
        db,
        limits,
        file.size + thumbnailBytes,
        {
          userLimits,
          userId: user.id,
        },
      );

      const objectKey = createAttachmentObjectKey(user.id, file.name);
      const object = await c.env.ATTACHMENTS.put(objectKey, file, {
        httpMetadata: {
          contentType: file.type || "application/octet-stream",
        },
      });
      // Card preview written beside the original under a derived key. It is
      // pure derivation from `r2Key`, so serving and deleting need no schema
      // change; `payload.thumbnail` only records that the object exists.
      if (hasThumbnail) {
        await c.env.ATTACHMENTS.put(thumbnailKeyFor(objectKey), thumbnailPart, {
          httpMetadata: { contentType: THUMBNAIL_CONTENT_TYPE },
        }).catch(async (error) => {
          // A missing thumbnail is a degraded card, not a failed upload.
          console.error(
            JSON.stringify({
              message: "thumbnail upload failed",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        });
      }
      try {
        const attachment = await createAttachmentMetadata(db, user, {
          memoId: typeof memo === "string" && memo ? memo : null,
          articleId: typeof article === "string" && article ? article : null,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          thumbnailSize: thumbnailBytes,
          r2Key: objectKey,
          etag: object.httpEtag,
          clientId,
          ...(Object.keys(payload).length > 0 || hasThumbnail
            ? {
                payload: hasThumbnail
                  ? { ...payload, thumbnail: true }
                  : payload,
              }
            : {}),
        });
        if (attachment.r2Key !== objectKey) {
          await c.env.ATTACHMENTS.delete([
            objectKey,
            ...(hasThumbnail ? [thumbnailKeyFor(objectKey)] : []),
          ]).catch(() => undefined);
        }
        return c.json(
          attachmentToDto(attachment),
          attachment.r2Key === objectKey ? 201 : 200,
        );
      } catch (error) {
        await c.env.ATTACHMENTS.delete([
          objectKey,
          ...(hasThumbnail ? [thumbnailKeyFor(objectKey)] : []),
        ]);
        throw error;
      }
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/attachments/:id", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const attachment = await getAttachmentById(
        db,
        user,
        parseAttachmentsResourceName(c.req.param("id")),
      );
      return c.json(attachmentToDto(attachment));
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.get("/attachments/:id/blob", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      const attachment = await getAttachmentById(
        db,
        user,
        parseAttachmentsResourceName(c.req.param("id")),
      );
      const response = await attachmentObjectResponse({
        attachment,
        bucket: c.env.ATTACHMENTS,
        cacheControl: "private, max-age=3600",
        inlineRequested:
          c.req.query("disposition") === "inline" ||
          c.req.query("thumbnail") === "true",
        thumbnailRequested: c.req.query("thumbnail") === "true",
        request: c.req.raw,
      });
      if (!response) {
        return c.json(
          { error: { message: "Attachment object not found" } },
          404,
        );
      }
      return response;
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.delete("/attachments/:id", async (c) => {
    try {
      const { db, user } = await getRequestContext(c);
      await deleteMemosAttachment(
        c.env,
        db,
        user,
        parseAttachmentsResourceName(c.req.param("id")),
      );
      return c.json({ ok: true });
    } catch (error) {
      return jsonError(c, error);
    }
  });
}
