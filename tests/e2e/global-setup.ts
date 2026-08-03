import type { FullConfig } from "@playwright/test";
import { createInitialAuthState, E2E_BASE_URL } from "./auth-fixture";

export default async function globalSetup(config: FullConfig) {
  const configuredBaseUrls = config.projects
    .map((project) => project.use.baseURL)
    .filter((value): value is string => typeof value === "string");
  if (configuredBaseUrls.some((baseURL) => baseURL !== E2E_BASE_URL)) {
    throw new Error("E2E base URL must remain the local test Worker.");
  }

  await createInitialAuthState();
}
