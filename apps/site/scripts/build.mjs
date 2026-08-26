#!/usr/bin/env node
/**
 * FlareMo marketing site static build (SSG).
 *
 * Stack is identical to apps/web (React + Vite + TanStack Router code-based):
 *   1. `vite build` → client bundle into dist/site/assets (hashed, manifest.json)
 *   2. Load src/ssr-render.tsx through Vite SSR to render every route to a
 *      complete static HTML document (SEO head + body), replacing the dev
 *      entry script with the hashed client bundle path from manifest.json.
 *   3. Write dist/site/<path>/index.html per route; copy public/; emit sitemap.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, writeFile, cp, rm, readFile } from "node:fs/promises";
import { createServer } from "vite";
import { build } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const outDir = path.join(root, "dist", "site");
const manifestPath = path.join(outDir, ".vite", "manifest.json");

/** All paths that should be prerendered (with doc slugs expanded). */
function getAllPaths() {
  const zhDocs = [
    "agent-deploy",
    "agent-ingestion",
    "agent-memory",
    "architecture-notes",
    "deploy-button-test",
    "deploy",
    "design-system",
    "maintenance",
    "memos-compatibility",
    "memos-ecosystem",
    "product-requirements",
    "release",
    "semantic-search",
    "tech-stack",
    "update",
  ];
  const enDocs = ["deploy", "agent-deploy", "memos-compatibility", "update"];

  return [
    "/",
    "/en",
    "/pricing",
    "/en/pricing",
    "/hosted",
    "/en/hosted",
    "/docs",
    "/en/docs",
    ...zhDocs.map((slug) => `/docs/${slug}`),
    ...enDocs.map((slug) => `/en/docs/${slug}`),
  ];
}

function outputPathFor(routePath) {
  if (routePath === "/") return path.join(outDir, "index.html");
  const clean = routePath.replace(/^\//, "");
  return path.join(outDir, clean, "index.html");
}

async function main() {
  console.log("[site] building client bundle...");
  await build({ root, configFile: path.join(root, "vite.config.ts") });

  // Vite also emitted its own index.html shell into outDir — remove it; the
  // SSG pass writes the real documents below.
  const viteShell = path.join(outDir, "index.html");
  await rm(viteShell, { force: true });

  // Read the hashed entry script + css from the manifest.
  let entryJs = "/src/main.tsx";
  let entryCss = "";
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const entry = manifest["index.html"];
    if (entry?.file) entryJs = `/${entry.file}`;
    if (entry?.css?.length) entryCss = `/${entry.css[0]}`;
  } catch {
    // Fall back to dev paths; production will just miss assets.
  }

  console.log(`[site] entry js=${entryJs} css=${entryCss}`);
  console.log("[site] starting SSR server...");
  const vite = await createServer({
    root,
    configFile: path.join(root, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });

  try {
    const renderModule = await vite.ssrLoadModule("/src/ssr-render.tsx");
    const { renderRoute } = renderModule;
    const paths = getAllPaths();

    for (const routePath of paths) {
      console.log(`[site] rendering ${routePath}`);
      let { html } = await renderRoute(routePath);
      html = injectAssets(html, entryJs, entryCss);
      const out = outputPathFor(routePath);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, html, "utf8");
    }

    // Copy public/ static assets into dist root.
    const publicDir = path.join(root, "public");
    await cp(publicDir, outDir, { recursive: true });

    // Emit sitemap.xml
    const sitemap = buildSitemap(paths);
    await writeFile(path.join(outDir, "sitemap.xml"), sitemap, "utf8");

    console.log(`[site] done → ${outDir}`);
  } finally {
    await vite.close();
  }
}

function injectAssets(html, entryJs, entryCss) {
  let out = html.replace(
    '<script type="module" src="/src/main.tsx"></script>',
    `<script type="module" crossorigin src="${entryJs}"></script>`,
  );
  if (entryCss) {
    out = out.replace("</head>", `    <link rel="stylesheet" href="${entryCss}" />\n  </head>`);
  }
  return out;
}

function buildSitemap(paths) {
  const urls = paths
    .map((p) => {
      const loc = p === "/" ? "https://flaremo.app/" : `https://flaremo.app${p}`;
      return `  <url><loc>${loc}</loc></url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});