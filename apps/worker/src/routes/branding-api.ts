import type { BrandingMark, BrandingMarkVariant } from "@flaremo/domain";
import { Hono } from "hono";
import { getFlareMoDb, type HonoBindings } from "../context";
import { jsonError } from "../http";
import { getBrandingCached } from "../settings-cache";

/**
 * Public white-label branding. Anonymous visitors (login page, shared memos)
 * must be able to resolve the instance's product name and logo, so these
 * handlers read the database directly without a session context.
 */
export const brandingApi = new Hono<HonoBindings>();

const MARK_CACHE_CONTROL = "public, max-age=300";

brandingApi.get("/", async (c) => {
  try {
    const db = getFlareMoDb(c.env);
    const branding = await getBrandingCached(db);
    const markUrl = (variant: BrandingMarkVariant, mark: BrandingMark | null) =>
      mark
        ? `/api/app/branding/marks/${variant}?v=${encodeURIComponent(mark.updated_at)}`
        : null;
    return c.json({
      product: branding.product,
      accent: branding.accent,
      accent_hex: branding.accentHex,
      mark_light_url: markUrl("light", branding.marks.light),
      mark_dark_url: markUrl("dark", branding.marks.dark),
      favicon_url: branding.favicon
        ? `/api/app/branding/favicon?v=${encodeURIComponent(branding.favicon.updated_at)}`
        : null,
      favicon_content_type: branding.favicon?.content_type ?? null,
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

for (const variant of ["light", "dark"] as const) {
  brandingApi.get(`/marks/${variant}`, async (c) => {
    try {
      const db = getFlareMoDb(c.env);
      const branding = await getBrandingCached(db);
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

brandingApi.get("/favicon", async (c) => {
  try {
    const db = getFlareMoDb(c.env);
    const branding = await getBrandingCached(db);
    const favicon = branding.favicon;
    if (!favicon) {
      return c.json({ error: { message: "Not found" } }, 404);
    }
    const object = await c.env.ATTACHMENTS.get(favicon.r2_key);
    if (!object) {
      return c.json({ error: { message: "Not found" } }, 404);
    }
    const headers = new Headers({
      "content-type": favicon.content_type,
      "cache-control": MARK_CACHE_CONTROL,
    });
    const etag = `"${favicon.updated_at}"`;
    if (c.req.header("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    headers.set("etag", etag);
    return new Response(object.body, { headers });
  } catch (error) {
    return jsonError(c, error);
  }
});
