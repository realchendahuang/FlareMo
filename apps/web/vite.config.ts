import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `pnpm dev:hot` runs this dev server next to `wrangler dev`, which keeps the
// Worker side hot too. The Worker owns the API, the SSR share/article pages, R2
// attachments and the feeds; proxying those paths keeps the browser on a single
// origin, so Better Auth's cookie and origin checks see the URL that is
// actually in the address bar and no build step sits between an edit and the
// page. Both ports are overridable so a second checkout (or a port-forward from
// another machine) can run its own pair.
// Deliberately not Vite's default 5173: every other Vite project on this
// machine claims that port, so this loop uses its own and `strictPort` turns a
// collision into a loud failure instead of a silent port drift that would also
// break the Worker's origin check.
const WEB_DEV_PORT = Number(process.env.FLAREMO_DEV_WEB_PORT ?? 5573);
const WORKER_DEV_PORT = Number(process.env.FLAREMO_DEV_WORKER_PORT ?? 8787);
// `changeOrigin` rewrites Host to the Worker's own address. Without it the
// Worker sees `Host: localhost:5173` while the browser also sends
// `Origin: http://localhost:5173`, and wrangler's local proxy drops an Origin
// that matches the request host — the Worker then reads a missing Origin and
// rejects every write with "must use FlareMo's origin". Rewriting Host keeps
// the two apart, which is what the origin check wants to see.
const WORKER_PROXY = {
  target: `http://127.0.0.1:${WORKER_DEV_PORT}`,
  changeOrigin: true,
} as const;

// Each key is one entry of `assets.run_worker_first` in wrangler.jsonc with a
// trailing `*` dropped: Vite matches these as path prefixes while Cloudflare
// matches its entries as globs, and the trailing slash is what keeps a prefix
// from over-reaching. Without it `/article` would also swallow the SPA's
// `/articles` route, and `/memory` its `/memory` route, serving both from the
// stale build this dev server exists to replace. A parity test in
// src/dev-proxy-parity.test.ts fails if the two lists drift.

// https://vite.dev/config/
export default defineConfig({
  build: {
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // React runtime: tiny, shared by every chunk, changes rarely.
            // use-sync-external-store lives here too: eager code (sonner,
            // base-ui…) needs it, and leaving it in vendor-tiptap's
            // dependency closure would make the editor chunk load eagerly.
            {
              name: "vendor-react",
              test: /node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/,
              priority: 10,
            },
            // TipTap + ProseMirror: only the lazy rich composer chunk needs
            // it; keeping it in its own chunk keeps the initial load free of
            // the editor.
            // Floating UI is shared by Base UI (eager: tooltips, menus) and
            // the TipTap bubble menu (lazy). Without its own group it joins
            // vendor-tiptap through the lazy dependency and drags the whole
            // editor chunk into the first screen's preload list.
            {
              name: "vendor-floating",
              test: /node_modules[\\/]@floating-ui[\\/]/,
              priority: 5,
            },
            {
              name: "vendor-tiptap",
              test: /node_modules[\\/]@tiptap[\\/]/,
            },
            // Markdown pipeline (react-markdown + unified/remark/micromark):
            // only the lazy memo-content chunk needs it.
            {
              name: "vendor-markdown",
              test: /node_modules[\\/](react-markdown|remark-|rehype-|unified|micromark|mdast-|hast-|unist-|vfile|bail|trough|devlop|ccount|escape-string-regexp|property-information|space-separated-tokens|comma-separated-tokens|trim-lines|character-entities|decode-named-html-entity|markdown-table|zwitch|longest-streak|html-url-attributes|web-namespaces)/,
            },
            // TanStack router/query: big app-shell libs.
            {
              name: "vendor-tanstack",
              test: /node_modules[\\/]@tanstack[\\/]/,
            },
          ],
        },
      },
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: WEB_DEV_PORT,
    // The proxy target and the trusted dev origins are keyed to these ports;
    // silently drifting to another one would fail the Worker's origin check.
    strictPort: true,
    // Mirrors `assets.run_worker_first` in wrangler.jsonc: everything the
    // Worker renders itself. Keep the two lists in sync.
    proxy: {
      "/api/": WORKER_PROXY,
      "/article/": WORKER_PROXY,
      "/feed.xml": WORKER_PROXY,
      "/file/": WORKER_PROXY,
      "/mcp": WORKER_PROXY,
      "/memory/": WORKER_PROXY,
      "/memos.api.v1.": WORKER_PROXY,
      "/openapi.json": WORKER_PROXY,
      "/share/": WORKER_PROXY,
      "/sitemap.xml": WORKER_PROXY,
      "/sitemap-articles.xml": WORKER_PROXY,
      "/favicon.ico": WORKER_PROXY,
    },
  },
});
