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

test("restores an unfinished new-memo draft after a reload", async ({
  page,
}) => {
  const content = `Persistent draft #draft${Date.now()}`;

  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /new note|新笔记/i });
  await composer.fill(content);
  // The composer persists after a short debounce, including its client id.
  await page.waitForTimeout(800);

  await page.reload();
  await expect(
    page.getByRole("textbox", { name: /new note|新笔记/i }),
  ).toHaveValue(content);
  await expect(
    page.getByText(/restored.*draft|已恢复未完成的草稿/i),
  ).toBeVisible();
});

test("queues an offline note and saves it after connectivity returns", async ({
  page,
}) => {
  const content = `Queued offline note #offline${Date.now()}`;

  await page.goto("/");
  await page.context().setOffline(true);
  await page.getByRole("textbox", { name: /new note|新笔记/i }).fill(content);
  await page.getByRole("button", { name: /save|保存/i }).click();
  await expect(page.getByText(/offline|离线/i)).toBeVisible();

  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(content)).toBeVisible();
});

test("searches timeline and archived notes by default and supports archive syntax", async ({
  page,
}) => {
  const marker = Date.now();
  const timeline = `Timeline search marker ${marker}`;
  const archived = `Archived search marker ${marker}`;
  const timelineResponse = await page.request.post("/api/app/memos", {
    data: { content: timeline },
  });
  const archivedResponse = await page.request.post("/api/app/memos", {
    data: { content: archived },
  });
  expect(timelineResponse.ok()).toBe(true);
  expect(archivedResponse.ok()).toBe(true);
  const archivedMemo = (await archivedResponse.json()) as { id: string };
  const archiveResponse = await page.request.patch(
    `/api/app/memos/${archivedMemo.id}`,
    { data: { status: "archived" } },
  );
  expect(archiveResponse.ok()).toBe(true);

  await page.goto("/");
  await page
    .getByRole("navigation", { name: /navigation|导航/i })
    .getByRole("button", { name: /archive|归档/i })
    .click();
  const search = page.getByRole("textbox", { name: /search|搜索/i });
  await search.fill(`search marker ${marker}`);
  await expect(
    page.locator("article").filter({ hasText: timeline }),
  ).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: archived }),
  ).toBeVisible();
  await expect(page.getByTestId("memo-search-excerpt").first()).toContainText(
    "search marker",
  );

  await search.fill(`Archived search marker ${marker} in:archive`);
  await expect(
    page.locator("article").filter({ hasText: archived }),
  ).toBeVisible();
});

test("shows a memo submitted by an external agent in the timeline", async ({
  page,
}) => {
  const marker = `Agent ingestion ${Date.now()}`;
  const response = await page.request.post("/api/v1/memos", {
    data: {
      content: `${marker} #telegram`,
      source: "telegram",
      payload: {
        tags: ["telegram"],
        client_id: `telegram:${Date.now()}`,
      },
    },
  });
  expect(response.status()).toBe(201);

  await page.goto("/");
  await expect(
    page.getByText(`${marker} #telegram`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("#telegram", { exact: true })).toBeVisible();
});

test("keeps filters in the URL and opens a Markdown memo detail", async ({
  page,
}) => {
  const marker = `markdown${Date.now()}`;
  const response = await page.request.post("/api/app/memos", {
    data: {
      content: `# Markdown detail\n\n**${marker}**\n\n- [x] rendered`,
    },
  });
  expect(response.ok()).toBe(true);

  await page.goto("/");
  await page.getByRole("textbox", { name: /search|搜索/i }).fill(marker);
  await expect(page).toHaveURL(new RegExp(`q=${marker}`));
  const card = page.locator("article").filter({ hasText: marker });
  await expect(card.locator("strong")).toHaveText(marker);
  await card.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/memo\/[^/]+$/);
  await expect(
    page.getByRole("heading", { name: "Markdown detail" }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeChecked();
});

test("restores a memo revision without reloading the detail page", async ({
  page,
}) => {
  const marker = Date.now();
  const original = `Original revision ${marker}`;
  const updated = `Updated revision ${marker}`;
  const createResponse = await page.request.post("/api/app/memos", {
    data: { content: original },
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { name: string };
  const memoId = created.name.split("/").at(-1);
  expect(memoId).toBeTruthy();

  const updateResponse = await page.request.patch(`/api/app/memos/${memoId}`, {
    data: { content: updated },
  });
  expect(updateResponse.ok()).toBe(true);

  await page.goto(`/memo/${memoId}`);
  await page.getByRole("tab", { name: /history|历史/i }).click();
  await page
    .getByRole("button", { name: /restore|恢复此版本/i })
    .first()
    .click();
  await page.getByRole("tab", { name: /content|内容/i }).click();

  await expect(page.getByText(original, { exact: true })).toBeVisible();
  await expect(page.getByText(updated, { exact: true })).toHaveCount(0);
});

test("loads memo attachments without per-memo request waterfalls", async ({
  page,
}) => {
  let attachmentListRequests = 0;
  page.on("request", (request) => {
    if (/\/api\/v1\/memos\/[^/]+\/attachments/.test(request.url())) {
      attachmentListRequests += 1;
    }
  });

  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: /new note|新笔记/i }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");

  expect(attachmentListRequests).toBe(0);
});

test("keeps a composer draft when saving fails", async ({ page }) => {
  const content = `Resilient draft #draft${Date.now()}`;
  await page.route("**/api/app/memos", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "temporary create failure" },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /new note|新笔记/i });
  await composer.fill(content);
  await page.getByRole("button", { name: /save|保存/i }).click();

  await expect(page.getByText("temporary create failure")).toBeVisible();
  await expect(composer).toHaveValue(content);
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
  await card.getByRole("textbox").fill(updated);
  await card.getByRole("button", { name: /^save$|^保存$/i }).click();
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
  await page.getByRole("menuitem", { name: /trash|回收站/i }).click();
  await page
    .getByRole("navigation", { name: /navigation|导航/i })
    .getByRole("button", { name: /trash|回收站/i })
    .click();
  const deleteCard = page.locator("article").filter({ hasText: content });
  await deleteCard.getByRole("button", { name: /actions|操作/i }).click();
  await page
    .getByRole("menuitem", { name: /delete forever|彻底删除/i })
    .click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: /delete forever|彻底删除/i })
    .click();
  await expect(page.getByText(content)).not.toBeVisible();
});

