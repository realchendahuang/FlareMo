import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "@playwright/test";

const baseURL = "http://127.0.0.1:8787";
const outputDir = "docs/assets";
const persistDir = ".wrangler-screenshots";
mkdirSync(outputDir, { recursive: true });
rmSync(persistDir, { recursive: true, force: true });

run("pnpm", ["--filter", "@flaremo/web", "build"]);
run("pnpm", [
  "exec",
  "wrangler",
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--persist-to",
  persistDir,
]);

const server = spawn(
  "pnpm",
  [
    "exec",
    "wrangler",
    "dev",
    "--config",
    "./wrangler.jsonc",
    "--local",
    "--host",
    "127.0.0.1",
    "--persist-to",
    persistDir,
    "--log-level",
    "error",
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
  },
);

server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

try {
  await waitForServer();
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
  stopServer();
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
  await page.waitForTimeout(400);
  await page.screenshot({ path, fullPage: true });
  await page.close();
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    try {
      const response = await fetch(baseURL);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${baseURL}`);
}

function stopServer() {
  if (server.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    server.kill("SIGTERM");
    return;
  }

  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}`,
    );
  }
}
