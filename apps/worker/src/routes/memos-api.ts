import {
  bindMemoAttachmentsSchema,
  createMemoSchema,
  createShareSchema,
  importBundleSchema,
  listAttachmentsQuerySchema,
  listMemosQuerySchema,
  patchMemoRelationsSchema,
  updateMemoSchema,
} from "@flaremo/contracts";
import {
  bindMemoAttachments,
  createAttachmentMetadata,
  createMemo,
  createMemoShare,
  exportData,
  getAttachmentById,
  getMemoById,
  getShareByIdOrToken,
  hardDeleteMemo,
  importData,
  listAttachments,
  listMemoAttachments,
  listMemoRelations,
  listMemos,
  moveMemoToTrash,
  replaceMemoRelations,
  softDeleteAttachment,
  updateMemo,
} from "@flaremo/domain";
import {
  attachmentToDto,
  memoRelationToDto,
  memosToListResponse,
  memoToDto,
  parseAttachmentsResourceName,
  parseMemosResourceName,
  shareToDto,
} from "@flaremo/memos";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getRequestContext, type HonoBindings } from "../context";
import { jsonError } from "../http";

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

memosApi.delete("/memos/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const name = parseMemosResourceName(c.req.param("id"));
    if (c.req.query("hard") === "true") {
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

memosApi.get("/shares/:share_id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const share = await getShareByIdOrToken(db, user, c.req.param("share_id"));
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
    if (!(file instanceof File)) {
      return c.json({ error: { message: "file is required" } }, 400);
    }

    const objectKey = createAttachmentObjectKey(user.id, file.name);
    await c.env.ATTACHMENTS.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
      },
    });

    const attachment = await createAttachmentMetadata(db, user, {
      memoId: typeof memo === "string" && memo ? memo : null,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      r2Key: objectKey,
    });

    return c.json(attachmentToDto(attachment), 201);
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
    const object = await c.env.ATTACHMENTS.get(attachment.r2Key);
    if (!object) {
      return c.json({ error: { message: "Attachment object not found" } }, 404);
    }
    const headers = new Headers();
    headers.set(
      "content-type",
      attachment.contentType ?? "application/octet-stream",
    );
    headers.set("etag", object.httpEtag);
    headers.set("content-disposition", contentDisposition(attachment.filename));
    return new Response(object.body, { headers });
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.delete("/attachments/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const attachment = await softDeleteAttachment(
      db,
      user,
      parseAttachmentsResourceName(c.req.param("id")),
    );
    await c.env.ATTACHMENTS.delete(attachment.r2Key);
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.get("/export", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const bundle = await exportData(db, user);
    const attachments = await Promise.all(
      bundle.attachments.map(async (attachment) => {
        const row = await getAttachmentById(db, user, attachment.name);
        const object = await c.env.ATTACHMENTS.get(row.r2Key);
        if (!object) {
          return attachment;
        }
        const body = await object.arrayBuffer();
        return {
          ...attachment,
          data_base64: arrayBufferToBase64(body),
        };
      }),
    );
    return c.json({ ...bundle, attachments });
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.post("/import", zValidator("json", importBundleSchema), async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const bundle = c.req.valid("json");
    const r2Keys = new Map<string, string>();
    for (const attachment of bundle.attachments) {
      if (!attachment.data_base64) {
        continue;
      }
      const objectKey = createAttachmentObjectKey(
        user.id,
        attachment.filename,
        "imports",
      );
      await c.env.ATTACHMENTS.put(
        objectKey,
        base64ToUint8Array(attachment.data_base64),
        {
          httpMetadata: {
            contentType: attachment.content_type ?? "application/octet-stream",
          },
        },
      );
      r2Keys.set(attachment.name, objectKey);
    }
    const result = await importData(db, user, bundle, {
      attachmentR2Keys: r2Keys,
    });
    return c.json(result);
  } catch (error) {
    return jsonError(c, error);
  }
});

function createAttachmentObjectKey(
  userId: string,
  filename: string,
  namespace = "attachments",
) {
  const safeFilename =
    filename.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment";
  return `${namespace}/${userId}/${crypto.randomUUID()}/${safeFilename}`;
}

function contentDisposition(filename: string) {
  const safeFilename = filename.replaceAll(/["\\]/g, "_");
  return `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

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
