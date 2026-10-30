import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./auth-fixture";
import { searchTimeline, startWithCleanClientState } from "./workspace-helpers";

const E2E_COOKIE_MUTATION_OPTIONS = {
  headers: { origin: E2E_BASE_URL },
};

const E2E_LEGACY_API_MUTATION_OPTIONS = {
  headers: { origin: E2E_BASE_URL, "x-flaremo-wire": "legacy" },
};

test("creates a memo and filters it by tag", async ({ page }) => {
  const tag = `e2e${Date.now()}`;
  const content = `Playwright memo #${tag}`;

  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /new note|新笔记/i });
  await expect(composer).toBeVisible();

  await composer.fill(content);
  await page.getByRole("button", { name: /^(save|保存|send|发送)$/i }).click();
  // Submission is done when the composer clears; the card and the composer
  // briefly both show the content while the optimistic insert lands. The
  // composer is a rich contenteditable, so emptiness reads as empty text.
  await expect(composer).toHaveText("");
  await expect(page.getByText(content)).toBeVisible();
  await expect(page.getByText(`#${tag}`, { exact: true })).toBeVisible();

  await searchTimeline(page, tag);
  // The card body and the highlighted search excerpt both contain the text, so
  // match the body paragraph specifically.
  await expect(page.getByText(content, { exact: true }).first()).toBeVisible();
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
  ).toHaveText(content);
  await expect(
    page.getByText(/restored.*draft|已恢复未完成的草稿/i),
  ).toBeVisible();
});

test("queues an offline note and saves it after connectivity returns", async ({
  page,
}) => {
  const content = `Queued offline note #offline${Date.now()}`;

  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /new note|新笔记/i });
  await expect(composer).toBeVisible();
  await page.context().setOffline(true);
  await composer.fill(content);
  await page.getByRole("button", { name: /^(save|保存|send|发送)$/i }).click();
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
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { content: timeline },
  });
  const archivedResponse = await page.request.post("/api/app/memos", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { content: archived },
  });
  expect(timelineResponse.ok()).toBe(true);
  expect(archivedResponse.ok()).toBe(true);
  const archivedMemo = (await archivedResponse.json()) as { id: string };
  const archiveResponse = await page.request.patch(
    `/api/app/memos/${archivedMemo.id}`,
    { ...E2E_COOKIE_MUTATION_OPTIONS, data: { status: "archived" } },
  );
  expect(archiveResponse.ok()).toBe(true);

  await page.goto("/");
  await page.getByRole("button", { name: /note scope|笔记范围/i }).click();
  await page.getByRole("menuitem", { name: /archive|归档/i }).click();
  await searchTimeline(page, `search marker ${marker}`);
  await expect(
    page.locator("article").filter({ hasText: timeline }),
  ).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: archived }),
  ).toBeVisible();
  // Short notes show every hit in their body; the excerpt is reserved for
  // matches hidden inside a collapsed long note.
  await expect(page.getByTestId("memo-search-excerpt")).toHaveCount(0);

  await searchTimeline(page, `Archived search marker ${marker} in:archive`);
  await expect(
    page.locator("article").filter({ hasText: archived }),
  ).toBeVisible();
});

