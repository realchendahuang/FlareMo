#!/usr/bin/env node
/**
 * Renders apps/site/public/og-image.png — the 1200x630 social card.
 *
 * Why a committed PNG instead of the old hand-written SVG: X, Slack,
 * LinkedIn and iMessage do not render SVG og:image previews, so the site
 * shared with no card at all. This script keeps the layout reproducible;
 * run it after changing the brand, the headline or the hero screenshot.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, "..");
const repoRoot = path.resolve(siteRoot, "../..");

const mark = path.join(siteRoot, "public/brand/flaremo-mark-light-300.png");
const shot = path.join(siteRoot, "public/screenshots/app-en.webp");

/** page.setContent has no file base, so every asset must be inlined. */
function dataUrl(target, mime) {
  return `data:${mime};base64,${readFileSync(target).toString("base64")}`;
}

let geistFace = "";
try {
  const pkg = fileURLToPath(import.meta.resolve("@fontsource-variable/geist"));
  const font = path.join(path.dirname(pkg), "files/geist-latin-wght-normal.woff2");
  if (existsSync(font)) {
    geistFace = `@font-face { font-family: "Geist"; src: url("${dataUrl(font, "font/woff2")}") format("woff2"); font-weight: 100 900; }`;
  }
} catch {
  // Fall back to the system stack below when the package is not resolvable.
}

const markUrl = dataUrl(mark, "image/png");
const shotUrl = dataUrl(shot, "image/webp");

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${geistFace}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    font-family: "Geist", -apple-system, "Segoe UI", system-ui, sans-serif;
    background: #f6f6f7; color: #18181b; position: relative;
  }
  .glow {
    position: absolute; inset: 0;
    background:
      radial-gradient(560px 340px at 8% -6%, rgba(249,115,22,0.18), transparent 70%),
      radial-gradient(700px 420px at 96% 108%, rgba(249,115,22,0.08), transparent 72%);
  }
  .head { position: absolute; left: 72px; top: 56px; right: 72px; }
  .brand { display: flex; align-items: center; gap: 15px; }
  .brand img { width: 56px; height: 56px; }
  .brand span { font-size: 34px; font-weight: 650; letter-spacing: -1px; }
  h1 { margin-top: 40px; font-size: 66px; line-height: 1.03; letter-spacing: -2.6px; font-weight: 720; }
  h1 .accent {
    background-image: linear-gradient(135deg, #fb923c 0%, #f97316 50%, #ea580c 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  p.sub { margin-top: 20px; font-size: 25px; line-height: 1.4; color: #52525b; letter-spacing: -0.3px; max-width: 760px; }
  .shot {
    position: absolute; left: 110px; top: 338px; width: 980px;
    border-radius: 20px 20px 0 0; overflow: hidden;
    border: 1px solid rgba(24,24,27,0.14); border-bottom: none;
    box-shadow: 0 -2px 0 rgba(255,255,255,0.6) inset, 0 30px 70px -20px rgba(24,24,27,0.28);
    background: #fff;
  }
  .shot img { display: block; width: 100%; }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="head">
    <div class="brand">
      <img src="${markUrl}" alt="" />
      <span>FlareMo</span>
    </div>
    <h1>Your notes, <span class="accent">on the edge.</span></h1>
    <p class="sub">Open-source and AI-native, running on a free Cloudflare account. Agents can read and write the same notes over MCP.</p>
  </div>
  <div class="shot"><img src="${shotUrl}" alt="" /></div>
</body>
</html>`;

const outDir = path.join(siteRoot, "public");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(300);
  const buffer = await page.screenshot({ type: "png" });
  await writeFile(path.join(outDir, "og-image.png"), buffer);
  console.log(`[og] wrote public/og-image.png (${buffer.length} bytes)`);
} finally {
  await browser.close();
}