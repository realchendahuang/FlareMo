// Deploy preflight for `pnpm deploy`. Validates that the operator provided a
// real BETTER_AUTH_SECRET before a local production deploy.
//
// CI build environments (Workers Builds / Deploy to Cloudflare) do not carry
// operator secrets: the live Worker keeps its secret in the Worker secret
// store, and first-time setups run `wrangler secret put` after the initial
// deploy (docs/deploy.md). Hard-failing there broke every automated first
// deploy in v0.15.0, so CI (`CI=true`) only gets a warning; local deploys
// keep the gate.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const isCi = process.env.CI === "true" || process.env.CI === "1";

// `wrangler.jsonc` is gitignored because it carries a real account id, so a
// clean checkout (Workers Builds, a fresh clone) does not have it. Without
// this check the deploy died later on wrangler's bare ENOENT, which said
// nothing about what to set. A build environment that provides the inputs
// gets the file generated; a local operator gets the two commands that
// produce one.
if (!existsSync("wrangler.jsonc")) {
  const canGenerate = Boolean(
    process.env.WRANGLER_JSONC?.trim() ||
      process.env.FLAREMO_PUBLIC_URL?.trim() ||
      process.env.FLAREMO_D1_DATABASE_ID?.trim(),
  );
  if (!canGenerate) {
    console.error(
      [
        "wrangler.jsonc is missing, so there is nothing to deploy.",
        "",
        "Local deploy:",
        "  cp wrangler.jsonc.example wrangler.jsonc",
        "  pnpm provision:remote   # creates D1/R2/Queue/Vectorize and writes the D1 id back",
        "",
        "Workers Builds / CI: set FLAREMO_PUBLIC_URL as a build environment",
        "variable, plus FLAREMO_D1_DATABASE_ID or a full WRANGLER_JSONC; this",
        "preflight then writes wrangler.jsonc from wrangler.jsonc.example.",
      ].join("\n"),
    );
    process.exit(1);
  }
  execFileSync(process.execPath, ["scripts/write-wrangler-config.mjs"], {
    stdio: "inherit",
  });
}
const secret = process.env.BETTER_AUTH_SECRET?.trim();

let problem;
if (!secret || secret.length < 32) {
  problem =
    "BETTER_AUTH_SECRET must be set to a generated value of at least 32 characters before deployment.";
} else if (/^(change[-_ ]?me|secret|password|test|dev)$/i.test(secret)) {
  problem =
    "BETTER_AUTH_SECRET still uses a known placeholder. Generate a unique production secret before deployment.";
} else if (new Set(secret).size < 12) {
  problem =
    "BETTER_AUTH_SECRET has too little character diversity; generate a random secret.";
}

if (problem) {
  if (isCi) {
    console.warn(
      `Deploy preflight warning (CI): ${problem}\n` +
        "Configure the live Worker secret via `wrangler secret put BETTER_AUTH_SECRET` before going live.",
    );
    console.log(
      "Deployment preflight passed in CI mode (secret warning only).",
    );
    process.exit(0);
  }
  console.error(problem);
  process.exit(1);
}

console.log("Deployment preflight passed: Better Auth secret is configured.");