test("shows a memo submitted by an external agent in the timeline", async ({
  page,
}) => {
  const marker = `Agent ingestion ${Date.now()}`;
  const response = await page.request.post("/api/v1/memos", {
    ...E2E_LEGACY_API_MUTATION_OPTIONS,
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
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: {
      content: `# Markdown detail\n\n**${marker}**\n\n- [x] rendered`,
    },
  });
  expect(response.ok()).toBe(true);

  await page.goto("/");
  await searchTimeline(page, marker);
  await expect(page).toHaveURL(new RegExp(`q=${marker}`));
  const card = page.locator("article").filter({ hasText: marker });
  await expect(card.locator("strong")).toHaveText(marker);
  await card.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/memo\/[^/]+$/);
  // The first heading doubles as the page title; assert the rendered body.
  await expect(
    page
      .getByRole("tabpanel")
      .getByRole("heading", { name: "Markdown detail" }),
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
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { content: original },
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { name: string };
  const memoId = created.name.split("/").at(-1);
  expect(memoId).toBeTruthy();

  const updateResponse = await page.request.patch(`/api/app/memos/${memoId}`, {
    ...E2E_COOKIE_MUTATION_OPTIONS,
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

  // Base UI keeps a closing tab panel in the DOM during its exit transition,
  // so scope assertions to the active panel instead of the whole page.
  const contentPanel = page.getByRole("tabpanel", { name: /content|内容/i });
  await expect(contentPanel.getByText(original, { exact: true })).toBeVisible();
  await expect(contentPanel.getByText(updated, { exact: true })).toHaveCount(0);
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
  await page.route("**/api/app/memos*", async (route) => {
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
  await page.getByRole("button", { name: /^(save|保存|send|发送)$/i }).click();

  await expect(page.getByText("temporary create failure")).toBeVisible();
  await expect(composer).toHaveText(content);
});

test("shows the new card optimistically before the create request answers", async ({
  page,
}) => {
  const content = `Optimistic landing #opt${Date.now()}`;
  // Clear drafts and the remembered send target from earlier tests: a leftover
  // draft replaces what this test types (Send stays disabled, no card is
  // created), and a remembered preference can file the memo into a corpus the
  // default timeline does not show.
  await startWithCleanClientState(page);
  // Hold the create response open: the card must already be on screen from
  // the optimistic prepend, not only after the server round-trip (this is
  // the memo-cache slot fix's behavior contract).
  let releaseCreate: (() => void) | undefined;
  const createAnswered = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  await page.route("**/api/app/memos*", async (route) => {
    if (route.request().method() === "POST") {
      await createAnswered;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "persisted",
          name: "memos/persisted",
          creator: "users/e2e_owner",
          content,
          visibility: "private",
          state: "normal",
          pinned: false,
          payload: {},
          create_time: "2026-09-01T00:00:00Z",
          update_time: "2026-09-01T00:00:00Z",
          display_time: "2026-09-01T00:00:00Z",
          attachments: [],
          can_manage: true,
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /new note|新笔记/i });
  // Wait for the composer to mount before typing: the draft restore is async,
  // and filling while it is still settling races the restore write-back.
  await expect(composer).toBeVisible();

  // Wait for the first timeline page to load before submitting. The optimistic
  // insert prepends into the existing `["memos"]` cache and deliberately skips
  // keys that have no data yet (`memo-cache.ts`, `|| !data`), so it never
  // fabricates a timeline that has not arrived. Submitting first produces no
  // optimistic card at all — and because this mock holds the POST open, the
  // card then cannot appear by any other route. That needs a slow first paint,
  // which is why it failed only in a full suite run and never in isolation.
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.querySelectorAll("main article").length),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  await composer.fill(content);
  await expect(composer).toHaveText(content);
  await page.getByRole("button", { name: /^(save|保存|send|发送)$/i }).click();

  // The optimistic insert lands without waiting for the network.
  await expect(
    page.locator("article").filter({ hasText: content }),
  ).toBeVisible();

  releaseCreate?.();
  await expect(composer).toHaveText("");
  // The card survives the settle: the invalidation swaps the optimistic id
  // for the persisted row instead of dropping the card.
  await expect(
    page.locator("article").filter({ hasText: content }),
  ).toBeVisible();
});

test("edits and shares a memo", async ({ page }) => {
  const stamp = Date.now();
  const content = `Lifecycle memo #life${stamp}`;
  const updated = `Updated lifecycle memo #life${stamp}`;

  await page.goto("/");
  await page.getByRole("textbox", { name: /new note|新笔记/i }).fill(content);
  await page.getByRole("button", { name: /^(save|保存|send|发送)$/i }).click();
  await expect(
    page.getByRole("textbox", { name: /new note|新笔记/i }),
  ).toHaveText("");
  await expect(
    page.locator("article").filter({ hasText: content }),
  ).toBeVisible();

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
  // Visibility is a single menu entry that opens the visibility dialog (it is
  // no longer a submenu), and choosing 全网公开 there provisions the share rule.
  // The resulting share URL is surfaced inside that dialog, not on the card.
  await updatedCard.getByRole("button", { name: /actions|操作/i }).click();
  await page
    .getByRole("menuitem", { name: /可见性与分享|Visibility & Sharing/i })
    .click();
  const visibilityDialog = page.locator('[role="dialog"]:visible').last();
  await visibilityDialog
    .getByRole("button", { name: /全网公开|Public web/i })
    .click();
  // The card flips to public; the share URL is rendered inside the dialog as a
  // read-only input's value, so reopen it and assert on that value.
  await expect(
    updatedCard.getByRole("button", { name: /Public web|全网公开/i }),
  ).toBeVisible();
  await updatedCard.getByRole("button", { name: /actions|操作/i }).click();
  await page
    .getByRole("menuitem", { name: /可见性与分享|Visibility & Sharing/i })
    .click();
  const publicDialog = page.locator('[role="dialog"]:visible').last();
  await expect(publicDialog.locator("input[readonly]")).toHaveValue(
    /\/share\//,
  );
  // Copying the link is an action inside this dialog now, not a card-menu
  // entry; assert it is offered and labelled.
  await expect(
    publicDialog.getByRole("button", { name: /copy link|复制链接/i }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
});

test("archives and restores a memo", async ({ page }) => {
  const content = `Status memo #keep${Date.now()}`;

  await page.goto("/");
  await page.getByRole("textbox", { name: /new note|新笔记/i }).fill(content);
  await page.getByRole("button", { name: /^(save|保存|send|发送)$/i }).click();
  await expect(
    page.getByRole("textbox", { name: /new note|新笔记/i }),
  ).toHaveText("");
  await expect(
    page.locator("article").filter({ hasText: content }),
  ).toBeVisible();

  const card = page.locator("article").filter({ hasText: content });
  await card.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /archive|归档/i }).click();
  await page.getByRole("button", { name: /note scope|笔记范围/i }).click();
  await page.getByRole("menuitem", { name: /archive|归档/i }).click();
  await expect(page.getByText(content)).toBeVisible();

  const archivedCard = page.locator("article").filter({ hasText: content });
  await archivedCard.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /timeline|时间线/i }).click();
  await page.getByRole("button", { name: /note scope|笔记范围/i }).click();
  await page.getByRole("menuitem", { name: /all|全部/i }).click();
  await expect(page.getByText(content)).toBeVisible();
});

test("trashes, restores, and hard-deletes a memo", async ({ page }) => {
  const content = `Delete memo #bin${Date.now()}`;

  await page.goto("/");
  await page.getByRole("textbox", { name: /new note|新笔记/i }).fill(content);
  await page.getByRole("button", { name: /^(save|保存|send|发送)$/i }).click();
  await expect(
    page.getByRole("textbox", { name: /new note|新笔记/i }),
  ).toHaveText("");
  await expect(
    page.locator("article").filter({ hasText: content }),
  ).toBeVisible();

  const card = page.locator("article").filter({ hasText: content });
  await card.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /trash|回收站/i }).click();
  await page.getByRole("button", { name: /note scope|笔记范围/i }).click();
  await page.getByRole("menuitem", { name: /trash|回收站/i }).click();
  await expect(page.getByText(content)).toBeVisible();

  const trashedCard = page.locator("article").filter({ hasText: content });
  await trashedCard.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /restore|恢复/i }).click();
  await page.getByRole("button", { name: /note scope|笔记范围/i }).click();
  await page.getByRole("menuitem", { name: /all|全部/i }).click();
  await expect(page.getByText(content)).toBeVisible();

  const finalCard = page.locator("article").filter({ hasText: content });
  await finalCard.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /trash|回收站/i }).click();
  await page.getByRole("button", { name: /note scope|笔记范围/i }).click();
  await page.getByRole("menuitem", { name: /trash|回收站/i }).click();
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
      ...E2E_COOKIE_MUTATION_OPTIONS,
      data: { content: `${marker}-${index}` },
    });
    expect(response.ok()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  await page.goto("/");
  await expect(page.getByText(`${marker}-0`, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /load more|加载更多/i }).click();
  // The timeline is virtualized: rows render as they scroll into view.
  await expect
    .poll(async () => {
      await page.mouse.wheel(0, 500);
      return page.getByText(`${marker}-0`, { exact: true }).count();
    })
    .toBeGreaterThan(0);
});

