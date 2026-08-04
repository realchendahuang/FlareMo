import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    // Miniflare owns D1/R2 state and opens Worker-compatible stream handles.
    // A single fork keeps those handles isolated and makes the suite
    // deterministic across macOS and CI hosts.
    pool: "forks",
    maxWorkers: 1,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/.wrangler/**",
      "**/Temp/**",
    ],
  },
});
