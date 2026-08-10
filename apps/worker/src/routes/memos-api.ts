import {
  bindMemoAttachmentsSchema,
  createDataTaskResponseSchema,
  createImportTaskRequestSchema,
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
  createDataTask,
  createMemo,
  createMemoShare,
  dataTaskToDto,
  exportData,
  failDataTask,
  finalizeAttachmentDelete,
  getAttachmentByClientId,
  getAttachmentById,
  getDataTask,
  getMemoById,
  getShareByIdOrToken,
  hardDeleteMemo,
  importData,
  listAttachments,
  listDataTasks,
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
  runImportTask,
  streamExportData,
  updateDataTask,
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
    const includeBinary = c.req.query("include_binary") !== "false";
    // Build the metadata bundle and estimate the final JSON size before
    // deciding whether it fits the inline response limit. The 32 MiB budget
    // counts the complete serialized bundle (memos + relations + shares +
    // attachment metadata), not just attachment bytes.
    const bundle = await exportData(db, user);
    const estimatedBytes = estimateBundleJsonBytes(bundle);
    if (includeBinary) {
      const attachmentBytes = bundle.attachments.reduce(
        (total, attachment) =>
          attachment.state === "ready" ? total + attachment.size : total,
        0,
      );
      // Base64 inflates binary by ~33%; the full JSON string adds the
      // attachment bytes on top of the metadata estimate.
      const totalEstimate =
        estimatedBytes + Math.ceil((attachmentBytes * 4) / 3);
      if (totalEstimate > MAX_INLINE_EXPORT_BYTES) {
        return c.json(
          {
            error: {
              message:
                "Export exceeds 32 MiB. Create an export task instead: POST /api/v1/export/tasks",
            },
          },
          413,
        );
      }
    } else if (estimatedBytes > MAX_INLINE_EXPORT_BYTES) {
      return c.json(
        {
          error: {
            message:
              "Metadata-only export exceeds 32 MiB. Create an export task instead: POST /api/v1/export/tasks",
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

// ---------------------------------------------------------------------------
// Data-transfer task endpoints (large export/import)
// ---------------------------------------------------------------------------

memosApi.get("/export/tasks", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const tasks = await listDataTasks(db, user);
    return c.json({ tasks: tasks.map(dataTaskToDto) });
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.post("/export/tasks", async (c) => {
  let taskId: string | undefined;
  try {
    const { db, user } = await getRequestContext(c);
    const task = await createDataTask(db, user, { kind: "export" });
    taskId = task.id;
    await updateDataTask(db, task.id, { status: "running", phase: "scanning" });

    const prefix = `exports/${task.id}`;
    const chunkKeys: Array<{
      kind: string;
      key: string;
      recordCount: number;
    }> = [];
    const attachmentRefs: Array<{
      id: string;
      filename: string;
      content_type: string | null;
      size: number;
    }> = [];

    await streamExportData(db, user, async (chunk) => {
      const sequence = chunkKeys.length + 1;
      const key = `${prefix}/data/${chunk.kind}-${String(sequence).padStart(4, "0")}.ndjson`;
      const recordCount =
        chunk.records.length > 0 ? chunk.records.split("\n").length : 0;
      await c.env.ATTACHMENTS.put(key, chunk.records, {
        httpMetadata: { contentType: "application/x-ndjson" },
      });
      chunkKeys.push({ kind: chunk.kind, key, recordCount });
      if (chunk.kind === "attachments") {
        for (const line of chunk.records.split("\n").filter(Boolean)) {
          const record = JSON.parse(line) as {
            id: string;
            filename: string;
            content_type: string | null;
            size: number;
          };
          attachmentRefs.push({
            id: record.id,
            filename: record.filename,
            content_type: record.content_type,
            size: record.size,
          });
        }
      }
      await updateDataTask(db, task.id, {
        phase: "writing",
        progressDone: chunkKeys.length,
        progressTotal: 5,
      });
    });

    const manifest = {
      format_version: 1,
      exported_at: new Date().toISOString(),
      counts: {
        memos: 0,
        attachments: attachmentRefs.length,
        relations: 0,
        shares: 0,
      },
      data_chunks: chunkKeys,
      attachments: attachmentRefs,
    };
    // Re-derive counts from chunk record counts for accuracy.
    for (const chunk of chunkKeys) {
      if (chunk.kind === "memos") manifest.counts.memos += chunk.recordCount;
      if (chunk.kind === "relations")
        manifest.counts.relations += chunk.recordCount;
      if (chunk.kind === "shares") manifest.counts.shares += chunk.recordCount;
    }
    const manifestKey = `${prefix}/manifest.json`;
    await c.env.ATTACHMENTS.put(manifestKey, JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json" },
    });

    const done = await updateDataTask(db, task.id, {
      status: "succeeded",
      phase: "completed",
      manifestKey,
      progressDone: chunkKeys.length,
      progressTotal: chunkKeys.length,
      completedAt: new Date().toISOString(),
    });
    return c.json({ task: dataTaskToDto(done!) }, 202);
  } catch (error) {
    if (taskId) {
      const context = await getRequestContext(c).catch(() => undefined);
      if (context) {
        await failDataTask(
          context.db,
          taskId,
          "export_failed",
          errorMessage(error),
        ).catch(() => undefined);
      }
    }
    return jsonError(c, error);
  }
});

memosApi.get("/export/tasks/:id", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const task = await getDataTask(db, user, c.req.param("id"));
    return c.json({ task: dataTaskToDto(task) });
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.get("/export/tasks/:id/manifest", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const task = await getDataTask(db, user, c.req.param("id"));
    if (task.status !== "succeeded" || !task.manifestKey) {
      return c.json(
        { error: { message: "Export task has not completed yet" } },
        409,
      );
    }
    const object = await c.env.ATTACHMENTS.get(task.manifestKey);
    if (!object) {
      return c.json({ error: { message: "Export artifact is missing" } }, 404);
    }
    return new Response(object.body, {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="flaremo-export-${task.id}.json"`,
      },
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.get("/export/tasks/:id/data/:chunk", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const task = await getDataTask(db, user, c.req.param("id"));
    if (task.status !== "succeeded") {
      return c.json(
        { error: { message: "Export task has not completed yet" } },
        409,
      );
    }
    const chunk = c.req.param("chunk");
    const key = `exports/${task.id}/data/${chunk}`;
    const object = await c.env.ATTACHMENTS.get(key);
    if (!object) {
      return c.json({ error: { message: "Chunk is missing" } }, 404);
    }
    return new Response(object.body, {
      headers: {
        "content-type": "application/x-ndjson",
        "cache-control": "private, max-age=0",
      },
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.get("/export/tasks/:id/attachments/:attachmentId", async (c) => {
  try {
    const { db, user } = await getRequestContext(c);
    const task = await getDataTask(db, user, c.req.param("id"));
    if (task.status !== "succeeded") {
      return c.json(
        { error: { message: "Export task has not completed yet" } },
        409,
      );
    }
    const attachment = await getAttachmentById(
      db,
      user,
      parseAttachmentsResourceName(c.req.param("attachmentId")),
    );
    const object = await c.env.ATTACHMENTS.get(attachment.r2Key);
    if (!object) {
      return c.json(
        { error: { message: "Attachment object is missing" } },
        404,
      );
    }
    const headers = new Headers();
    headers.set(
      "content-type",
      attachment.contentType ?? "application/octet-stream",
    );
    headers.set("content-length", String(object.size));
    headers.set(
      "content-disposition",
      `attachment; filename="${sanitizeFilename(attachment.filename)}"`,
    );
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    return new Response(object.body, { headers });
  } catch (error) {
    return jsonError(c, error);
  }
});

memosApi.post(
  "/import/tasks",
  zValidator("json", createImportTaskRequestSchema),
  async (c) => {
    let taskId: string | undefined;
    const writtenKeys: string[] = [];
    try {
      const { db, user } = await getRequestContext(c);
      const body = c.req.valid("json");
      const task = await createDataTask(db, user, { kind: "import" });
      taskId = task.id;

      const r2Keys = new Map<string, string>();
      const r2Etags = new Map<string, string | null>();
      for (const attachment of body.bundle.attachments) {
        if (!attachment.data_base64) continue;
        const bytes = base64ToUint8Array(attachment.data_base64);
        if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
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
        const object = await c.env.ATTACHMENTS.put(objectKey, bytes, {
          httpMetadata: {
            contentType: attachment.content_type ?? "application/octet-stream",
          },
        });
        writtenKeys.push(objectKey);
        r2Keys.set(attachment.name, objectKey);
        r2Etags.set(attachment.name, object.httpEtag);
      }

      const result = await runImportTask(db, user, task.id, body.bundle, {
        attachmentR2Keys: r2Keys,
        attachmentEtags: r2Etags,
        conflict: body.conflict,
      });

      if (result.cleanupR2Keys.length > 0) {
        try {
          await c.env.ATTACHMENTS.delete(result.cleanupR2Keys);
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "import task R2 cleanup failed",
              error: error instanceof Error ? error.message : String(error),
              count: result.cleanupR2Keys.length,
            }),
          );
        }
      }

      const { cleanupR2Keys: _cleanupR2Keys, ...publicResult } = result;
      const taskDto = dataTaskToDto(await getDataTask(db, user, task.id));
      return c.json({ task: taskDto, result: publicResult }, 202);
    } catch (error) {
      if (taskId) {
        const context = await getRequestContext(c).catch(() => undefined);
        if (context) {
          await failDataTask(
            context.db,
            taskId,
            "import_failed",
            errorMessage(error),
          ).catch(() => undefined);
        }
      }
      if (writtenKeys.length > 0) {
        await c.env.ATTACHMENTS.delete(writtenKeys);
      }
      return jsonError(c, error);
    }
  },
);

function sanitizeFilename(filename: string) {
  return (
    filename.replaceAll(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 180) || "attachment"
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function estimateBundleJsonBytes(bundle: {
  memos: unknown[];
  attachments: unknown[];
  relations: unknown[];
  shares: unknown[];
}) {
  return new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
}