test("shows the installed version and safe update fallback", async ({
  page,
  request,
}) => {
  // Resolve the version from the same API the UI renders, so a release bump
  // does not silently break this UI contract check.
  const health = await (
    await request.get(`${E2E_BASE_URL}/api/app/health`)
  ).json<{ version: string }>();
  const version = `v${health.version}`;

  await page.route("https://api.github.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tag_name: version,
        name: version,
        published_at: "2026-09-14T00:00:00Z",
        html_url: `https://github.com/realchendahuang/FlareMo/releases/tag/${version}`,
      }),
    });
  });

  await page.goto("/");

  // The update check lives in the sidebar's user menu now; the dialog reports
  // the installed version and, when no newer release exists, offers no upgrade
  // action — only the release-notes link.
  await page
    .getByRole("button", { name: /FlareMo E2E Owner|E2E Owner/i })
    .first()
    .click();
  await page
    .getByRole("menuitem", { name: /check for updates|检查更新/i })
    .click();

  const dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(version);
  await expect(
    dialog.getByRole("link", { name: /update guide|升级指南/i }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("link", { name: /release notes|版本说明/i }),
  ).toBeVisible();
});

test("creates, follows, reads, and removes memo relations", async ({
  page,
}) => {
  const marker = Date.now();
  const sourceContent = `Relation source ${marker}`;
  const targetContent = `Relation target ${marker}`;
  const sourceResponse = await page.request.post("/api/app/memos", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { content: sourceContent },
  });
  const targetResponse = await page.request.post("/api/app/memos", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
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
    name: /references|引用了谁/i,
  });
  await expect(
    outgoing
      .locator("..")
      .getByRole("link", { name: new RegExp(targetContent) }),
  ).toBeVisible();

  // The review graph links the referenced note directly.
  const graph = page.getByRole("heading", { name: /graph|关系图/i });
  await expect(
    graph.locator("..").getByRole("link", { name: new RegExp(targetContent) }),
  ).toBeVisible();
  await graph
    .locator("..")
    .getByRole("link", { name: new RegExp(targetContent) })
    .click();
  await expect(page).toHaveURL(new RegExp(target.id));

  await page.goto(`/memo/${target.id}`);
  await page.getByRole("tab", { name: /links|关联/i }).click();
  // The referenced note sees the source under "referenced by".
  const backlinked = page
    .getByRole("heading", { name: /referenced by|被谁引用/i })
    .locator("..");
  await expect(
    backlinked.getByRole("link", { name: new RegExp(sourceContent) }),
  ).toBeVisible();

  // The related-notes panel ranks the directly linked note first, and the
  // relations tab keeps the link visible under "referenced by".
  await page.getByRole("tab", { name: /content|内容/i }).click();
  await expect(
    page
      .getByRole("heading", { name: /related notes|相关记录/i })
      .locator("..")
      .getByRole("link", { name: new RegExp(sourceContent) }),
  ).toBeVisible();

  await page.goto(`/memo/${source.id}`);
  await page.getByRole("tab", { name: /links|关联/i }).click();
  await page.getByRole("button", { name: /Remove link|移除与/ }).click();
  await expect(page.getByText(targetContent, { exact: true })).toHaveCount(0);

  const contextResponse = await page.request.get(
    `/api/v1/${source.name}/relation-context`,
    { headers: { "x-flaremo-wire": "legacy" } },
  );
  expect(contextResponse.ok()).toBe(true);
  expect(await contextResponse.json()).toMatchObject({ relations: [] });
});

