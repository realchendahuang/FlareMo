import type { FlareMoDb } from "@flaremo/db";
import { OWNER_FLAREMO_USER_ID } from "./auth";
import { NotFoundError, ValidationError } from "./errors";
import { getStoredSetting, upsertStoredSetting } from "./settings";
import { getFlaremoUserById } from "./users";

/**
 * Instance-level white-label branding, stored under the owner's settings row
 * (same instance-scoped pattern as `memos.instance.GENERAL`). Binary brand
 * assets live in R2 under `BRANDING_R2_PREFIX`; the setting row only carries
 * the object key plus content type, so config reads stay on D1.
 *
 * Everything defaults back to FlareMo's own branding: an unset setting is
 * indistinguishable from a fresh install, and clearing a field restores the
 * bundled assets.
 */
export const BRANDING_SETTING_KEY = "flaremo.instance.BRANDING";
export const BRANDING_R2_PREFIX = "branding/";
export const BRANDING_MARK_MAX_BYTES = 512 * 1024;
export const BRANDING_MARK_CONTENT_TYPES = [
  "image/png",
  "image/webp",
  "image/svg+xml",
] as const;
export const BRANDING_PRODUCT_NAME_MAX_CHARS = 40;
export const DEFAULT_FLAREMO_PRODUCT_NAME = "FlareMo";

export type BrandingMarkVariant = "light" | "dark";

export type BrandingMark = {
  r2_key: string;
  content_type: string;
  updated_at: string;
};

export type ResolvedBranding = {
  product: string;
  marks: { light: BrandingMark | null; dark: BrandingMark | null };
};

type StoredBranding = {
  product_name?: string | null;
  marks?: {
    light?: BrandingMark | null;
    dark?: BrandingMark | null;
  };
};

export function brandingMarkR2Key(variant: BrandingMarkVariant): string {
  return `${BRANDING_R2_PREFIX}mark-${variant}`;
}

export function isValidBrandingContentType(
  contentType: string | null | undefined,
): contentType is (typeof BRANDING_MARK_CONTENT_TYPES)[number] {
  return BRANDING_MARK_CONTENT_TYPES.some(
    (value) => value === contentType?.toLowerCase().trim(),
  );
}

function readStoredBranding(value: unknown): StoredBranding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as StoredBranding;
}

function normalizeMark(value: unknown): BrandingMark | null {
  if (typeof value !== "object" || value === null) return null;
  const mark = value as Record<string, unknown>;
  if (
    typeof mark.r2_key !== "string" ||
    !mark.r2_key.startsWith(BRANDING_R2_PREFIX) ||
    !isValidBrandingContentType(
      typeof mark.content_type === "string" ? mark.content_type : null,
    )
  ) {
    return null;
  }
  return {
    r2_key: mark.r2_key,
    content_type: mark.content_type as string,
    updated_at: typeof mark.updated_at === "string" ? mark.updated_at : "",
  };
}

function normalizeProductName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > BRANDING_PRODUCT_NAME_MAX_CHARS) {
    throw new ValidationError(
      `Product name must be at most ${BRANDING_PRODUCT_NAME_MAX_CHARS} characters.`,
    );
  }
  return trimmed;
}

/** Resolve the effective branding for the instance, with FlareMo defaults. */
export async function getBranding(db: FlareMoDb): Promise<ResolvedBranding> {
  const owner = await getFlaremoUserById(db, OWNER_FLAREMO_USER_ID);
  if (!owner) {
    return {
      product: DEFAULT_FLAREMO_PRODUCT_NAME,
      marks: { light: null, dark: null },
    };
  }
  const stored = await getStoredSetting(db, owner, BRANDING_SETTING_KEY);
  const value = readStoredBranding(stored?.value);
  return {
    product:
      normalizeProductName(value.product_name) ?? DEFAULT_FLAREMO_PRODUCT_NAME,
    marks: {
      light: normalizeMark(value.marks?.light),
      dark: normalizeMark(value.marks?.dark),
    },
  };
}

/** Set (or reset) the custom product name shown across the UI. */
export async function setBrandingProductName(
  db: FlareMoDb,
  rawName: string | null,
): Promise<ResolvedBranding> {
  const owner = await getFlaremoUserById(db, OWNER_FLAREMO_USER_ID);
  if (!owner) throw new NotFoundError("Owner not found");
  const stored = await getStoredSetting(db, owner, BRANDING_SETTING_KEY);
  const value = readStoredBranding(stored?.value);
  const next: StoredBranding = {
    ...value,
    product_name: normalizeProductName(rawName),
    marks: {
      light: normalizeMark(value.marks?.light),
      dark: normalizeMark(value.marks?.dark),
    },
  };
  await upsertStoredSetting(db, owner, BRANDING_SETTING_KEY, next);
  return getBranding(db);
}

/**
 * Record a freshly uploaded mark. The caller stores the R2 object itself
 * (keyed by `brandingMarkR2Key(variant)`) and passes back the content type.
 */
export async function upsertBrandingMark(
  db: FlareMoDb,
  variant: BrandingMarkVariant,
  contentType: string,
): Promise<ResolvedBranding> {
  if (!isValidBrandingContentType(contentType)) {
    throw new ValidationError("Unsupported logo content type.");
  }
  const owner = await getFlaremoUserById(db, OWNER_FLAREMO_USER_ID);
  if (!owner) throw new NotFoundError("Owner not found");
  const stored = await getStoredSetting(db, owner, BRANDING_SETTING_KEY);
  const value = readStoredBranding(stored?.value);
  const mark: BrandingMark = {
    r2_key: brandingMarkR2Key(variant),
    content_type: contentType.toLowerCase().trim(),
    updated_at: new Date().toISOString(),
  };
  const next: StoredBranding = {
    ...value,
    marks: { ...value.marks, [variant]: mark },
  };
  await upsertStoredSetting(db, owner, BRANDING_SETTING_KEY, next);
  return getBranding(db);
}

/** Remove a custom mark; returns the stale R2 key for the caller to delete. */
export async function clearBrandingMark(
  db: FlareMoDb,
  variant: BrandingMarkVariant,
): Promise<string | null> {
  const owner = await getFlaremoUserById(db, OWNER_FLAREMO_USER_ID);
  if (!owner) throw new NotFoundError("Owner not found");
  const stored = await getStoredSetting(db, owner, BRANDING_SETTING_KEY);
  const value = readStoredBranding(stored?.value);
  const stale = normalizeMark(value.marks?.[variant]);
  const next: StoredBranding = {
    ...value,
    marks: { ...value.marks, [variant]: null },
  };
  await upsertStoredSetting(db, owner, BRANDING_SETTING_KEY, next);
  return stale?.r2_key ?? null;
}
