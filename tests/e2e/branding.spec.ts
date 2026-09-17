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
  await ownerPage.getByRole("button", { name: /品牌外观|Branding/ }).click();
  await expect(
    ownerPage.getByRole("heading", { name: /品牌外观|Branding/ }).first(),
  ).toBeVisible();

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
  await expect(
    resetPage.getByRole("button", { name: /品牌外观|Branding/ }),
  ).toBeVisible({ timeout: 15_000 });
  await resetPage.getByRole("button", { name: /品牌外观|Branding/ }).click();
  await expect(
    resetPage.getByRole("heading", { name: /品牌外观|Branding/ }).first(),
  ).toBeVisible({ timeout: 15_000 });
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

test("the owner picks an accent preset and it applies across sessions", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext({
    storageState: E2E_AUTH_STATE,
  });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${E2E_BASE_URL}/account`);
  await ownerPage.getByRole("button", { name: /品牌外观|Branding/ }).click();
  const jadeSwatch = ownerPage.getByRole("button", {
    name: /翡翠|Jade/,
  });
  await jadeSwatch.click();
  // Instant-apply: the attribute lands before the PUT round-trip resolves.
  await expect(ownerPage.locator("html")).toHaveAttribute(
    "data-accent",
    "jade",
  );

  // Persisted server-side: a fresh anonymous context resolves the preset too.
  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto(`${E2E_BASE_URL}/login`);
  await expect(anonymousPage.locator("html")).toHaveAttribute(
    "data-accent",
    "jade",
  );
  await anonymousContext.close();

  // Reset so later specs and other suites observe the default accent.
  const resetContext = await browser.newContext({
    storageState: E2E_AUTH_STATE,
  });
  const resetPage = await resetContext.newPage();
  await resetPage.goto(`${E2E_BASE_URL}/account`);
  await resetPage.getByRole("button", { name: /品牌外观|Branding/ }).click();
  const flameSwatch = resetPage.getByRole("button", {
    name: /火焰|Flame/,
  });
  await flameSwatch.click();
  await expect(resetPage.locator("html")).not.toHaveAttribute(
    "data-accent",
    /.+/,
  );
  await resetContext.close();
  await ownerContext.close();
});

test("the owner derives a theme from a custom hex seed", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext({
    storageState: E2E_AUTH_STATE,
  });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${E2E_BASE_URL}/account`);
  await ownerPage.getByRole("button", { name: /品牌外观|Branding/ }).click();

  await ownerPage.getByRole("button", { name: /自定义|Custom/ }).click();
  const hexInput = ownerPage.getByLabel(/十六进制色值|Hex color value/);
  await hexInput.fill("#7c3aed");

  // Live preview: the custom attribute + an inline ramp variable land as
  // soon as the seed is valid.
  await expect(ownerPage.locator("html")).toHaveAttribute(
    "data-accent",
    "custom",
  );
  // Chromium <153 resolved the custom property to rgb(); newer builds hand
  // back the declared hex — both prove the ramp variable landed.
  await expect(ownerPage.locator("html")).toHaveCSS("--brand-500", /rgb|#/);

  // Debounced save flushes; a fresh anonymous context resolves custom too.
  await expect
    .poll(async () => {
      const state = await ownerPage.evaluate(() => ({
        accent: document.documentElement.dataset.accent,
        seed: document.documentElement.style.getPropertyValue("--brand-500"),
      }));
      return state;
    })
    .toBeDefined();
  await ownerPage.waitForTimeout(900);
  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto(`${E2E_BASE_URL}/login`);
  await expect(anonymousPage.locator("html")).toHaveAttribute(
    "data-accent",
    "custom",
  );
  await expect(anonymousPage.locator("html")).toHaveCSS("--brand-500", /rgb|#/);
  await anonymousContext.close();

  // Reset so later specs and other suites observe the default accent.
  const resetContext = await browser.newContext({
    storageState: E2E_AUTH_STATE,
  });
  const resetPage = await resetContext.newPage();
  await resetPage.goto(`${E2E_BASE_URL}/account`);
  await resetPage.getByRole("tab", { name: /品牌外观|Branding/ }).click();
  await resetPage.getByRole("button", { name: /火焰|Flame/ }).click();
  await expect(resetPage.locator("html")).not.toHaveAttribute(
    "data-accent",
    /.+/,
  );
  await expect(
    resetPage.locator("html").evaluate((html) => html.style.length),
  ).resolves.toBe(0);
  await resetContext.close();
  await ownerContext.close();
});

test("an already-open tab repaints when the owner changes the accent elsewhere", async ({
  browser,
}) => {
  // Branding resolves once per mount, so the tab that stays on the timeline
  // never refetches on its own. This pins the BroadcastChannel fan-out that
  // closed the "changed the theme and nothing happened" gap.
  // Both pages share one context on purpose: BroadcastChannel is per-browser
  // profile, and the bug reproduces between two tabs of the same browser.
  const context = await browser.newContext({
    storageState: E2E_AUTH_STATE,
  });
  const viewerPage = await context.newPage();
  await viewerPage.goto(`${E2E_BASE_URL}/`);
  await viewerPage.waitForLoadState("domcontentloaded");
  await expect(viewerPage.locator("html")).not.toHaveAttribute(
    "data-accent",
    /.+/,
  );

  const adminPage = await context.newPage();
  await adminPage.goto(`${E2E_BASE_URL}/account`);
  await adminPage.getByRole("button", { name: /品牌外观|Branding/ }).click();
  await adminPage.getByRole("button", { name: /翡翠|Jade/ }).click();

  // The untouched timeline tab picks the change up without a reload.
  await expect(viewerPage.locator("html")).toHaveAttribute(
    "data-accent",
    "jade",
    { timeout: 15_000 },
  );

  await adminPage.getByRole("button", { name: /火焰|Flame/ }).click();
  await expect(viewerPage.locator("html")).not.toHaveAttribute(
    "data-accent",
    /.+/,
    { timeout: 15_000 },
  );
  await context.close();
});
