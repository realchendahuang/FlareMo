import { expect, test } from "@playwright/test";

test("creates a memory, confirms it, and locks it", async ({ page }) => {
  const content = `FlareMo 使用 D1 作为事实源 #mem${Date.now()}`;

  await page.goto("/memory");

  await page.getByRole("button", { name: /add memory|添加记忆/i }).click();
  const contentField = page.getByRole("textbox").first();
  await contentField.fill(content);
  await page.getByRole("button", { name: /save|保存/i }).click();

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
