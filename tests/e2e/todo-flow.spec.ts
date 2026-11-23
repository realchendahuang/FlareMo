import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./auth-fixture";

const E2E_COOKIE_MUTATION_OPTIONS = {
  headers: { origin: E2E_BASE_URL },
};

function localDay(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("the today view deep link lists what is due today", async ({ page }) => {
  const title = `今天交稿 ${Date.now()}`;
  const later = `下周再说 ${Date.now()}`;
  await page.request.post("/api/app/tasks", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { title, due_at: localDay() },
  });
  await page.request.post("/api/app/tasks", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { title: later, due_at: localDay(3) },
  });

  await page.goto("/projects?view=today");
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText(later)).toHaveCount(0);

  await page.goto("/projects?view=upcoming");
  await expect(page.getByText(later)).toBeVisible();
});

test("a ticked memo line completes the task it scheduled", async ({ page }) => {
  const line = `写周报 ${Date.now()}`;
  const memoResponse = await page.request.post("/api/app/memos", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { content: `- [ ] ${line}`, visibility: "private" },
  });
  const memo = (await memoResponse.json()) as { name: string; id: string };
  await page.request.post("/api/app/tasks", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { title: line, due_at: localDay(), source_memo_id: memo.name },
  });

  // The timeline card advertises the scheduled to-do.
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /待办 0\/1|To-dos 0\/1/ }),
  ).toBeVisible();

  await page.request.patch(`/api/app/memos/${memo.id}`, {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { content: `- [x] ${line}`, visibility: "private" },
  });
  const tasks = await page.request.get(
    `/api/app/tasks?source_memo_id=${encodeURIComponent(memo.name)}`,
  );
  const body = (await tasks.json()) as { tasks: { status: string }[] };
  expect(body.tasks[0]?.status).toBe("done");
});

test("date views and the project picker combine in one column", async ({
  page,
}) => {
  const name = `Picker project ${Date.now()}`;
  const project = await page.request.post("/api/app/projects", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { name },
  });
  const { project: created } = (await project.json()) as {
    project: { id: string };
  };
  const inside = `项目里今天的事 ${Date.now()}`;
  const outside = `别处今天的事 ${Date.now()}`;
  await page.request.post("/api/app/tasks", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { title: inside, due_at: localDay(), project_id: created.id },
  });
  await page.request.post("/api/app/tasks", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { title: outside, due_at: localDay() },
  });

  await page.goto("/projects");
  await page.getByRole("tab", { name: /^(今天|Today)/ }).click();
  await expect(page.getByText(outside)).toBeVisible();

  await page.getByRole("button", { name: /选择项目|Choose a project/ }).click();
  await page.getByRole("menuitem", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(/view=today/);
  await expect(page).toHaveURL(/project=/);
  await expect(page.getByText(inside)).toBeVisible();
  await expect(page.getByText(outside)).toHaveCount(0);
});
