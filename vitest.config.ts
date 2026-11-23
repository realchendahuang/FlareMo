import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Same alias the web app's vite config uses; keeps tests that import
      // app components resolvable from the root config.
      "@": path.resolve(import.meta.dirname, "apps/web/src"),
    },
  },
  test: {
    fileParallelism: false,
    // Miniflare owns D1/R2 state and opens Worker-compatible stream handles.
    // A single fork keeps those handles isolated and makes the suite
    // deterministic across macOS and CI hosts.
    pool: "forks",
    maxWorkers: 1,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    coverage: {
      // Advisory only — intentionally NOT wired into CI; full-suite coverage
      // runs cost minutes and the unit gate (pnpm test) stays fast.
      provider: "v8",
      include: [
        "apps/site/src/**",
        "apps/web/src/**",
        "apps/worker/src/**",
        "packages/*/src/**",
        "plugins/src/**",
      ],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        // Generated and type-stub files never carry testable logic.
        "apps/worker/src/worker-configuration.d.ts",
        "apps/worker/src/memos-generated/**",
        // Tests, stories and co-located test companions.
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
      ],
    },
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/Temp/**",
      // Playwright specs run under their own runner; scripts/*.test.mjs and
      // integrations/** use node:test. Both match vitest's glob but are not
      // vitest suites.
      "tests/e2e/**",
      "scripts/**",
      "integrations/**",
    ],
  },
});
