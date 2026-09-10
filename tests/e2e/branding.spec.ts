import { expect, test } from "@playwright/test";
import { E2E_AUTH_STATE, E2E_BASE_URL } from "./auth-fixture";

// Branding is not routing/guard logic, but it changes what the sign-in page
// and the app shell render — the 2026-09-10 regression taught us that any
// first-screen render change deserves a first-screen test. These cases pin
// the anonymous brand resolution and the owner customization flow.
test.describe.configure({ mode: "serial" });

const CUSTOM_PRODUCT_NAME = "KOS 知识库";

test("anonymous visitors see the default FlareMo branding on the login page", async ({
  page,
}) => {
  await page.goto(`${E2E_BASE_URL}/login`);
  await expect(page.getByText("FlareMo").first()).toBeVisible();
});

test("the owner can customize the product name and it reaches the login page", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext({
    storageState: E2E_AUTH_STATE,
  });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${E2E_BASE_URL}/account`);
  const teamTab = ownerPage.getByRole("tab", { name: /团队管理|Team/ });
  await teamTab.click();
  await expect(teamTab).toHaveAttribute("aria-selected", "true");
  await ownerPage
    .getByText(/品牌外观|Branding/)
    .first()
    .waitFor();

  // The branding form lives in a dialog opened from the card header.
  await ownerPage
    .getByRole("button", { name: /^编辑$|^Edit$/ })
    .first()
    .click();
  const nameInput = ownerPage.getByLabel(/产品名称|Product name/);
  await nameInput.fill(CUSTOM_PRODUCT_NAME);
  await ownerPage
    .getByRole("button", { name: /^保存|^Save/ })
    .first()
    .click();
  await expect(
    ownerPage.getByText(/品牌设置已保存|Branding saved/),
  ).toBeVisible();
  await ownerContext.close();

  // A fresh anonymous context resolves the custom branding.
  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto(`${E2E_BASE_URL}/login`);
  await expect(
    anonymousPage.getByRole("complementary").getByText(CUSTOM_PRODUCT_NAME),
  ).toBeVisible();
  await anonymousContext.close();

  // Reset so later specs and other suites observe the default branding.
  const resetContext = await browser.newContext({
    storageState: E2E_AUTH_STATE,
  });
  const resetPage = await resetContext.newPage();
  await resetPage.goto(`${E2E_BASE_URL}/account`);
  const resetTab = resetPage.getByRole("tab", { name: /团队管理|Team/ });
  await resetTab.click();
  await expect(resetTab).toHaveAttribute("aria-selected", "true", {
    timeout: 15_000,
  });
  await resetPage
    .getByRole("button", { name: /^编辑$|^Edit$/ })
    .first()
    .click();
  await resetPage.getByLabel(/产品名称|Product name/).fill("");
  await resetPage
    .getByRole("button", { name: /^保存|^Save/ })
    .first()
    .click();
  await expect(
    resetPage.getByText(/品牌设置已保存|Branding saved/),
  ).toBeVisible();
  await resetContext.close();
});
