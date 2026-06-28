import { expect, test } from "@playwright/test";

test("creates a memo and filters it by tag", async ({ page }) => {
  const tag = `e2e${Date.now()}`;
  const content = `Playwright memo #${tag}`;

  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /new note|新笔记/i });
  await expect(composer).toBeVisible();

  await composer.fill(content);
  await page.getByRole("button", { name: /save|保存/i }).click();

  await expect(page.getByText(content)).toBeVisible();
  await expect(page.getByText(`#${tag}`, { exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: /search|搜索/i }).fill(tag);
  await expect(page.getByText(content)).toBeVisible();
});

test("edits and shares a memo", async ({ page }) => {
  const stamp = Date.now();
  const content = `Lifecycle memo #life${stamp}`;
  const updated = `Updated lifecycle memo #life${stamp}`;

  await page.goto("/");
  await page.getByRole("textbox", { name: /new note|新笔记/i }).fill(content);
  await page.getByRole("button", { name: /save|保存/i }).click();
  await expect(page.getByText(content)).toBeVisible();

  const card = page.locator("article").filter({ hasText: content });
  await card.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /edit|编辑/i }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(updated);
  await page.getByRole("button", { name: /save|保存/i }).click();
  await expect(
    page.locator("article").filter({ hasText: updated }),
  ).toBeVisible();
  await expect(
    page
      .locator("article")
      .filter({ hasText: content })
      .filter({ hasNotText: updated }),
  ).toHaveCount(0);

  const updatedCard = page.locator("article").filter({ hasText: updated });
  await updatedCard.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /share|分享/i }).click();
  await expect(updatedCard.getByText(/\/share\//)).toBeVisible();
});

test("archives and restores a memo", async ({ page }) => {
  const content = `Status memo #keep${Date.now()}`;

  await page.goto("/");
  await page.getByRole("textbox", { name: /new note|新笔记/i }).fill(content);
  await page.getByRole("button", { name: /save|保存/i }).click();
  await expect(page.getByText(content)).toBeVisible();

  const card = page.locator("article").filter({ hasText: content });
  await card.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /archive|归档/i }).click();
  await page
    .getByRole("navigation", { name: /navigation|导航/i })
    .getByRole("button", { name: /archive|归档/i })
    .click();
  await expect(page.getByText(content)).toBeVisible();

  const archivedCard = page.locator("article").filter({ hasText: content });
  await archivedCard.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /timeline|时间线/i }).click();
  await page
    .getByRole("navigation", { name: /navigation|导航/i })
    .getByRole("button", { name: /timeline|时间线/i })
    .click();
  await expect(page.getByText(content)).toBeVisible();
});

test("trashes, restores, and hard-deletes a memo", async ({ page }) => {
  const content = `Delete memo #bin${Date.now()}`;

  await page.goto("/");
  await page.getByRole("textbox", { name: /new note|新笔记/i }).fill(content);
  await page.getByRole("button", { name: /save|保存/i }).click();
  await expect(page.getByText(content)).toBeVisible();

  const card = page.locator("article").filter({ hasText: content });
  await card.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /trash|回收站/i }).click();
  await page
    .getByRole("navigation", { name: /navigation|导航/i })
    .getByRole("button", { name: /trash|回收站/i })
    .click();
  await expect(page.getByText(content)).toBeVisible();

  const trashedCard = page.locator("article").filter({ hasText: content });
  await trashedCard.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /restore|恢复/i }).click();
  await page
    .getByRole("navigation", { name: /navigation|导航/i })
    .getByRole("button", { name: /timeline|时间线/i })
    .click();
  await expect(page.getByText(content)).toBeVisible();

  const finalCard = page.locator("article").filter({ hasText: content });
  await finalCard.getByRole("button", { name: /actions|操作/i }).click();
  await page
    .getByRole("menuitem", { name: /delete forever|彻底删除/i })
    .click();
  await expect(page.getByText(content)).not.toBeVisible();
});

test("keeps the mobile navigation usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page
    .getByRole("button", { name: /toggle sidebar|切换侧边栏/i })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: /navigation|导航/i }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", {
    name: /navigation|导航/i,
  });
  await expect(
    navigation.getByRole("button", { name: /archive|归档/i }),
  ).toBeVisible();
});
