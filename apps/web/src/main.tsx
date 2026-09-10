import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrandingProvider } from "@/branding";
import { ThemeProvider } from "@/components/theme-provider.tsx";
import { I18nProvider } from "@/i18n.tsx";
import { registerPwaServiceWorker } from "./pwa.ts";

import "./index.css";
import App from "./App.tsx";

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

void registerPwaServiceWorker().catch(() => undefined);

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
