// Deploy preflight for `pnpm deploy`. Validates that the operator provided a
// real BETTER_AUTH_SECRET before a local production deploy.
//
// CI build environments (Workers Builds / Deploy to Cloudflare) do not carry
// operator secrets: the live Worker keeps its secret in the Worker secret
// store, and first-time setups run `wrangler secret put` after the initial
// deploy (docs/deploy.md). Hard-failing there broke every automated first
// deploy in v0.15.0, so CI (`CI=true`) only gets a warning; local deploys
// keep the gate.
const isCi = process.env.CI === "true" || process.env.CI === "1";
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
