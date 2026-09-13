import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export function buildWorkerBundle(bundleDir, { buildWeb = true } = {}) {
  if (buildWeb) run("pnpm", ["--filter", "@flaremo/web", "build"]);
  else if (!existsSync("apps/web/dist/index.html"))
    throw new Error("The existing FlareMo web build is unavailable.");
  run("pnpm", [
    "exec",
    "wrangler",
    "deploy",
    "--config",
    "./wrangler.jsonc",
    "--dry-run",
    "--outdir",
    bundleDir,
  ]);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    shell: process.platform === "win32",
    stdio: "pipe",
  });
  if (result.status !== 0)
    throw new Error("Could not build the FlareMo Worker bundle.");
}
