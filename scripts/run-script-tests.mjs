import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Run every `scripts/**\/*.test.mjs` file under the Node test runner.
 *
 * The gate used to list script tests one by one, which let new test files
 * (and two existing ones) silently stay out of `pnpm verify`. Collecting the
 * directory keeps the gate honest without another hand-maintained list.
 */
const root = import.meta.dirname;
const files = [];
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
    files.push(join(root, entry.name));
  }
}
files.sort();

if (files.length === 0) {
  console.error("No scripts/**/*.test.mjs files found.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
