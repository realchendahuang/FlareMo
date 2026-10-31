import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./auth-fixture";
import { createMemoryViaComposer } from "./workspace-helpers";

test("creates a memory and locks it", async ({ page }) => {
  const content = `FlareMo 使用 D1 作为事实源 #mem${Date.now()}`;

  await page.goto("/memory");

  // Memories are filed through the page's inline quick composer, not a modal.
  // Create it as a preference rather than the default iron rule so the lock
  // step below has something to do — the iron-rule tier locks on creation.
  await createMemoryViaComposer(page, content, "preference");

  // The review/confirmed split is now a row of filter pills rather than tabs;
  // "全部" shows every tier, which is where a freshly composed memory lands.
  // The pill renders its label next to a count, so the accessible name reads
  // "全部 3" / "All 3" — match the label as a whole word, not the whole name.
  await page
    .getByRole("button", { name: /\b全部\b|\bAll\b/ })
    .first()
    .click();
  await expect(page.getByText(content)).toBeVisible();

  // Making it an iron rule ("设为铁律" / "Make iron rule") is one of the
  // card's overflow-menu actions; only locked memories carry the 铁律 badge.
  const card = page.locator("article").filter({ hasText: content });
  await card.getByRole("button", { name: /^Actions$|^操作$/i }).click();
  await page
    .getByRole("menuitem", { name: /Make iron rule|设为铁律/i })
    .first()
    .click();
  await expect(card.getByText(/^Iron rule$|^铁律$/)).toBeVisible();
});

test("shows the memory a proposal wants to replace in the review inbox", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const factKey = `e2e.deploy.${stamp}`;
  // A user-confirmed fact, then the same key from an agent: the agent write
  // cannot overwrite a human fact, so it lands in the inbox as a proposal.
  await request.post("/api/app/memory", {
    headers: { origin: E2E_BASE_URL },
    data: {
      content: `部署只走脚本 ${stamp}`,
      type: "semantic",
      kind: "decision",
      scope_type: "global",
      fact_key: factKey,
    },
  });
  const pat = await request.post("/api/app/account/personal-access-tokens", {
    headers: { origin: E2E_BASE_URL },
    data: { name: `e2e-memory-${stamp}`, expires_in_days: 1 },
  });
  expect(pat.status()).toBe(201);
  const { token } = (await pat.json()) as { token: string };
  await request.post("/memory/mcp", {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "memory_remember",
        arguments: {
          content: `部署改走 CI ${stamp}`,
          fact_key: factKey,
          scope_type: "global",
          source_agent: "e2e",
        },
      },
    },
  });

  await page.goto("/memory");
  await page.getByTestId("memory-review-notice").click();
  const card = page
    .locator("article")
    .filter({ hasText: `部署改走 CI ${stamp}` });
  await expect(card.getByText(`部署只走脚本 ${stamp}`)).toBeVisible();
  await card
    .getByRole("button", { name: /^保留原来的$|^Keep current$/ })
    .click();
  await expect(card).not.toBeVisible();
});

test("lists a memory created through the API", async ({ page, request }) => {
  const content = `API-created memory #api${Date.now()}`;
  await request.post("/api/app/memory", {
    headers: { origin: E2E_BASE_URL },
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
  await createMemoryViaComposer(page, content);

  // The pill renders its label next to a count, so the accessible name reads
  // "全部 3" / "All 3" — match the label as a whole word, not the whole name.
  await page
    .getByRole("button", { name: /\b全部\b|\bAll\b/ })
    .first()
    .click();
  await expect(page.getByText(content)).toBeVisible();

  // The edit action lives in the memory card's overflow menu. Scope to the
  // card holding this test's memory: a full-suite run has other memories on
  // the page, and an unscoped `.first()` opens the wrong card's menu.
  const card = page.locator("article").filter({ hasText: content });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /^edit$|^编辑$/i }).click();
  const editDialog = page.locator('[role="dialog"]:visible').last();
  await editDialog.locator("textarea").fill(updated);
  await editDialog.getByRole("button", { name: /save|保存/i }).click();

  await expect(page.getByText(updated)).toBeVisible();
  await expect(page.getByText(content)).not.toBeVisible();
});
