import { expect, test } from "@playwright/test";
import { E2E_AUTH_STATE, E2E_BASE_URL } from "./auth-fixture";

// Device pairing is a new authenticated route plus a settings section, so it
// carries an e2e case even though the gate stays opt-in (2026-09-16 policy:
// write the case, do not run it unless the maintainer asks). The case creates a
// real device authorization through the public endpoint, approves the pairing
// code in the browser, and revokes the app from settings.
test.describe.configure({ mode: "serial" });

const CLIENT_NAME = "E2E 配对客户端";

test("approves a pairing code and revokes the connected app", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: E2E_AUTH_STATE });
  const page = await context.newPage();

  const started = await page.request.post(`${E2E_BASE_URL}/connect/device`, {
    data: { client_name: CLIENT_NAME, client_type: "device" },
  });
  expect(started.ok()).toBe(true);
  const device = (await started.json()) as { user_code: string };
  expect(device.user_code).toHaveLength(8);

  await page.goto(
    `${E2E_BASE_URL}/connect?code=${encodeURIComponent(device.user_code)}`,
  );
  await expect(page.getByText(/批准配对|Approve pairing/).first()).toBeVisible();
  await page
    .getByRole("button", { name: /批准配对|Approve pairing/ })
    .first()
    .click();
  await expect(
    page.getByText(/配对已批准|Pairing approved/).first(),
  ).toBeVisible();
  await expect(page.getByText(CLIENT_NAME).first()).toBeVisible();

  await page.goto(`${E2E_BASE_URL}/account?section=connectedApps`);
  await expect(page.getByText(CLIENT_NAME).first()).toBeVisible();
  await page
    .getByRole("button", { name: /^撤销$|^Revoke$/ })
    .first()
    .click();
  // The confirm action lives in the alert dialog opened by the row button.
  await page
    .getByRole("button", { name: /^撤销$|^Revoke$/ })
    .last()
    .click();
  await expect(
    page.getByText(new RegExp(`已撤销「${CLIENT_NAME}」|Revoked`)),
  ).toBeVisible();
  await expect(page.getByText(CLIENT_NAME)).toHaveCount(0);

  await context.close();
});
