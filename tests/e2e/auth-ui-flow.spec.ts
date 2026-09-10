import { expect, test } from "@playwright/test";
import { E2E_AUTH_STATE, E2E_EMAIL } from "./auth-fixture";

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

  const email = page.getByRole("textbox", { name: /^邮箱$|^Email$/i });
  const password = page.getByRole("textbox", {
    name: /^密码$|^Password$/i,
  });
  await email.fill(E2E_EMAIL);
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

  await page.getByRole("tab", { name: /访问令牌|Access tokens/i }).click();

  const tokenName = `UI E2E client ${Date.now()}`;
  // The create-token form lives in a dialog opened from the card header.
  await page
    .getByRole("button", { name: /创建令牌|Create token/i })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: /令牌名称|Token name/i })
    .fill(tokenName);
  await page.getByPlaceholder(/永不过期|Never/i).fill("30");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /创建令牌|Create token/i })
    .click();

  await expect(page.locator("code")).toBeVisible();
  await expect(
    page.getByText(/请立即安全保存这个令牌|save this token/i),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^关闭并隐藏$|^Hide token$/i })
    .click();
  await expect(page.locator("code")).toHaveCount(0);

  const revokeButton = page.getByRole("button", {
    name: /^撤销$|^Revoke$/i,
  });
  await expect(revokeButton).toHaveCount(1);
  await revokeButton.click();
  // Revoking asks for confirmation inside an AlertDialog.
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^撤销$|^Revoke$/i })
    .click();
  await expect(page.getByText(/^已撤销$|^Revoked$/i)).toBeVisible();
  await expect(page.getByText(tokenName, { exact: true })).toBeVisible();
});

test("adds a member through the admin dialog and shows the activation link", async ({
  page,
}) => {
  const memberName = `E2E Member ${Date.now()}`;
  await page.goto("/account");
  await page.getByRole("tab", { name: /团队管理|Team/ }).click();
  await expect(
    page.getByRole("button", { name: /添加成员|Add member/i }),
  ).toBeVisible();

  // The member form lives in a dialog opened from the team card header.
  await page
    .getByRole("button", { name: /添加成员|Add member/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: /显示名称|Display name/i })
    .fill(memberName);
  await dialog
    .getByRole("textbox", { name: /^邮箱$|^Email$/i })
    .fill(`e2e.member.${Date.now()}@example.test`);
  await dialog.getByRole("button", { name: /添加成员|Add member/i }).click();

  // Success shows the one-time activation link inside the dialog.
  await expect(dialog.getByText(/成员已创建|Member created/i)).toBeVisible();
  await expect(dialog.locator("code")).toBeVisible();
  await dialog
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: /^关闭$|^Close$/i })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(memberName)).toBeVisible();
});
