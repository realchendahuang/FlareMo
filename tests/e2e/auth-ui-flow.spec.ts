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

  // Dual-mode sign-in: this field takes an email or a username, so its
  // accessible name is the longer label, not the bare "邮箱".
  const email = page.getByRole("textbox", {
    name: /邮箱或用户名|Email or username/i,
  });
  // `getByLabel`, not `getByRole("textbox")`: the password field renders
  // `<input type="password">`, which has no implicit ARIA role, so a role
  // query can never match it.
  const password = page.getByLabel(/^密码$|^Password$/i);
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
    page.getByRole("heading", { name: /^设置$|^Settings$/i }),
  ).toBeVisible();

  const tokenName = `UI E2E client ${Date.now()}`;
  // The create-token form lives in a dialog opened from the tokens card
  // header. Personal access tokens have no pane of their own since the
  // settings consolidation merged them into the default "Account & Security"
  // pane, which is what /account opens on (the old "访问令牌" nav button and
  // its `settings.nav.tokens` key were left behind by that refactor).
  //
  // The settings panel is mounted once per responsive branch (mobile and
  // desktop), so every trigger and dialog inside it exists twice: the mobile
  // copy comes first in DOM order and is the invisible one at this viewport.
  // Filtering on visibility is therefore mandatory, and the reveal dialog
  // below is matched with CSS rather than `getByRole` because Radix marks the
  // ancestor dialog `aria-hidden` while a nested dialog is open, which removes
  // its subtree from the accessibility tree that role queries search.
  const createTokenButton = page
    .getByRole("button", { name: /创建令牌|Create token/i })
    .locator("visible=true")
    .first();
  await createTokenButton.scrollIntoViewIfNeeded();
  await createTokenButton.click();
  await page
    .getByRole("textbox", { name: /令牌名称|Token name/i })
    .fill(tokenName);
  await page.getByPlaceholder(/90|永不过期|Never/i).fill("30");
  await page
    .locator('[role="dialog"]:visible')
    .last()
    .getByRole("button", { name: /创建令牌|Create token/i })
    .click();

  const revealDialog = page.locator('[role="dialog"]:visible').last();
  await expect(revealDialog.locator("code")).toBeVisible();
  await expect(
    revealDialog.getByText(/请立即安全保存这个令牌|save this token/i),
  ).toBeVisible();
  await revealDialog
    .locator("button", { hasText: /关闭并隐藏|Hide token/ })
    .click();
  await expect(
    page.locator("code:visible"),
    "the one-time token must disappear once the reveal dialog is dismissed",
  ).toHaveCount(0);

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
  // Same double mount: the badge and the row render once per responsive
  // branch, and the invisible copy comes first in DOM order.
  await expect(
    page.getByText(/^已撤销$|^Revoked$/i).locator("visible=true"),
  ).not.toHaveCount(0);
  await expect(
    page.getByText(tokenName, { exact: true }).locator("visible=true"),
  ).toHaveCount(1);
});

test("adds a member through the admin dialog and shows the activation link", async ({
  page,
}) => {
  const memberName = `E2E Member ${Date.now()}`;
  const email = `e2e.member.${Date.now()}@example.test`;
  await page.goto("/account");
  await page.getByRole("button", { name: /团队管理|Team/ }).click();
  await expect(
    page.getByRole("button", { name: /添加成员|Add member/i }),
  ).toBeVisible();

  // The member form lives in a dialog opened from the team card header.
  // The settings modal itself is also a dialog, so scope to the topmost one.
  await page
    .getByRole("button", { name: /添加成员|Add member/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog").last();
  await dialog
    .getByRole("textbox", { name: /显示名称|Display name/i })
    .fill(memberName);
  await dialog.getByRole("textbox", { name: /^邮箱$|^Email$/i }).fill(email);
  await dialog.getByRole("button", { name: /添加成员|Add member/i }).click();

  // Success shows the one-time activation link inside the dialog.
  await expect(dialog.getByText(/成员已创建|Member created/i)).toBeVisible();
  await expect(dialog.locator("code")).toBeVisible();
  await dialog
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: /^关闭$|^Close$/i })
    .click();
  // Only the settings modal itself remains open.
  await expect(page.getByRole("dialog")).toHaveCount(1);

  // Read the header's count badge: it is the unambiguous "how many members
  // exist" reading, and the duplicate attempt below must leave it unchanged.
  // (The row's own text also appears in the workspace sidebar, so a bare
  // getByText(name) is ambiguous.)
  const memberCount = page
    .getByRole("heading", { name: /团队成员|Team members/i })
    .locator("xpath=following-sibling::span[1]");
  await expect(memberCount).toHaveText(/^\d+$/);
  const memberCountAfterCreate = await memberCount.textContent();

  // Re-adding the same address must name the real cause instead of failing
  // with a generic server error, and the member list must not grow a second
  // row for it.
  await page
    .getByRole("button", { name: /添加成员|Add member/i })
    .first()
    .click();
  const duplicateDialog = page.getByRole("dialog").last();
  await duplicateDialog
    .getByRole("textbox", { name: /显示名称|Display name/i })
    .fill(`${memberName} again`);
  await duplicateDialog
    .getByRole("textbox", { name: /^邮箱$|^Email$/i })
    .fill(email);
  await duplicateDialog
    .getByRole("button", { name: /添加成员|Add member/i })
    .click();
  await expect(
    duplicateDialog.getByText(/已被使用|already in use/i),
  ).toBeVisible();
  await duplicateDialog
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: /^取消$|^Cancel$/i })
    .click();
  // The rejected address added nothing: the roster is exactly as it was, so no
  // orphaned second row was created behind the error message.
  await expect(memberCount).toHaveText(memberCountAfterCreate ?? "");
});
