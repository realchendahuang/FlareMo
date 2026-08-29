import { expect, test } from "@playwright/test";

test("creates a memory and locks it", async ({ page }) => {
  const content = `FlareMo 使用 D1 作为事实源 #mem${Date.now()}`;

  await page.goto("/memory");

  await page.getByRole("button", { name: /add memory|添加记忆/i }).click();

  // The dialog's content textarea is identified by its placeholder so it
  // cannot be confused with the page-level search input.
  const dialog = page.getByRole("dialog");
  await dialog.locator("textarea").fill(content);
  await dialog.getByRole("button", { name: /save|保存/i }).click();

  // The memory starts confirmed, so it is a normal-tier memory and surfaces in
  // the Recent tab (Core only shows tier=core).
  await page.getByRole("tab", { name: /recent|最近/i }).click();
  await expect(page.getByText(content)).toBeVisible();

  // A user-created memory starts confirmed, so it offers "lock" but not
  // "confirm". Lock it and verify the verification badge flips to locked.
  await page
    .getByRole("button", { name: /lock|锁定/i })
    .first()
    .click();
  await expect(page.getByText(/locked|已锁定/i).first()).toBeVisible();
});

test("lists a memory created through the API", async ({ page, request }) => {
  const content = `API-created memory #api${Date.now()}`;
  await request.post("/api/app/memory", {
    headers: { origin: "http://127.0.0.1:18787" },
    data: {
      content,
      type: "semantic",
      kind: "decision",
      scope_type: "project",
      scope_key: "github:realchendahuang/FlareMo",
      tier: "core",
      importance: 90,
    },
  });

  await page.goto("/memory");
  await expect(page.getByText(content)).toBeVisible();
});

test("edits a memory from the memory card", async ({ page }) => {
  const content = `待编辑的记忆 #edit${Date.now()}`;
  const updated = `编辑后的记忆 #edit${Date.now()}`;

  await page.goto("/memory");
  await page.getByRole("button", { name: /add memory|添加记忆/i }).click();

  const dialog = page.getByRole("dialog");
  await dialog.locator("textarea").fill(content);
  await dialog.getByRole("button", { name: /save|保存/i }).click();

  await page.getByRole("tab", { name: /recent|最近/i }).click();
  await expect(page.getByText(content)).toBeVisible();

  // The edit action lives in the memory card's overflow menu.
  await page
    .getByRole("button", { name: /actions|操作/i })
    .first()
    .click();
  await page.getByRole("menuitem", { name: /^edit$|^编辑$/i }).click();
  const editDialog = page.getByRole("dialog");
  await editDialog.locator("textarea").fill(updated);
  await editDialog.getByRole("button", { name: /save|保存/i }).click();

  await expect(page.getByText(updated)).toBeVisible();
  await expect(page.getByText(content)).not.toBeVisible();
});
