import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "@playwright/test";
import {
  startDevServer,
  stopDevServer,
  waitForHttpReady,
} from "./lib/dev-server.mjs";

const baseURL = "http://127.0.0.1:8787";
const outputDir = "docs/assets";
const persistDir = ".wrangler-screenshots";
mkdirSync(outputDir, { recursive: true });
rmSync(persistDir, { recursive: true, force: true });

const server = startDevServer({
  persistDir,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

try {
  await waitForHttpReady(baseURL);
  const browser = await chromium.launch();
  try {
    await capture(
      browser,
      { width: 1440, height: 1040 },
      `${outputDir}/flaremo-desktop.png`,
    );
    await capture(
      browser,
      { width: 390, height: 844, isMobile: true },
      `${outputDir}/flaremo-mobile.png`,
    );
  } finally {
    await browser.close();
  }
} finally {
  stopDevServer(server);
}

async function capture(browser, viewport, path) {
  const page = await browser.newPage({ viewport });
  await page.goto(baseURL);
  await page
    .getByRole("textbox", { name: /new note|新笔记/i })
    .fill("Capture ideas as fast as they appear #inbox");
  await page.getByRole("button", { name: /save|保存/i }).click();
  await page
    .getByRole("textbox", { name: /new note|新笔记/i })
    .fill(
      "Cloudflare-native notes with D1, R2, Access, OpenAPI, and MCP #cloudflare",
    );
  await page.getByRole("button", { name: /save|保存/i }).click();
  await page
    .getByRole("textbox", { name: /new note|新笔记/i })
    .fill(
      "Memos-compatible API for clients, scripts, import/export, and automation #memos",
    );
  await page.getByRole("button", { name: /save|保存/i }).click();
  await page.addStyleTag({
    content: "[data-sonner-toaster] { display: none !important; }",
  });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path, fullPage: true });
  await page.close();
}
