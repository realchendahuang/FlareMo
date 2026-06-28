import { createDb } from "@flaremo/db";
import { getAttachmentById, getPublicShareByToken } from "@flaremo/domain";
import { attachmentToDto, memoToDto, shareToDto } from "@flaremo/memos";
import { Hono } from "hono";
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
      attachments: share.attachments.map((attachment) => ({
        ...attachmentToDto(attachment),
        download_url: `/api/public/shares/${share.share.token}/attachments/${attachment.id.replace(/^attachments\//, "")}/blob`,
      })),
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

function contentDisposition(filename: string) {
  const safeFilename = filename.replaceAll(/["\\]/g, "_");
  return `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
