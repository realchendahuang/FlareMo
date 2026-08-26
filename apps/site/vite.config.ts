import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 700,
    emptyOutDir: true,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({
      prerender: {
        enabled: true,
        autoSubfolderIndex: true,
        autoStaticPathsDiscovery: true,
        crawlLinks: true,
        concurrency: 14,
        filter: ({ path }) => !path.startsWith("/api"),
      },
      sitemap: { enabled: true, host: "https://flaremo.app" },
    }),
    viteReact(),
    tailwindcss(),
  ],
});