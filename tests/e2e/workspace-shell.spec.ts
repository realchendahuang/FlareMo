import { expect, test } from "@playwright/test";

// The workspace frame (sidebar + page column) is one persistent layout route.
// These cases pin the three things its refactor fixed: the sidebar survives
// navigation, its header shares the page header's baseline, and collapsing
// keeps the content column's width while the sidebar stays reachable.

test.use({ viewport: { width: 1280, height: 800 } });

const collapseName = /collapse sidebar|收起侧栏/i;
const expandName = /expand sidebar|展开侧栏/i;

async function openTimelineExpanded(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    // Start each case from the expanded state, once per test (not on the
    // reloads inside a case, which must observe the persisted choice).
    if (!sessionStorage.getItem("shell-e2e-init")) {
      sessionStorage.setItem("shell-e2e-init", "1");
      localStorage.setItem("flaremo.sidebar.collapsed", "0");
    }
  });
  await page.goto("/");
  await expect(page.locator("#flaremo-composer-input")).toBeVisible();
}

test("keeps one sidebar across navigation and aligns it with the page header", async ({
  page,
}) => {
  await openTimelineExpanded(page);
  const sidebar = page.locator("aside aside").first();
  await sidebar.evaluate((element) => {
    (window as unknown as { shellSidebar: Element }).shellSidebar = element;
  });
  const sidebarX = () =>
    sidebar.evaluate((element) => element.getBoundingClientRect().x);
  // Pinned to the leading edge: the timeline (640px column) and the to-do
  // board (1024px column) must not move it.
  const xOnTimeline = await sidebarX();
  await page
    .getByRole("navigation", { name: /navigation|导航/i })
    .getByRole("link", { name: /to-dos|待办/i })
    .click();
  await expect(page).toHaveURL(/\/projects/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Same DOM node: the sidebar was not unmounted by the route change.
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { shellSidebar: Element }).shellSidebar ===
        document.querySelector("aside aside"),
    ),
  ).toBe(true);
  expect(await sidebarX()).toBe(xOnTimeline);
  expect(xOnTimeline).toBe(0);

  const centers = await page.evaluate(() => {
    const center = (element: Element | null | undefined) => {
      const box = element?.getBoundingClientRect();
      return box ? box.y + box.height / 2 : Number.NaN;
    };
    const sidebarHeader = document.querySelector("aside aside > header");
    const pageHeader = [...document.querySelectorAll("header")].find(
      (header) => !header.closest("aside"),
    );
    return {
      account: center(sidebarHeader?.firstElementChild),
      title: center(pageHeader?.querySelector("h1")),
    };
  });
  expect(Math.abs(centers.account - centers.title)).toBeLessThanOrEqual(1);
});

test("collapses without resizing the content column and restores with the shortcut", async ({
  page,
}) => {
  await openTimelineExpanded(page);
  const composer = page.locator("form").filter({
    has: page.locator("#flaremo-composer-input"),
  });
  const widthBefore = await composer.evaluate(
    (element) => element.getBoundingClientRect().width,
  );

  await page.getByRole("button", { name: collapseName }).click();
  const expand = page.getByRole("button", { name: expandName });
  await expect(expand).toBeVisible();
  await expect(page.locator("aside").first()).toHaveAttribute("inert", "");
  await expect
    .poll(() =>
      composer.evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBe(widthBefore);

  // The choice persists across a reload.
  await page.reload();
  await expect(page.getByRole("button", { name: expandName })).toBeVisible();

  await page.locator("#flaremo-composer-input").blur();
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(page.getByRole("button", { name: collapseName })).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("flaremo.sidebar.collapsed"),
    ),
  ).toBe("0");
});

test("peeks the collapsed sidebar from the window edge and closes after navigating", async ({
  page,
}) => {
  await openTimelineExpanded(page);
  await page.getByRole("button", { name: collapseName }).click();
  const peek = page.getByTestId("sidebar-peek");
  await expect(peek).toHaveAttribute("inert", "");

  await page.mouse.move(640, 400);
  await page.mouse.move(1, 400);
  await expect(peek).not.toHaveAttribute("inert", "");
  await peek.getByRole("link", { name: /articles|文章/i }).click();
  await expect(page).toHaveURL(/\/articles/);
  await page.mouse.move(900, 400);
  await expect(peek).toHaveAttribute("inert", "");
});

test("expanding from an open peek hands it off without a second entrance", async ({
  page,
}) => {
  await openTimelineExpanded(page);
  await page.getByRole("button", { name: collapseName }).click();
  await page.mouse.move(640, 400);
  await page.mouse.move(1, 400);
  const peek = page.getByTestId("sidebar-peek");
  await expect(peek).not.toHaveAttribute("inert", "");
  await page.waitForTimeout(300);

  // Every frame of the expansion must show a fully opaque sidebar at the
  // leading edge: the pinned peek covers the docked column until it is in
  // place, then disappears without moving.
  const frames = await page.evaluate(async () => {
    const out: { x: number; opacity: number }[] = [];
    (
      document.querySelector(
        '[aria-label="展开侧栏"], [aria-label="Expand sidebar"]',
      ) as HTMLElement
    ).click();
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const peekPanel = document.querySelector(
          '[data-testid="sidebar-peek"]',
        );
        const docked = document.querySelector("aside > div");
        const visible =
          peekPanel && getComputedStyle(peekPanel).opacity !== "0"
            ? peekPanel
            : docked;
        if (visible) {
          out.push({
            x: Math.round(visible.getBoundingClientRect().x),
            opacity: Number(getComputedStyle(visible).opacity),
          });
        }
        if (performance.now() - start < 500) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return out;
  });
  expect(frames.length).toBeGreaterThan(5);
  for (const frame of frames) {
    expect(frame).toEqual({ x: 0, opacity: 1 });
  }
  await expect(peek).toHaveCount(0);
  await expect(page.getByRole("button", { name: collapseName })).toBeVisible();
});

test("keeps the toggle in one place and follows rapid repeated clicks", async ({
  page,
}) => {
  await openTimelineExpanded(page);
  const toggle = page.getByTestId("sidebar-toggle");
  const box = async () => {
    const rect = await toggle.boundingBox();
    return rect && { x: Math.round(rect.x), y: Math.round(rect.y) };
  };
  const expanded = await box();
  await toggle.click();
  await expect(page.getByRole("button", { name: expandName })).toBeVisible();
  expect(await box()).toEqual(expanded);

  // Click four times in a row without waiting for the animation: the button
  // never moves and the final state is the parity of the clicks.
  const positions = await page.evaluate(async () => {
    const button = document.querySelector(
      '[data-testid="sidebar-toggle"]',
    ) as HTMLElement;
    const seen = new Set<string>();
    for (let index = 0; index < 4; index += 1) {
      button.click();
      for (let frame = 0; frame < 4; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const rect = button.getBoundingClientRect();
        seen.add(`${Math.round(rect.x)},${Math.round(rect.y)}`);
      }
    }
    return [...seen];
  });
  expect(positions).toEqual([`${expanded?.x},${expanded?.y}`]);
  await expect(page.getByRole("button", { name: expandName })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("aside")
        .first()
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBe(0);
});
