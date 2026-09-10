import { createDb } from "@flaremo/db";
import {
  type BrandingMark,
  type BrandingMarkVariant,
  getBranding,
} from "@flaremo/domain";
import { Hono } from "hono";
import type { HonoBindings } from "../context";
import { jsonError } from "../http";

/**
 * Public white-label branding. Anonymous visitors (login page, shared memos)
 * must be able to resolve the instance's product name and logo, so these
 * handlers read the database directly without a session context.
 */
export const brandingApi = new Hono<HonoBindings>();

const MARK_CACHE_CONTROL = "public, max-age=300";

brandingApi.get("/", async (c) => {
  try {
    const db = createDb(c.env.DB);
    const branding = await getBranding(db);
    const markUrl = (
      variant: BrandingMarkVariant,
      mark: BrandingMark | null,
    ) =>
      mark
        ? `/api/app/branding/marks/${variant}?v=${encodeURIComponent(mark.updated_at)}`
        : null;
    return c.json({
      product: branding.product,
      mark_light_url: markUrl("light", branding.marks.light),
      mark_dark_url: markUrl("dark", branding.marks.dark),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

for (const variant of ["light", "dark"] as const) {
  brandingApi.get(`/marks/${variant}`, async (c) => {
    try {
      const db = createDb(c.env.DB);
      const branding = await getBranding(db);
      const mark = branding.marks[variant];
      if (!mark) {
        return c.json({ error: { message: "Not found" } }, 404);
      }
      const object = await c.env.ATTACHMENTS.get(mark.r2_key);
      if (!object) {
        // Config points at an object that is gone (manual bucket cleanup):
        // treat the mark as unset rather than serving a broken image.
        return c.json({ error: { message: "Not found" } }, 404);
      }
      const headers = new Headers({
        "content-type": mark.content_type,
        "cache-control": MARK_CACHE_CONTROL,
      });
      const etag = `"${mark.updated_at}"`;
      if (c.req.header("if-none-match") === etag) {
        return new Response(null, { status: 304, headers });
      }
      headers.set("etag", etag);
      return new Response(object.body, { headers });
    } catch (error) {
      return jsonError(c, error);
    }
  });
}
