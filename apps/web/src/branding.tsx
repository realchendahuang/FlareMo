import {
  BRANDING_ACCENT_PRESETS,
  type BrandingAccent,
  CUSTOM_BRANDING_ACCENT,
  normalizeBrandingAccent,
} from "@flaremo/contracts";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getPublicBranding } from "@/api";
import {
  setCustomFavicon,
  setFaviconAccent,
} from "@/components/theme-provider";
import { buildCustomRamp, normalizeHexColor } from "@/lib/brand-ramp";

export type { BrandingAccent } from "@flaremo/contracts";
export { normalizeBrandingAccent } from "@flaremo/contracts";

export type Branding = {
  product: string;
  accent: BrandingAccent;
  accentHex: string | null;
  markLightUrl: string | null;
  markDarkUrl: string | null;
  faviconUrl: string | null;
};

export const DEFAULT_BRANDING: Branding = {
  product: "FlareMo",
  accent: "flame",
  accentHex: null,
  markLightUrl: null,
  markDarkUrl: null,
  faviconUrl: null,
};

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export const BRANDING_ACCENTS = BRANDING_ACCENT_PRESETS;

/** Swatch order for the admin picker: presets, then the custom seed option. */
export const BRANDING_ACCENT_CHOICES: BrandingAccent[] = [
  ...BRANDING_ACCENT_PRESETS,
  CUSTOM_BRANDING_ACCENT,
];

const CUSTOM_RAMP_VARS = [
  "--brand-50",
  "--brand-100",
  "--brand-200",
  "--brand-300",
  "--brand-400",
  "--brand-500",
  "--brand-600",
  "--brand-700",
  "--brand-coral",
  "--brand-gradient-foreground",
  "--brand-custom-fg-light",
  "--brand-custom-fg-dark",
] as const;

function applyCustomRamp(seedHex: string) {
  const ramp = buildCustomRamp(seedHex);
  const style = document.documentElement.style;
  for (const [step, value] of Object.entries(ramp.steps)) {
    style.setProperty(`--brand-${step}`, value);
  }
  style.setProperty("--brand-coral", ramp.coral);
  style.setProperty("--brand-gradient-foreground", ramp.gradientForeground);
  style.setProperty("--brand-custom-fg-light", ramp.primaryForegroundLight);
  style.setProperty("--brand-custom-fg-dark", ramp.primaryForegroundDark);
}

function clearCustomRamp() {
  const style = document.documentElement.style;
  for (const name of CUSTOM_RAMP_VARS) {
    style.removeProperty(name);
  }
}

function applyAccent(accent: BrandingAccent, accentHex: string | null) {
  if (accent === "custom") {
    const seed = normalizeHexColor(accentHex ?? "");
    if (!seed) {
      applyAccent(DEFAULT_BRANDING.accent, null);
      return;
    }
    document.documentElement.dataset.accent = "custom";
    applyCustomRamp(seed);
    return;
  }
  clearCustomRamp();
  // "flame" is the compiled-in default: no attribute keeps it a one-selector
  // match instead of adding a redundant [data-accent=flame] override block.
  if (accent === DEFAULT_BRANDING.accent) {
    delete document.documentElement.dataset.accent;
  } else {
    document.documentElement.dataset.accent = accent;
  }
}

/**
 * Branding resolves once per mount, so a tab that was already open would keep
 * the old accent forever while the owner repaints it elsewhere — the "changed
 * the theme and nothing happened" experience. Owner-side changes broadcast
 * here and every open tab re-applies through its own BrandingProvider.
 */
const BRANDING_CHANNEL_NAME = "flaremo-branding";
let brandingChannel: BroadcastChannel | null = null;

function getBrandingChannel(): BroadcastChannel | null {
  brandingChannel ??= (() => {
    try {
      return new BroadcastChannel(BRANDING_CHANNEL_NAME);
    } catch {
      // No BroadcastChannel (old browser, restrictive embed): the next page
      // load still resolves branding fresh from the server.
      return null;
    }
  })();
  return brandingChannel;
}

/**
 * Applies an accent immediately (admin saves, optimistic updates) without
 * waiting for a BrandingProvider refetch; the next branding fetch agrees.
 * Also fan-outs to every open tab so they repaint in the same frame.
 */
export function setAccentAttribute(accent: BrandingAccent, accentHex?: string) {
  applyAccent(accent, accentHex ?? null);
  getBrandingChannel()?.postMessage({
    type: "accent",
    accent,
    accentHex: accentHex ?? null,
  });
}

/**
 * Resolves the instance's white-label branding once on mount. Consumers
 * render bundled FlareMo assets immediately and swap to the configured
 * branding when the public endpoint responds, so anonymous pages never gate
 * rendering on this fetch.
 */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  useEffect(() => {
    let cancelled = false;
    void getPublicBranding().then((info) => {
      if (cancelled || !info) return;
      setBranding({
        product: info.product,
        accent: normalizeBrandingAccent(info.accent, info.accent_hex),
        accentHex: info.accent_hex ?? null,
        markLightUrl: info.mark_light_url,
        markDarkUrl: info.mark_dark_url,
        faviconUrl: info.favicon_url ?? null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (branding.product !== DEFAULT_BRANDING.product) {
      document.title = branding.product;
    }
  }, [branding.product]);

  useEffect(() => {
    applyAccent(branding.accent, branding.accentHex);
    if (branding.faviconUrl) {
      // A custom favicon overrides both the bundled theme-dependent icons and
      // the accent-recolor machinery in setFaviconAccent.
      setCustomFavicon(branding.faviconUrl);
      return;
    }
    // No prerendered mark exists for arbitrary seeds: a custom accent keeps
    // the bundled flame favicon rather than a broken /brand/custom/ URL.
    setFaviconAccent(branding.accent === "custom" ? "flame" : branding.accent);
  }, [branding.accent, branding.accentHex, branding.faviconUrl]);

  // Sibling tabs paint owner-side accent changes instantly. Reuses the same
  // apply effect above (favicon included); the broadcast sender never hears
  // its own message, so there is no echo loop.
  useEffect(() => {
    const channel = getBrandingChannel();
    if (!channel) return undefined;

    const handleMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        accent?: BrandingAccent;
        accentHex?: string | null;
      };
      if (data?.type !== "accent") return;
      setBranding((current) => {
        const accent = normalizeBrandingAccent(data.accent, data.accentHex);
        const accentHex =
          accent === "custom" ? normalizeHexColor(data.accentHex ?? "") : null;
        if (accent === current.accent && accentHex === current.accentHex) {
          return current;
        }
        return { ...current, accent, accentHex };
      });
    };

    channel.addEventListener("message", handleMessage);
    return () => channel.removeEventListener("message", handleMessage);
  }, []);

  const value = useMemo(() => branding, [branding]);
  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
