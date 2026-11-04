import { existsSync, rmSync } from "node:fs";

/**
 * Remove build output and local test artifacts. Never touches tracked files:
 * every target below is gitignored. Run from the repository root:
 *
 *   pnpm clean
 */
const targets = [
  "apps/site/dist",
  "apps/web/dist",
  "apps/worker/dist",
  "packages/contracts/dist",
  "packages/db/dist",
  "packages/domain/dist",
  "packages/memos/dist",
  "plugins/dist",
  "test-results",
  "playwright-report",
  "coverage",
  ".wrangler-shots",
  ".wrangler-screenshots",
  ".wrangler-e2e",
];

const removed = [];
for (const target of targets) {
  if (!existsSync(target)) continue;
  rmSync(target, { recursive: true, force: true });
  removed.push(target);
}

console.log(
  removed.length === 0 ? "Nothing to clean." : `Removed: ${removed.join(", ")}`,
);
