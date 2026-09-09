import { defineConfig, devices } from "@playwright/test";
import { E2E_AUTH_STATE, E2E_BASE_URL } from "./tests/e2e/auth-fixture";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  // Every project shares one wrangler dev server and one auth state, so
  // parallel workers contend for the same D1 write lock — that contention is
  // what made the heaviest memo-flow case flake under load. Keep the run
  // serial; 24 cases stay comfortably fast this way.
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "auth-contract",
      testMatch: /auth-flow\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: undefined },
    },
    {
      name: "auth-ui",
      dependencies: ["auth-contract"],
      testMatch: /(auth-ui-flow|auth-redirect)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: E2E_AUTH_STATE,
      },
    },
    {
      name: "memo-ui",
      dependencies: ["auth-ui"],
      testMatch: /(memo-flow|memory-flow)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: E2E_AUTH_STATE,
      },
    },
  ],
  webServer: {
    command: "node ./scripts/e2e-server.mjs",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    url: E2E_BASE_URL,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
