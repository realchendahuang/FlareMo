import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type APIRequestContext, request } from "@playwright/test";

// These values are deliberately local-only fixtures. They must never be
// replaced with or read from production secrets.
export const E2E_BASE_URL = "http://127.0.0.1:18787";
export const E2E_BETTER_AUTH_SECRET =
  "flaremo-e2e-better-auth-secret-never-use-in-production-2026";
export const E2E_BOOTSTRAP_SECRET =
  "flaremo-e2e-bootstrap-secret-never-use-in-production-2026";
export const E2E_USERNAME = "e2e_owner";
export const E2E_UPDATED_USERNAME = "e2e_owner_updated";
export const E2E_EMAIL = "e2e-owner@example.test";
export const E2E_NAME = "FlareMo E2E Owner";
export const E2E_INITIAL_PASSWORD =
  "flaremo-e2e-initial-password-never-use-in-production-2026";
export const E2E_UPDATED_PASSWORD =
  "flaremo-e2e-updated-password-never-use-in-production-2026";
export const E2E_AUTH_STATE = resolve("test-results/.auth/owner.json");

export const E2E_BOOTSTRAP_INPUT = {
  username: E2E_USERNAME,
  name: E2E_NAME,
  email: E2E_EMAIL,
  password: E2E_INITIAL_PASSWORD,
};

type Credentials = { username: string; password: string };

type BootstrapStatus = {
  initialized: boolean;
  state: string;
  setup_available: boolean;
};

export async function createInitialAuthState(): Promise<void> {
  await rm(E2E_AUTH_STATE, { force: true });
  await mkdir(dirname(E2E_AUTH_STATE), { recursive: true });

  const context = await request.newContext({ baseURL: E2E_BASE_URL });
  try {
    const statusResponse = await context.get(
      "/api/auth/flaremo/bootstrap/status",
    );
    requireStatus(statusResponse, "bootstrap status");
    const status = (await statusResponse.json()) as BootstrapStatus;
    if (
      status.initialized ||
      status.state !== "ready" ||
      !status.setup_available
    ) {
      throw new Error("E2E database is not a fresh native-auth database.");
    }

    const bootstrapResponse = await context.post(
      "/api/auth/flaremo/bootstrap",
      {
        headers: {
          "x-flaremo-bootstrap-secret": E2E_BOOTSTRAP_SECRET,
          origin: E2E_BASE_URL,
        },
        data: E2E_BOOTSTRAP_INPUT,
      },
    );
    requireStatus(bootstrapResponse, "test-only bootstrap", 201);

    const loginResponse = await signIn(context, {
      username: E2E_USERNAME,
      password: E2E_INITIAL_PASSWORD,
    });
    requireStatus(loginResponse, "test-only login");
    await context.storageState({ path: E2E_AUTH_STATE });
  } finally {
    await context.dispose();
  }
}

export async function restoreInitialAuthState(): Promise<void> {
  const context = await request.newContext({ baseURL: E2E_BASE_URL });
  try {
    const candidates: Credentials[] = [
      { username: E2E_USERNAME, password: E2E_INITIAL_PASSWORD },
      { username: E2E_UPDATED_USERNAME, password: E2E_INITIAL_PASSWORD },
      { username: E2E_USERNAME, password: E2E_UPDATED_PASSWORD },
      { username: E2E_UPDATED_USERNAME, password: E2E_UPDATED_PASSWORD },
    ];

    let active: Credentials | undefined;
    for (const candidate of candidates) {
      const response = await signIn(context, candidate);
      if (response.ok()) {
        active = candidate;
        break;
      }
    }
    if (!active) throw new Error("Could not recover the E2E owner account.");

    if (active.username !== E2E_USERNAME) {
      const usernameResponse = await context.post("/api/auth/update-user", {
        headers: { origin: E2E_BASE_URL },
        data: { username: E2E_USERNAME },
      });
      requireStatus(usernameResponse, "E2E username recovery");
    }

    if (active.password !== E2E_INITIAL_PASSWORD) {
      const passwordResponse = await context.post("/api/auth/change-password", {
        headers: { origin: E2E_BASE_URL },
        data: {
          currentPassword: active.password,
          newPassword: E2E_INITIAL_PASSWORD,
          revokeOtherSessions: true,
        },
      });
      requireStatus(passwordResponse, "E2E password recovery");
    }

    const restoredSession = await context.get("/api/app/memos?page_size=1");
    requireStatus(restoredSession, "E2E storage-state refresh");
    await mkdir(dirname(E2E_AUTH_STATE), { recursive: true });
    await context.storageState({ path: E2E_AUTH_STATE });
  } finally {
    await context.dispose();
  }
}

export async function signIn(
  context: APIRequestContext,
  credentials: Credentials,
): Promise<Awaited<ReturnType<APIRequestContext["post"]>>> {
  return context.post("/api/auth/sign-in/username", {
    headers: { origin: E2E_BASE_URL },
    data: credentials,
  });
}

function requireStatus(
  response: { ok(): boolean; status(): number },
  operation: string,
  expectedStatus = 200,
) {
  if (!response.ok() || response.status() !== expectedStatus) {
    throw new Error(`${operation} failed with HTTP ${response.status()}.`);
  }
}