test("keeps the focused composer clear of the sticky header", async ({
  page,
}) => {
  await page.goto("/");

  // The activity visualisation is a Year/Month/Week/Day dial now; the textual
  // month labels it used to render are gone (the year view is a dot-cluster
  // grid), so there is no label-overflow contract left to assert here. What
  // still matters is that focusing the composer never slides it under the
  // sticky header.
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
  // Flush against the header is fine; sliding underneath it is not.
  expect(geometry[0]).toBeGreaterThanOrEqual(geometry[1]);
});

test("keeps the mobile navigation usable", async ({ page }) => {
  test.slow();
  for (let index = 0; index < 6; index += 1) {
    const response = await page.request.post("/api/app/memos", {
      ...E2E_COOKIE_MUTATION_OPTIONS,
      data: {
        content: `Mobile overflow ${index} #mobile${index}`,
        payload: { tags: [`mobile${index}`] },
      },
    });
    expect(response.ok()).toBe(true);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  // Space scope and the low-frequency archive/trash views moved to the
  // header ScopeSwitcher; the sheet keeps navigation and tags.
  await page.getByRole("button", { name: /note scope|笔记范围/i }).click();
  await page.getByRole("menuitem", { name: /archive|归档/i }).click();
  await expect(page).toHaveURL(/view=archived/);

  await page
    .getByRole("button", { name: /toggle sidebar|切换侧边栏/i })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: /navigation|导航/i }),
  ).toBeVisible();
  const scroller = page.getByTestId("mobile-sidebar-scroll");
  await expect
    .poll(() =>
      scroller.evaluate((element) => ({
        overflowY: getComputedStyle(element).overflowY,
        scrollable: element.scrollHeight > element.clientHeight,
      })),
    )
    .toEqual({ overflowY: "auto", scrollable: true });
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /export|导出/i }),
  ).toBeVisible();
});