test("loads notes beyond the first page", async ({ page }) => {
  const marker = `page${Date.now()}`;
  for (let index = 0; index < 32; index += 1) {
    const response = await page.request.post("/api/app/memos", {
      data: { content: `${marker}-${index}` },
    });
    expect(response.ok()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  await page.goto("/");
  await expect(page.getByText(`${marker}-0`, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /load more|加载更多/i }).click();
  await expect(page.getByText(`${marker}-0`, { exact: true })).toBeVisible();
});

test("shows the installed version and safe update fallback", async ({
  page,
}) => {
  await page.goto("/");

  const updateButton = page.getByRole("button", {
    name: /system update|系统更新/i,
  });
  await expect(updateButton).toBeVisible();
  await expect(updateButton).toContainText("v0.3.0");
  await updateButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("v0.3.0");
  await expect(
    dialog.getByRole("link", { name: /update guide|升级指南/i }),
  ).toHaveAttribute("href", /docs\/update\.md$/);
});

test("creates, follows, reads, and removes memo relations", async ({
  page,
}) => {
  const marker = Date.now();
  const sourceContent = `Relation source ${marker}`;
  const targetContent = `Relation target ${marker}`;
  const sourceResponse = await page.request.post("/api/app/memos", {
    data: { content: sourceContent },
  });
  const targetResponse = await page.request.post("/api/app/memos", {
    data: { content: targetContent },
  });
  expect(sourceResponse.ok()).toBe(true);
  expect(targetResponse.ok()).toBe(true);
  const source = (await sourceResponse.json()) as { id: string; name: string };
  const target = (await targetResponse.json()) as { id: string; name: string };

  await page.goto(`/memo/${source.id}`);
  await page.getByRole("tab", { name: /links|关联/i }).click();
  await page
    .getByRole("textbox", { name: /search note content|搜索记录内容/i })
    .fill(targetContent);
  await page.getByRole("button", { name: targetContent }).click();
  const outgoing = page.getByRole("heading", {
    name: /related notes|关联记录/i,
  });
  await expect(
    outgoing
      .locator("..")
      .getByRole("link", { name: new RegExp(targetContent) }),
  ).toBeVisible();

  await page.goto(`/memo/${target.id}`);
  await page.getByRole("tab", { name: /links|关联/i }).click();
  const backlinks = page.getByRole("heading", { name: /backlinks|反向链接/i });
  await expect(
    backlinks
      .locator("..")
      .getByRole("link", { name: new RegExp(sourceContent) }),
  ).toBeVisible();

  await page.goto(`/memo/${source.id}`);
  await page.getByRole("tab", { name: /links|关联/i }).click();
  await page.getByRole("button", { name: /Remove link|移除与/ }).click();
  await expect(page.getByText(targetContent, { exact: true })).toHaveCount(0);

  const contextResponse = await page.request.get(
    `/api/v1/${source.name}/relation-context`,
  );
  expect(contextResponse.ok()).toBe(true);
  expect(await contextResponse.json()).toMatchObject({ relations: [] });
});

test("keeps activity labels and the focused composer fully visible", async ({
  page,
}) => {
  await page.goto("/");

  const monthLabels = page.locator(
    '[data-testid="activity-heatmap"] + div span',
  );
  const visibleLabels = monthLabels.filter({ hasText: /\S/ });
  await expect(visibleLabels.first()).toBeVisible();
  for (const label of await visibleLabels.all()) {
    const style = await label.evaluate((element) => ({
      overflow: getComputedStyle(element).overflow,
      textOverflow: getComputedStyle(element).textOverflow,
    }));
    expect(style.overflow).toBe("visible");
    expect(style.textOverflow).not.toBe("ellipsis");
  }

  const composer = page.getByRole("textbox", { name: /new note|新笔记/i });
  const composerForm = page.locator("form").filter({ has: composer });
  await page.waitForTimeout(250);
  const topBeforeFocus = await composerForm.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await composer.focus();
  const header = page.locator("header").first();
  const geometry = await Promise.all([
    composerForm.evaluate((element) => element.getBoundingClientRect().top),
    header.evaluate((element) => element.getBoundingClientRect().bottom),
  ]);
  expect(geometry[0]).toBe(topBeforeFocus);
  expect(geometry[0]).toBeGreaterThan(geometry[1]);
});

test("keeps the mobile navigation usable", async ({ page }) => {
  for (let index = 0; index < 18; index += 1) {
    const response = await page.request.post("/api/app/memos", {
      data: {
        content: `Mobile overflow ${index} #mobile${index}`,
        payload: { tags: [`mobile${index}`] },
      },
    });
    expect(response.ok()).toBe(true);
  }

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
  const scroller = page.getByTestId("mobile-sidebar-scroll");
  const geometry = await scroller.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  expect(geometry.overflowY).toBe("auto");
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /export|导出/i }),
  ).toBeVisible();
});
