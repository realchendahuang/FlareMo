import {
  BRANDING_ACCENT_HEX_PATTERN,
  BRANDING_ACCENT_PRESETS,
  BRANDING_FAVICON_CONTENT_TYPES,
  BRANDING_MARK_CONTENT_TYPES,
  BRANDING_MARK_MAX_BYTES,
  BRANDING_PRODUCT_NAME_MAX_CHARS,
  type BrandingMark,
  brandingFaviconR2Key,
  brandingMarkR2Key,
  CUSTOM_BRANDING_ACCENT,
  clearBrandingFavicon,
  clearBrandingMark,
  DEFAULT_FLAREMO_PRODUCT_NAME,
  getBranding,
  isValidBrandingContentType,
  isValidBrandingFaviconContentType,
  type ResolvedBranding,
  setBrandingAccent,
  setBrandingProductName,
  upsertBrandingFavicon,
  upsertBrandingMark,
  ValidationError,
} from "@flaremo/domain";
import type { Hono } from "hono";
import { z } from "zod";
import type { HonoBindings } from "../../context";
import { jsonError } from "../../http";
import { invalidateBrandingCache } from "../../settings-cache";
import { zValidator } from "../../validated";
import { ownerContext } from "./context";

const updateBrandingSchema = z.object({
  product_name: z
    .string()
    .trim()
    .max(BRANDING_PRODUCT_NAME_MAX_CHARS)
    .nullable()
    .optional(),
  accent: z
    .enum([...BRANDING_ACCENT_PRESETS, CUSTOM_BRANDING_ACCENT])
    .nullable()
    .optional(),
  // Seed hex for the custom accent; validated + stored lowercased in domain.
  accent_hex: z
    .string()
    .trim()
    .regex(BRANDING_ACCENT_HEX_PATTERN)
    .nullable()
    .optional(),
});

export function registerBrandingRoutes(app: Hono<HonoBindings>) {
  app.get("/branding", async (c) => {
    try {
      const { db } = await ownerContext(c);
      const branding = await getBranding(db);
      const markUrl = (variant: "light" | "dark", mark: BrandingMark | null) =>
        mark
          ? `/api/app/branding/marks/${variant}?v=${encodeURIComponent(mark.updated_at)}`
          : null;
      return c.json({
        product_name:
          branding.product === DEFAULT_FLAREMO_PRODUCT_NAME
            ? null
            : branding.product,
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

  app.put("/branding", zValidator("json", updateBrandingSchema), async (c) => {
    try {
      const { db } = await ownerContext(c);
      const patch = c.req.valid("json");
      let branding: ResolvedBranding | null = null;
      if (patch.product_name !== undefined) {
        branding = await setBrandingProductName(db, patch.product_name);
      }
      if (patch.accent !== undefined) {
        branding = await setBrandingAccent(
          db,
          patch.accent,
          patch.accent_hex !== undefined ? patch.accent_hex : undefined,
        );
      } else if (patch.accent_hex !== undefined) {
        // Hex-only update retargets the existing custom seed's color.
        const current = await getBranding(db);
        if (current.accent === CUSTOM_BRANDING_ACCENT) {
          branding = await setBrandingAccent(db, "custom", patch.accent_hex);
        } else {
          branding = current;
        }
      }
      branding ??= await getBranding(db);
      invalidateBrandingCache(db);
      return c.json({
        product: branding.product,
        accent: branding.accent,
        accent_hex: branding.accentHex,
      });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  // Binary logo upload: raw body + explicit content type (validated against
  // BRANDING_MARK_CONTENT_TYPES, size-capped at BRANDING_MARK_MAX_BYTES).
  app.put("/branding/marks/:variant", async (c) => {
    try {
      const { db } = await ownerContext(c);
      const variant = z
        .enum(["light", "dark"])
        .safeParse(c.req.param("variant"));
      if (!variant.success) {
        throw new ValidationError("Variant must be light or dark.");
      }
      const contentType = c.req.header("content-type") ?? null;
      if (!isValidBrandingContentType(contentType)) {
        throw new ValidationError(
          `Logo must be one of: ${BRANDING_MARK_CONTENT_TYPES.join(", ")}.`,
        );
      }
      const bytes = await c.req.arrayBuffer();
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > BRANDING_MARK_MAX_BYTES
      ) {
        throw new ValidationError(
          `Logo must be between 1 and ${BRANDING_MARK_MAX_BYTES} bytes.`,
        );
      }
      const key = brandingMarkR2Key(variant.data);
      await c.env.ATTACHMENTS.put(key, bytes, {
        httpMetadata: { contentType },
      });
      await upsertBrandingMark(db, variant.data, contentType);
      invalidateBrandingCache(db);
      return c.json({ saved: true, variant: variant.data });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.delete("/branding/marks/:variant", async (c) => {
    try {
      const { db } = await ownerContext(c);
      const variant = z
        .enum(["light", "dark"])
        .safeParse(c.req.param("variant"));
      if (!variant.success) {
        throw new ValidationError("Variant must be light or dark.");
      }
      const staleKey = await clearBrandingMark(db, variant.data);
      if (staleKey) {
        await c.env.ATTACHMENTS.delete(staleKey);
      }
      invalidateBrandingCache(db);
      return c.json({ removed: true, variant: variant.data });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  // Favicon upload: same raw-body contract as the logo marks, with .ico added
  // to the accepted content types (BRANDING_FAVICON_CONTENT_TYPES).
  app.put("/branding/favicon", async (c) => {
    try {
      const { db } = await ownerContext(c);
      const contentType = c.req.header("content-type") ?? null;
      if (!isValidBrandingFaviconContentType(contentType)) {
        throw new ValidationError(
          `Favicon must be one of: ${BRANDING_FAVICON_CONTENT_TYPES.join(", ")}.`,
        );
      }
      const bytes = await c.req.arrayBuffer();
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > BRANDING_MARK_MAX_BYTES
      ) {
        throw new ValidationError(
          `Favicon must be between 1 and ${BRANDING_MARK_MAX_BYTES} bytes.`,
        );
      }
      await c.env.ATTACHMENTS.put(brandingFaviconR2Key(), bytes, {
        httpMetadata: { contentType },
      });
      await upsertBrandingFavicon(db, contentType);
      invalidateBrandingCache(db);
      return c.json({ saved: true });
    } catch (error) {
      return jsonError(c, error);
    }
  });

  app.delete("/branding/favicon", async (c) => {
    try {
      const { db } = await ownerContext(c);
      const staleKey = await clearBrandingFavicon(db);
      if (staleKey) {
        await c.env.ATTACHMENTS.delete(staleKey);
      }
      invalidateBrandingCache(db);
      return c.json({ removed: true });
    } catch (error) {
      return jsonError(c, error);
    }
  });
}
