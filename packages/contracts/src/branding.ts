/**
 * Accent presets shared by the server whitelist and the web theme picker.
 * The CSS ramps stay in the app (`:root[data-accent=...]`); this module only
 * carries the ids and the normalization rules so hand-edited settings cannot
 * put the two sides out of sync.
 */
export const BRANDING_ACCENT_PRESETS = [
  "flame",
  "ocean",
  "indigo",
  "iris",
  "jade",
  "teal",
  "crimson",
  "amber",
] as const;

export const CUSTOM_BRANDING_ACCENT = "custom";

export type BrandingAccent =
  | (typeof BRANDING_ACCENT_PRESETS)[number]
  | typeof CUSTOM_BRANDING_ACCENT;

export const DEFAULT_BRANDING_ACCENT: BrandingAccent = "flame";

export const BRANDING_ACCENT_HEX_PATTERN = /^#[0-9a-f]{6}$/i;

export function normalizeBrandingAccentHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().toLowerCase();
  return BRANDING_ACCENT_HEX_PATTERN.test(hex) ? hex : null;
}

export function normalizeBrandingAccent(
  accent: unknown,
  accentHex: unknown,
): BrandingAccent {
  if (accent === CUSTOM_BRANDING_ACCENT) {
    return normalizeBrandingAccentHex(accentHex)
      ? CUSTOM_BRANDING_ACCENT
      : DEFAULT_BRANDING_ACCENT;
  }
  return BRANDING_ACCENT_PRESETS.some((preset) => preset === accent)
    ? (accent as BrandingAccent)
    : DEFAULT_BRANDING_ACCENT;
}
