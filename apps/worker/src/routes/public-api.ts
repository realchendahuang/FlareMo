import { createDb } from "@flaremo/db";
import { getAttachmentById, getPublicShareByToken } from "@flaremo/domain";
import { attachmentToDto, memoToDto, shareToDto } from "@flaremo/memos";
import { Hono } from "hono";
import { attachmentObjectResponse } from "../attachment-http";
import type { HonoBindings } from "../context";
import { jsonError } from "../http";

export const publicApi = new Hono<HonoBindings>();

publicApi.get("/shares/:token", async (c) => {
  try {
    const db = createDb(c.env.DB);
    const share = await getPublicShareByToken(db, c.req.param("token"));
    const shareDto = shareToDto(share.share);
    return c.json({
      share: {
        name: shareDto.name,
        id: shareDto.id,
        memo: shareDto.memo,
        expires_at: shareDto.expires_at,
        create_time: shareDto.create_time,
      },
      memo: memoToDto(share.memo, share.user),
      attachments: share.attachments.map((attachment) => {
        const blobUrl = `/api/public/shares/${share.share.token}/attachments/${attachment.id.replace(/^attachments\//, "")}/blob`;
        return {
          ...attachmentToDto(attachment),
          download_url: blobUrl,
          preview_url: `${blobUrl}?preview=1`,
        };
      }),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

publicApi.get("/shares/:token/attachments/:id/blob", async (c) => {
  try {
    const db = createDb(c.env.DB);
    const share = await getPublicShareByToken(db, c.req.param("token"));
    const attachment = await getAttachmentById(
      db,
      share.user,
      c.req.param("id"),
    );
    if (attachment.memoId !== share.memo.id) {
      return c.json({ error: { message: "Attachment not found" } }, 404);
    }

    const response = await attachmentObjectResponse({
      attachment,
      bucket: c.env.ATTACHMENTS,
      cacheControl: "public, max-age=3600",
      inlineRequested: c.req.query("preview") === "1",
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
