import "@fontsource-variable/noto-sans-arabic";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrandingProvider } from "@/branding";
import { ThemeProvider } from "@/components/theme-provider.tsx";
import { getInitialLocale, I18nProvider, loadLocaleMessages } from "@/i18n.tsx";
import { ensurePwaServiceWorkerRegistration } from "./pwa.ts";

import "./index.css";
import App from "./App.tsx";

// Dev-only element picker (see src/dev/react-grab.ts). The import itself is
// gated rather than just the install call: `import.meta.env.DEV` is replaced
// with `false` in a production build, so the branch — and with it the dynamic
// import and every module it reaches — is dropped before bundling. Gating only
// the call would still emit react-grab as a lazy chunk that ships in `dist/`.
if (import.meta.env.DEV) {
  void import("@/dev/react-grab.ts").then(({ installReactGrab }) => {
    installReactGrab();
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Window-focus refetches used to revalidate every cached list at once,
      // flashing skeletons and replaying entrance animations (the reported
      // "卡顿"). Data goes stale after 30s instead of immediately.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
const root = document.getElementById("root");

if (!root) {
  throw new Error("FlareMo root element was not found.");
}

void ensurePwaServiceWorkerRegistration();

// Fetch the initial locale's catalog before first paint: en-US resolves
// synchronously, and for the other seven this one chunk is the difference
// between a correct first frame and an English flash. `loadLocaleMessages`
// never rejects — a failed pack still renders, with per-key English fallback.
// A cap keeps a stalled catalog request from becoming a permanent blank page:
// the English fallback is always better than no frame at all.
const LOCALE_GATE_TIMEOUT_MS = 1_500;

void Promise.race([
  loadLocaleMessages(getInitialLocale()),
  new Promise<void>((resolve) => {
    setTimeout(resolve, LOCALE_GATE_TIMEOUT_MS);
  }),
]).then(() => {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrandingProvider>
          <I18nProvider>
            <ThemeProvider>
              <App />
            </ThemeProvider>
          </I18nProvider>
        </BrandingProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
});
