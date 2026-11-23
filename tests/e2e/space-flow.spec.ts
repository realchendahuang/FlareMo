import type { MemoDto } from "@flaremo/contracts";
import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./auth-fixture";
import { startWithCleanClientState } from "./workspace-helpers";

// The personal/team split only shows once someone else holds a seat; the e2e
// owner is alone in the default team, so report a second member.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/app/me", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    if (body.team) body.team.member_count = 2;
    await route.fulfill({ response, json: body });
  });
});

function note(id: string, visibility: MemoDto["visibility"]): MemoDto {
  return {
    id,
    name: `memos/${id}`,
    creator: "users/local-owner",
    content: `Space note ${id}`,
    visibility,
    state: "normal",
    pinned: false,
    payload: {},
    create_time: "2026-09-01T00:00:00Z",
    update_time: "2026-09-01T00:00:00Z",
    display_time: "2026-09-01T00:00:00Z",
    attachments: [],
    can_manage: true,
  };
}

test("switching spaces scopes the timeline request and keeps the URL restorable", async ({
  page,
}) => {
  const requestedSpaces: string[] = [];
  await page.route("**/api/app/memos*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    requestedSpaces.push(params.get("space") ?? "all");
    const space = params.get("space");
    const memos =
      space === "team"
        ? [note("team-only", "protected")]
        : space === "personal"
          ? [note("personal-only", "private")]
          : [note("team-only", "protected"), note("personal-only", "private")];
    await route.fulfill({ json: { memos } });
  });
  await page.goto("/");
  // The mixed default is the pre-existing behavior: everything visible, no
  // space param on the wire.
  await expect(
    page.locator("article").filter({ hasText: "Space note team-only" }),
  ).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: "Space note personal-only" }),
  ).toBeVisible();
  expect(requestedSpaces.every((space) => space === "all")).toBe(true);

  // The space filter sits on the right of the timeline header.
  const scopeTrigger = page.getByRole("button", {
    name: /note scope|记录范围/i,
  });
  await scopeTrigger.click();
  await page.getByRole("menuitem", { name: /team space|团队空间/i }).click();
  await expect(
    page.locator("article").filter({ hasText: "Space note team-only" }),
  ).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: "Space note personal-only" }),
  ).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("space")).toBe("team");

  // Filters compose with the space instead of being cleared by it.
  await page.goto("/?space=team&q=team-only");
  await expect(
    page.locator("article").filter({ hasText: "Space note team-only" }),
  ).toBeVisible();

  await page.goto("/?space=personal");
  await expect(
    page.locator("article").filter({ hasText: "Space note personal-only" }),
  ).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: "Space note team-only" }),
  ).toHaveCount(0);

  await scopeTrigger.click();
  await page
    .getByRole("menuitem", { name: /^(all spaces|全部空间)$/i })
    .click();
  await expect(
    page.locator("article").filter({ hasText: "Space note team-only" }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.has("space")).toBe(false);
  expect(requestedSpaces.at(-1)).toBe("all");
});

