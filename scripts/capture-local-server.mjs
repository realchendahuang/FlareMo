#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";
import { parse as parseJsonc } from "jsonc-parser";
import { Log, LogLevel, Miniflare } from "miniflare";
import { buildWorkerBundle } from "./lib/worker-bundle.mjs";

const repoRoot = resolve(
  process.env.FLAREMO_REPO_ROOT ??
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
const compatibilityDate = "2026-07-10";
const compatibilityFlags = ["nodejs_compat"];
process.chdir(repoRoot);

await run().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Capture local server failed.",
  );
  process.exitCode = 1;
});

async function run() {
  const {
    persistRoot,
    port,
    publicUrl,
    reuseWebBuild,
    reuseWorkerBundle,
    skipMigrations,
  } = parseArguments(process.argv.slice(2));
  const localOrigin = `http://localhost:${port}`;
  const publicOrigin = normalizePublicOrigin(publicUrl ?? localOrigin);
  const generatedBundleDir = resolve(
    ".wrangler",
    `capture-local-bundle-${process.pid}`,
  );
  const bundleDir = reuseWorkerBundle ?? generatedBundleDir;
  const config = await loadConfig();
  const devVars = await loadDevVars();
  const databaseId = findBinding(config.d1_databases, "DB", "database_id");
  const bucketName = findBinding(
    config.r2_buckets,
    "ATTACHMENTS",
    "bucket_name",
  );
  const trustedOrigins = new Set([
    localOrigin,
    publicOrigin,
    ...String(devVars.FLAREMO_TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ]);
  const bindings = {
    ...(config.vars ?? {}),
    ...devVars,
    FLAREMO_EMBEDDING_PROVIDER: "none",
    FLAREMO_PUBLIC_URL: publicOrigin,
    FLAREMO_TRUSTED_ORIGINS: [...trustedOrigins].join(","),
  };

  let runtime;
  try {
    if (!reuseWorkerBundle)
      await rm(bundleDir, { force: true, recursive: true });
    if (!skipMigrations) applyMigrations(persistRoot);
    if (reuseWorkerBundle) await access(resolve(bundleDir, "index.js"));
    else buildWorkerBundle(bundleDir, { buildWeb: !reuseWebBuild });
    runtime = new Miniflare({
      assets: {
        assetConfig: {
          compatibility_date: compatibilityDate,
          compatibility_flags: compatibilityFlags,
          not_found_handling: "single-page-application",
        },
        binding: "ASSETS",
        directory: resolve("apps/web/dist"),
        routerConfig: {
          has_user_worker: true,
          invoke_user_worker_ahead_of_assets: true,
        },
      },
      bindings,
      cachePersist: resolve(persistRoot, "v3/cache"),
      compatibilityDate,
      compatibilityFlags,
      d1Databases: { DB: databaseId },
      d1Persist: resolve(persistRoot, "v3/d1"),
      host: "localhost",
      log: new Log(LogLevel.INFO, { prefix: "capture" }),
      modules: [{ path: resolve(bundleDir, "index.js"), type: "ESModule" }],
      port,
      queueProducers: queueBindings(config.queues?.producers),
      r2Buckets: { ATTACHMENTS: bucketName },
      r2Persist: resolve(persistRoot, "v3/r2"),
    });
    const readyUrl = await runtime.ready;
    console.log(`Capture local server ready: ${new URL("/capture", readyUrl)}`);
    if (publicOrigin !== localOrigin)
      console.log(
        `Capture external origin configured: ${new URL("/capture", publicOrigin)}`,
      );
    await waitForShutdown();
  } finally {
    await runtime?.dispose().catch(() => undefined);
    if (!reuseWorkerBundle)
      await rm(bundleDir, { force: true, recursive: true });
  }
}

function parseArguments(arguments_) {
  const values = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  let port = 8790;
  let persistRoot = resolve(".wrangler/state");
  let publicUrl;
  let reuseWebBuild = false;
  let reuseWorkerBundle;
  let skipMigrations = false;
  for (let index = 0; index < values.length; ) {
    const option = values[index];
    if (option === "--reuse-web-build") {
      reuseWebBuild = true;
      index += 1;
      continue;
    }
    if (option === "--skip-migrations") {
      skipMigrations = true;
      index += 1;
      continue;
    }
    const value = values[index + 1];
    if (!value) throw new Error(`Missing value for ${option ?? "argument"}.`);
    if (option === "--port") {
      port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65_535)
        throw new Error(
          "Capture local server port must be between 1 and 65535.",
        );
    } else if (option === "--persist-to") persistRoot = resolve(value);
    else if (option === "--public-url") publicUrl = value;
    else if (option === "--reuse-worker-bundle")
      reuseWorkerBundle = resolve(value);
    else throw new Error(`Unknown Capture local server option: ${option}.`);
    index += 2;
  }
  return {
    persistRoot,
    port,
    publicUrl,
    reuseWebBuild,
    reuseWorkerBundle,
    skipMigrations,
  };
}

function normalizePublicOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Capture public URL must be an absolute URL.");
  }
  if (url.username || url.password)
    throw new Error("Capture public URL must not contain credentials.");
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Capture public URL must use HTTP or HTTPS.");
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname))
    throw new Error("Capture public URL must use HTTPS outside localhost.");
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error(
      "Capture public URL must be an origin without a path, query, or fragment.",
    );
  return url.origin;
}

function isLoopbackHostname(hostname) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

async function loadConfig() {
  const errors = [];
  const config = parseJsonc(
    await readFile(resolve("wrangler.jsonc"), "utf8"),
    errors,
    {
      allowTrailingComma: true,
      disallowComments: false,
    },
  );
  if (errors.length || !config || typeof config !== "object")
    throw new Error("Could not parse wrangler.jsonc.");
  return config;
}

async function loadDevVars() {
  try {
    return parseDotenv(await readFile(resolve(".dev.vars"), "utf8"));
  } catch {
    throw new Error("Could not read the ignored .dev.vars configuration.");
  }
}

function findBinding(entries, binding, field) {
  const match = entries?.find((entry) => entry.binding === binding)?.[field];
  if (typeof match !== "string" || !match)
    throw new Error(`wrangler.jsonc is missing the ${binding} binding.`);
  return match;
}

function queueBindings(producers = []) {
  return Object.fromEntries(
    producers.flatMap((producer) =>
      typeof producer.binding === "string" && typeof producer.queue === "string"
        ? [[producer.binding, producer.queue]]
        : [],
    ),
  );
}

function applyMigrations(persistRoot) {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      persistRoot,
    ],
    {
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: "pipe",
    },
  );
  if (result.status !== 0)
    throw new Error("Could not apply local FlareMo migrations.");
}

function waitForShutdown() {
  return new Promise((resolveShutdown) => {
    process.once("SIGINT", resolveShutdown);
    process.once("SIGTERM", resolveShutdown);
  });
}
