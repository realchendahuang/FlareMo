import { defineConfig, devices } from "@playwright/test";
import { E2E_AUTH_STATE, E2E_BASE_URL } from "./e2e/auth-fixture";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /capture-webkit\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    ...devices["iPhone 15"],
    baseURL: E2E_BASE_URL,
    permissions: ["microphone"],
    serviceWorkers: "block",
    storageState: E2E_AUTH_STATE,
    trace: "retain-on-failure",
  },
  projects: [{ name: "capture-webkit" }],
  webServer: {
    command: "node ./scripts/e2e-server.mjs",
    cwd: "..",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    url: E2E_BASE_URL,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
