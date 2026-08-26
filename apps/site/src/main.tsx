import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { createAppRouter } from "@/router";
import "@/styles/tokens.css";

const router = createAppRouter();

// During prerender builds we hydrate the static HTML emitted by scripts/build.mjs.
// In dev (`vite`) the shell is empty, so createRoot is the fallback.
function bootstrap() {
  const rootEl = document.getElementById("root");
  if (!rootEl) return;

  const app = (
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );

  if (rootEl.childElementCount > 0) {
    hydrateRoot(rootEl, app);
  } else {
    createRoot(rootEl).render(app);
  }
}

bootstrap();
