#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_NAMES = ["BETTER_AUTH_SECRET", "FLAREMO_BOOTSTRAP_SECRET"];

export function inspectWorkerSecret(name, value) {
  const secret = String(value ?? "").trim();
  if (!secret) return { status: "missing" };
  if (secret.length < 32) {
    return {
      status: "invalid",
      problem: `${name} must be at least 32 characters.`,
    };
  }
  if (/^(change[-_ ]?me|secret|password|test|dev)$/i.test(secret)) {
    return {
      status: "invalid",
      problem: `${name} still uses a known placeholder.`,
    };
  }
  if (new Set(secret).size < 12) {
    return {
      status: "invalid",
      problem: `${name} has too little character diversity.`,
    };
  }
  return { status: "ok", secret };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Worker secret sync failed.",
    );
    process.exit(1);
  }
}

function main() {
  let uploaded = 0;
  for (const name of SECRET_NAMES) {
    const inspection = inspectWorkerSecret(name, process.env[name]);
    if (inspection.status === "missing") {
      console.log(`Skipping ${name}: GitHub secret is not set.`);
      continue;
    }
    if (inspection.status === "invalid") {
      console.error(inspection.problem);
      process.exit(1);
    }
    putSecret(name, inspection.secret);
    uploaded += 1;
    console.log(`Uploaded Worker secret ${name}.`);
  }
  if (uploaded === 0) {
    console.log(
      "No Worker secrets were uploaded. Set GitHub secrets BETTER_AUTH_SECRET and FLAREMO_BOOTSTRAP_SECRET, or use wrangler secret put / the Cloudflare dashboard.",
    );
  }
}

function putSecret(name, value) {
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "secret", "put", name, "--config", "./wrangler.jsonc"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        WRANGLER_SEND_METRICS: "false",
      },
      input: `${value}\n`,
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.status === 0) return;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replaceAll(
    value,
    "[redacted]",
  );
  throw new Error(
    `wrangler secret put ${name} failed (${result.status ?? 1}):\n${output}`,
  );
}
