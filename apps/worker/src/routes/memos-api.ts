import {
  bindMemoAttachmentsSchema,
  createMemoSchema,
  createShareSchema,
  importBundleSchema,
  importOptionsSchema,
  listAttachmentsQuerySchema,
  listMemosQuerySchema,
  patchMemoRelationsSchema,
  restoreMemoRevisionSchema,
  updateMemoSchema,
} from "@flaremo/contracts";
import {
  bindMemoAttachments,
  createAttachmentMetadata,
  createMemo,
  createMemoShare,
  exportData,
  finalizeAttachmentDelete,
  getAttachmentByClientId,
  getAttachmentById,
  getMemoById,
  getShareByIdOrToken,
  hardDeleteMemo,
  importData,
  listAttachments,
  listMemoAttachments,
  listMemoRelations,
  listMemoRevisions,
  listMemoShares,
  listMemos,
  markAttachmentDeleting,
  markMemoAttachmentsDeleting,
  moveMemoToTrash,
  normalizeAttachmentClientId,
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
import { Hono } from "hono";
import {
  attachmentObjectResponse,
  createAttachmentObjectKey,
  MAX_ATTACHMENT_BYTES,
  MAX_INLINE_EXPORT_BYTES,
} from "../attachment-http";
import { getRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";
import { buildMemoContext } from "../memo-context";

export const memosApi = new Hono<HonoBindings>();

memosApi.get("/memos", zValidator("query", listMemosQuerySchema), async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const result = await listMemos(db, user, c.req.valid("query"));
    return c.json(memosToListResponse({ ...result, user }));
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.post("/memos", zValidator("json", createMemoSchema), async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const memo = await createMemo(db, user, c.req.valid("json"));
    return c.json(memoToDto(memo, user), 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.get("/memos/:id", async (c) => {
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

memosApi.patch(
  "/memos/:id",
  zValidator("json", updateMemoSchema),
  async (c) => {
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
  },
);

memosApi.get("/memos/:id/relation-context", async (c) => {
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

memosApi.get("/memos/:id/context", async (c) => {
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

memosApi.get("/memos/:id/revisions", async (c) => {
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

memosApi.post(
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

memosApi.delete("/memos/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const name = parseMemosResourceName(c.req.param("id"));
    if (c.req.query("hard") === "true") {
      const attachments = await markMemoAttachmentsDeleting(db, user, name);
      const objectKeys = attachments
        .filter((attachment) => attachment.state !== "missing")
        .map((attachment) => attachment.r2Key);
      if (objectKeys.length > 0) {
        await c.env.ATTACHMENTS.delete(objectKeys);
      }
      await hardDeleteMemo(db, user, name);
      return c.json({ ok: true });
    }
    const memo = await moveMemoToTrash(db, user, name);
    return c.json(memoToDto(memo, user));
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.get("/memos/:id/attachments", async (c) => {
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

memosApi.patch(
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

memosApi.get("/memos/:id/relations", async (c) => {
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

memosApi.patch(
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

memosApi.post(
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

memosApi.get("/memos/:id/shares", async (c) => {
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

memosApi.get("/shares/:share_id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const share = await getShareByIdOrToken(db, user, c.req.param("share_id"));
    return c.json(shareToDto(share));
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.delete("/shares/:share_id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const share = await revokeMemoShare(db, user, c.req.param("share_id"));
    return c.json(shareToDto(share));
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.get(
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

memosApi.post("/attachments", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const formData = await c.req.formData();
    const file = formData.get("file");
    const memo = formData.get("memo");
    const clientId = normalizeAttachmentClientId(formData.get("client_id"));
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

    const objectKey = createAttachmentObjectKey(user.id, file.name);
    const object = await c.env.ATTACHMENTS.put(objectKey, file, {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
      },
    });
    try {
      const attachment = await createAttachmentMetadata(db, user, {
        memoId: typeof memo === "string" && memo ? memo : null,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        r2Key: objectKey,
        etag: object.httpEtag,
        clientId,
      });
      if (attachment.r2Key !== objectKey) {
        await c.env.ATTACHMENTS.delete(objectKey).catch(() => undefined);
      }
      return c.json(
        attachmentToDto(attachment),
        attachment.r2Key === objectKey ? 201 : 200,
      );
    } catch (error) {
      await c.env.ATTACHMENTS.delete(objectKey);
      throw error;
    }
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.get("/attachments/:id", async (c) => {
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

memosApi.get("/attachments/:id/blob", async (c) => {
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
      inlineRequested: c.req.query("disposition") === "inline",
      request: c.req.raw,
    });
    if (!response) {
      return c.json({ error: { message: "Attachment object not found" } }, 404);
    }
    return response;
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.delete("/attachments/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const attachment = await markAttachmentDeleting(
      db,
      user,
      parseAttachmentsResourceName(c.req.param("id")),
    );
    await c.env.ATTACHMENTS.delete(attachment.r2Key);
    await finalizeAttachmentDelete(db, user, attachment.id);
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.get("/export", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const bundle = await exportData(db, user);
    const includeBinary = c.req.query("include_binary") !== "false";
    const totalBytes = bundle.attachments.reduce(
      (total, attachment) =>
        attachment.state === "ready" ? total + attachment.size : total,
      0,
    );
    if (includeBinary && totalBytes > MAX_INLINE_EXPORT_BYTES) {
      return c.json(
        {
          error: {
            message:
              "Inline export exceeds 32 MiB. Export metadata and back up R2 objects separately.",
          },
        },
        413,
      );
    }
    const attachments = [];
    for (const attachment of bundle.attachments) {
      if (!includeBinary || attachment.state !== "ready") {
        attachments.push(attachment);
        continue;
      }
      const row = await getAttachmentById(db, user, attachment.name);
      const object = await c.env.ATTACHMENTS.get(row.r2Key);
      if (!object) {
        attachments.push({ ...attachment, state: "missing" as const });
        continue;
      }
      const body = await object.arrayBuffer();
      attachments.push({
        ...attachment,
        data_base64: arrayBufferToBase64(body),
      });
    }
    return c.json({ ...bundle, attachments });
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.post(
  "/import",
  zValidator("query", importOptionsSchema),
  zValidator("json", importBundleSchema),
  async (c) => {
    const writtenKeys: string[] = [];
    try {
      const { db, user } = await getRequestContext(c);
      const bundle = c.req.valid("json");
      const r2Keys = new Map<string, string>();
      const r2Etags = new Map<string, string | null>();
      for (const attachment of bundle.attachments) {
        if (!attachment.data_base64) continue;
        const body = base64ToUint8Array(attachment.data_base64);
        if (body.byteLength > MAX_ATTACHMENT_BYTES) {
          return c.json(
            { error: { message: "Imported attachment exceeds 25 MiB" } },
            413,
          );
        }
        const objectKey = createAttachmentObjectKey(
          user.id,
          attachment.filename,
          "imports",
        );
        const object = await c.env.ATTACHMENTS.put(objectKey, body, {
          httpMetadata: {
            contentType: attachment.content_type ?? "application/octet-stream",
          },
        });
        writtenKeys.push(objectKey);
        r2Keys.set(attachment.name, objectKey);
        r2Etags.set(attachment.name, object.httpEtag);
      }
      const result = await importData(db, user, bundle, {
        attachmentR2Keys: r2Keys,
        attachmentEtags: r2Etags,
        conflict: c.req.valid("query").conflict,
      });
      if (result.cleanupR2Keys.length > 0) {
        try {
          await c.env.ATTACHMENTS.delete(result.cleanupR2Keys);
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "import R2 cleanup failed",
              error: error instanceof Error ? error.message : String(error),
              count: result.cleanupR2Keys.length,
            }),
          );
        }
      }
      const { cleanupR2Keys: _cleanupR2Keys, ...publicResult } = result;
      return c.json(publicResult);
    } catch (error) {
      if (writtenKeys.length > 0) {
        await c.env.ATTACHMENTS.delete(writtenKeys);
      }
      return jsonError(c, error);
    }
  },
);

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToUint8Array(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
