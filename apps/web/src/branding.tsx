import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getPublicBranding } from "@/api";

export type Branding = {
  product: string;
  markLightUrl: string | null;
  markDarkUrl: string | null;
};

export const DEFAULT_BRANDING: Branding = {
  product: "FlareMo",
  markLightUrl: null,
  markDarkUrl: null,
};

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

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
        markLightUrl: info.mark_light_url,
        markDarkUrl: info.mark_dark_url,
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
