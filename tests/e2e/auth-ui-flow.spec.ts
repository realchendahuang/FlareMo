import { expect, test } from "@playwright/test";
import { E2E_AUTH_STATE } from "./auth-fixture";

const TEST_USERNAME = "e2e_owner";
const TEST_PASSWORD =
  "flaremo-e2e-initial-password-never-use-in-production-2026";

test("keeps setup one-time, logs in, and manages a PAT from the account UI", async ({
  page,
}) => {
  // This clears only the browser context. The shared storageState file and
  // its server-side session remain intact for the dependent memo project.
  await page.context().clearCookies();

  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login$/);

  const username = page.getByRole("textbox", {
    name: /用户名|Username/i,
  });
  const password = page.getByRole("textbox", {
    name: /^密码$|^Password$/i,
  });
  await username.fill(TEST_USERNAME);
  await password.fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^登录$|^Sign in$/i }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("textbox", { name: /新记录|New note/i }),
  ).toBeVisible();
  // auth-contract may have rotated the server-side session. Persist the
  // cookie created by this browser login so memo-ui never reads a stale state.
  await page.context().storageState({ path: E2E_AUTH_STATE });

  await page.goto("/account");
  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByRole("heading", { name: /账户与访问|Account/i }),
  ).toBeVisible();

  const tokenName = `UI E2E client ${Date.now()}`;
  await page
    .getByRole("textbox", { name: /令牌名称|Token name/i })
    .fill(tokenName);
  await page.getByPlaceholder(/永不过期|Never/i).fill("30");
  await page.getByRole("button", { name: /创建令牌|Create token/i }).click();

  await expect(page.locator("code")).toBeVisible();
  await expect(
    page.getByText(/请立即安全保存这个令牌|save this token/i),
  ).toBeVisible();
  await page.getByRole("button", { name: /关闭并隐藏|Hide/i }).click();
  await expect(page.locator("code")).toHaveCount(0);

  const revokeButton = page.getByRole("button", {
    name: /^撤销$|^Revoke$/i,
  });
  await expect(revokeButton).toHaveCount(1);
  await revokeButton.click();
  await expect(page.getByText(/^已撤销$|^Revoked$/i)).toBeVisible();
  await expect(page.getByText(tokenName, { exact: true })).toBeVisible();
});
