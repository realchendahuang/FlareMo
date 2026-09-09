import { expect, test } from "@playwright/test";
import { E2E_AUTH_STATE, E2E_EMAIL } from "./auth-fixture";

const TEST_PASSWORD =
  "flaremo-e2e-initial-password-never-use-in-production-2026";

// The auth guard preserves the deep-linked destination under `redirect`;
// signing in must return the user there instead of the timeline root.
test("returns a deep-linked visitor to their destination after sign-in", async ({
  page,
}) => {
  await page.context().clearCookies();

  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?redirect=%2Faccount$/);

  await page.getByRole("textbox", { name: /^邮箱$|^Email$/i }).fill(E2E_EMAIL);
  await page
    .getByRole("textbox", { name: /^密码$|^Password$/i })
    .fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^登录$|^Sign in$/i }).click();

  await expect(page).toHaveURL(/\/account$/);
  // auth-contract may have rotated the server-side session. Persist the
  // cookie created by this browser login so memo-ui never reads a stale state.
  await page.context().storageState({ path: E2E_AUTH_STATE });
});
