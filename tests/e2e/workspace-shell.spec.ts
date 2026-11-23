import { expect, test } from "@playwright/test";

// The workspace frame follows flomo: [gutter | sidebar | resize handle |
// 640px column] centered as one group; ⌘\ hides the sidebar (a menu button in
// the page header shows it again); the handle resizes it between 216px and
// 312px; below 768px the sidebar is a drawer.

test.use({ viewport: { width: 1120, height: 725 } });

const showName = /expand sidebar|展开侧栏/i;

async function openTimeline(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    // Start each case expanded at the default width, once per test (reloads
    // inside a case must observe the persisted choice).
    if (!sessionStorage.getItem("shell-e2e-init")) {
      sessionStorage.setItem("shell-e2e-init", "1");
      localStorage.setItem("flaremo.sidebar.collapsed", "0");
      localStorage.removeItem("flaremo.sidebar.width");
    }
  });
  await page.goto("/");
  await expect(page.locator("#flaremo-composer-input")).toBeVisible();
}

const box = (page: import("@playwright/test").Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), width: Math.round(rect.width) };
    });

test("centers sidebar and column as one group and keeps it across pages", async ({
  page,
}) => {
  await openTimeline(page);
  // 1120 wide: (1120 - (10 + 312 + 8 + 640)) / 2 = 75, as on flomo.
  expect(await box(page, "aside")).toEqual({ x: 85, width: 312 });
  expect(await box(page, "main")).toEqual({ x: 405, width: 640 });

  const sidebar = page.locator("aside aside").first();
  await sidebar.evaluate((element) => {
    (window as unknown as { shellSidebar: Element }).shellSidebar = element;
  });
  await page
    .getByRole("navigation", { name: /navigation|导航/i })
    .getByRole("link", { name: /to-dos|待办/i })
    .click();
  await expect(page).toHaveURL(/\/projects/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { shellSidebar: Element }).shellSidebar ===
        document.querySelector("aside aside"),
    ),
  ).toBe(true);
  // The wide board grows to the right from the same left edge.
  expect(await box(page, "aside")).toEqual({ x: 85, width: 312 });
  expect((await box(page, "main")).x).toBe(405);

  const centers = await page.evaluate(() => {
    const center = (element: Element | null | undefined) => {
      const rect = element?.getBoundingClientRect();
      return rect ? rect.y + rect.height / 2 : Number.NaN;
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

test("hides with the shortcut, shows again from the toggle, and eases both ways", async ({
  page,
}) => {
  await openTimeline(page);
  await page.locator("#flaremo-composer-input").blur();
  await page.keyboard.press("ControlOrMeta+Backslash");
  const show = page.getByRole("button", { name: showName });
  await expect(show).toBeVisible();
  // Hidden: the 640px column alone is centered.
  await expect.poll(() => box(page, "main")).toEqual({ x: 240, width: 640 });
  await page.reload();
  await expect(page.getByRole("button", { name: showName })).toBeVisible();

  const frames = await page.evaluate(async () => {
    const aside = document.querySelector("aside") as HTMLElement;
    const widths: number[] = [];
    (
      document.querySelector('[data-testid="sidebar-toggle"]') as HTMLElement
    ).click();
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        widths.push(Math.round(aside.getBoundingClientRect().width));
        if (performance.now() - start < 500) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return widths;
  });
  // Grows through intermediate widths (an animation, not a jump) to 312.
  expect(frames.some((width) => width > 20 && width < 290)).toBe(true);
  expect(frames.at(-1)).toBe(312);
  for (let index = 1; index < frames.length; index += 1) {
    expect(frames[index]).toBeGreaterThanOrEqual(frames[index - 1] ?? 0);
  }
  await expect(
    page.getByRole("button", { name: /collapse sidebar|收起侧栏/i }),
  ).toBeVisible();
});

test("slides one toggle with the sidebar edge and reverses mid-animation", async ({
  page,
}) => {
  await openTimeline(page);
  const toggle = page.getByTestId("sidebar-toggle");
  const start = await toggle.boundingBox();
  const path = await page.evaluate(async () => {
    const button = () =>
      document.querySelector('[data-testid="sidebar-toggle"]') as HTMLElement;
    const xs: number[] = [];
    button().click();
    const begin = performance.now();
    let reversed = false;
    await new Promise<void>((resolve) => {
      const tick = () => {
        const elapsed = performance.now() - begin;
        if (!reversed && elapsed > 150) {
          reversed = true;
          button().click();
        }
        xs.push(Math.round(button().getBoundingClientRect().x));
        if (elapsed < 650) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return xs;
  });
  // Continuous travel: no frame-to-frame jump larger than a normal step.
  for (let index = 1; index < path.length; index += 1) {
    expect(Math.abs((path[index] ?? 0) - (path[index - 1] ?? 0))).toBeLessThan(
      40,
    );
  }
  // Reversed mid-way, so it ends back where it started, expanded.
  expect(path.at(-1)).toBe(Math.round(start?.x ?? Number.NaN));
  await expect(
    page.getByRole("button", { name: /collapse sidebar|收起侧栏/i }),
  ).toBeVisible();
});

test("resizes the sidebar between 216 and 312 px and remembers the width", async ({
  page,
}) => {
  await openTimeline(page);
  const handle = await page.getByTestId("sidebar-resizer").boundingBox();
  if (!handle) throw new Error("resize handle not rendered");
  const x = handle.x + handle.width / 2;
  await page.mouse.move(x, 300);
  await page.mouse.down();
  await page.mouse.move(x - 40, 300);
  expect((await box(page, "aside")).width).toBe(272);
  await page.mouse.move(x - 150, 300);
  expect((await box(page, "aside")).width).toBe(216);
  await page.mouse.up();
  await page.reload();
  await expect(page.locator("#flaremo-composer-input")).toBeVisible();
  expect((await box(page, "aside")).width).toBe(216);
});

test("uses the drawer below 768px", async ({ page }) => {
  await openTimeline(page);
  await page.setViewportSize({ width: 767, height: 725 });
  await expect(page.getByTestId("sidebar-resizer")).toBeHidden();
  await page
    .getByRole("button", { name: /toggle sidebar|切换侧边栏/i })
    .click();
  await expect(page.getByTestId("mobile-sidebar-scroll")).toBeVisible();
});

test("gives way to a narrowing window instantly: sidebar first, then the column", async ({
  page,
}) => {
  await openTimeline(page);
  const layout = async () => ({
    sidebar: (await box(page, "aside")).width,
    main: (await box(page, "main")).width,
  });
  // No transition on window resize: the new geometry must land within a
  // frame or two. A 300ms ceiling distinguishes that from the 400ms
  // show/hide transition without depending on React's commit timing.
  const expectLayout = (expected: { sidebar: number; main: number }) =>
    expect.poll(layout, { timeout: 300 }).toEqual(expected);
  await page.setViewportSize({ width: 900, height: 725 });
  await expectLayout({ sidebar: 242, main: 640 });
  await page.setViewportSize({ width: 800, height: 725 });
  await expectLayout({ sidebar: 216, main: 566 });
  await page.setViewportSize({ width: 1120, height: 725 });
  await expectLayout({ sidebar: 312, main: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