test("a private capture in the team space only appears in its own timeline", async ({
  page,
}) => {
  // This case asserts the space-derived send target, so clear any send-target
  // preference a previous test remembered for the personal space — otherwise
  // that preference (correctly) wins over the team default and the optimistic
  // card never enters the team timeline.
  await startWithCleanClientState(page);
  // The composer's send target follows the active space, so a capture typed
  // in the team space travels as protected and the optimistic card may show
  // in the team timeline. This case pins the counterpart: when the wire
  // records the memo private (the server files private into the personal
  // corpus), the settle invalidation must move the card out of the team
  // timeline — no stale optimistic copy may stay behind.
  // Hold the POST open so the optimistic phase is observable. Without this the
  // mock answers in the same tick as the click, the settle invalidation lands
  // immediately, and the transient optimistic card is gone before Playwright's
  // first poll — the assertion would be racing rather than testing.
  let releasePost: (() => void) | undefined;
  const postHeld = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  await page.route("**/api/app/memos*", async (route) => {
    if (route.request().method() === "POST") {
      // The server files a private memo into the personal corpus even when
      // the composer's target was the team space; simulate a server that
      // corrects the visibility (defence-in-depth on the wire contract).
      const body = (await route.request().postDataJSON()) as {
        content: string;
        visibility: string;
      };
      await postHeld;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "corrected-private",
          name: "memos/corrected-private",
          creator: "users/local-owner",
          content: body.content,
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
    const params = new URL(route.request().url()).searchParams;
    const space = params.get("space");
    const memos =
      space === "team"
        ? [note("team-only", "protected")]
        : space === "personal"
          ? [note("personal-only", "private")]
          : [note("team-only", "protected"), note("personal-only", "private")];
    await route.fulfill({ json: { memos } });
  });

  const composer = page.getByRole("textbox", { name: /new note|新笔记/i });
  await page.goto("/?space=team");
  await expect(
    page.locator("article").filter({ hasText: "Space note team-only" }),
  ).toBeVisible();

  // The target follows the space context asynchronously; sending before it
  // settles files the note as personal and the optimistic card never enters
  // the team timeline.
  await expect(
    page.getByRole("button", { name: /send target|发送目标/i }),
  ).toContainText(/team|团队/i);
  await composer.fill("Private note typed in the team space");
  await page.getByRole("button", { name: /^(send|发送)$/i }).click();

  // The composer's target follows the active space (protected), so the
  // optimistic card legitimately appears in the team timeline while the POST
  // is still in flight…
  await expect(
    page.locator("article").filter({
      hasText: "Private note typed in the team space",
    }),
  ).toBeVisible();
  // …and once the server answers with a private visibility, the settle
  // invalidation drops it from the team timeline (the inbox shows it under
  // personal/all instead).
  releasePost?.();
  await expect(
    page.locator("article").filter({
      hasText: "Private note typed in the team space",
    }),
  ).toHaveCount(0);
});

test("the composer send target follows the active space", async ({ page }) => {
  const created: string[] = [];
  await page.route("**/api/app/memos*", async (route) => {
    if (route.request().method() === "POST") {
      const body = (await route.request().postDataJSON()) as {
        content: string;
        visibility: string;
      };
      created.push(`${body.content}|${body.visibility}`);
      await route.fulfill({
        status: 201,
        json: {
          id: "composed",
          name: "memos/composed",
          creator: "users/local-owner",
          content: body.content,
          visibility: body.visibility,
          state: "normal",
          pinned: false,
          payload: {},
          create_time: "2026-09-01T00:00:00Z",
          update_time: "2026-09-01T00:00:00Z",
          display_time: "2026-09-01T00:00:00Z",
          attachments: [],
          can_manage: true,
        },
      });
      return;
    }
    const params = new URL(route.request().url()).searchParams;
    const space = params.get("space");
    const memos =
      space === "team"
        ? [note("team-only", "protected")]
        : space === "personal"
          ? [note("personal-only", "private")]
          : [note("team-only", "protected"), note("personal-only", "private")];
    await route.fulfill({ json: { memos } });
  });

  const composer = page.getByRole("textbox", { name: /new note|新笔记/i });

  // Team space defaults the target to the team; personal space resets it.
  await page.goto("/?space=team");
  await expect(composer).toBeVisible();
  await expect(
    page.getByRole("button", { name: /send target|发送目标/i }),
  ).toHaveText(/team|团队/i);
  await composer.fill("Team-side note");
  await page.getByRole("button", { name: /^(send|发送)$/i }).click();
  await expect(composer).toHaveText("");
  expect(created).toEqual(["Team-side note|protected"]);

  await page.goto("/?space=personal");
  await expect(
    page.getByRole("button", { name: /send target|发送目标/i }),
  ).toHaveText(/personal|个人/i);
  await composer.fill("Personal-side note");
  await page.getByRole("button", { name: /^(send|发送)$/i }).click();
  await expect(composer).toHaveText("");
  expect(created).toEqual([
    "Team-side note|protected",
    "Personal-side note|private",
  ]);
});

test("a shared workspace comments on a card in place", async ({ page }) => {
  await startWithCleanClientState(page);
  const marker = `Inline thread ${Date.now()}`;
  await page.request.post("/api/app/memos", {
    headers: { origin: E2E_BASE_URL },
    data: { content: marker, visibility: "protected" },
  });
  await page.goto("/");
  const card = page.locator("article").filter({ hasText: marker });
  await expect(card).toBeVisible();
  await card.hover();
  await card.getByRole("button", { name: /^(comment|评论)$/i }).click();
  const reply = `Reply ${Date.now()}`;
  const box = card.getByRole("textbox", { name: /comment|评论/i });
  await box.fill(reply);
  await box.press("Enter");
  await expect(card.getByText(reply)).toBeVisible();
  await expect(
    card.getByRole("button", { name: /1 (comment|条评论)/i }),
  ).toBeVisible();
});
