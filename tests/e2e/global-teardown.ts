import { rm } from "node:fs/promises";
import { E2E_AUTH_STATE } from "./auth-fixture";

export default async function globalTeardown() {
  // The state contains a live HttpOnly session cookie. Keep it only for the
  // duration of this local run and never leave it as a repository artifact.
  await rm(E2E_AUTH_STATE, { force: true });
}
