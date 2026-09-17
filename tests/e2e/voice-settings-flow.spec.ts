import { expect, test } from "@playwright/test";

for (const mobile of [false, true]) {
  test(`voice settings wait for owner permission (${mobile ? "mobile" : "desktop"})`, async ({
    page,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    let release!: () => void;
    const permission = new Promise<void>((resolve) => {
      release = resolve;
    });
    let permissionRequests = 0;
    let settingsRequests = 0;
    await page.route("**/api/app/me", async (route) => {
      permissionRequests++;
      await permission;
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: {
          ...(await response.json()),
          is_instance_owner: true,
          role: "owner",
          can_manage_voice_service: true,
        },
      });
    });
    await page.route("**/api/app/voice-settings", async (route) => {
      settingsRequests++;
      await route.fulfill({
        json: {
          revision: null,
          enabled: false,
          source: "none",
          configured: false,
          provider: null,
          model: "",
          unreadable: false,
          previews: null,
          encrypted: false,
          canEncrypt: true,
        },
      });
    });
    await page.goto("/account");
    await expect.poll(() => permissionRequests).toBeGreaterThan(0);
    await expect(
      page.getByText(/Voice recognition settings|语音识别设置/, {
        exact: true,
      }),
    ).toHaveCount(0);
    expect(settingsRequests).toBe(0);
    release();
    // Voice settings moved to their own settings pane; the pane entry only
    // appears once the viewer permission resolves.
    await page.getByRole("button", { name: /语音服务|Voice service/i }).click();
    await expect(
      page.getByText(/Voice recognition settings|语音识别设置/, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("#voice-secretKey")).toHaveAttribute(
      "type",
      "password",
    );
    await expect(page.locator("#voice-secretKey")).toHaveValue("");
    expect(settingsRequests).toBeGreaterThan(0);
    await page
      .getByText(/Voice recognition settings|语音识别设置/, { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("voice-settings.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // A /me route callback may still be mid-fetch when the assertions pass;
    // ignore those stragglers so they cannot fail the next test.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
}

for (const role of ["member", "unavailable"]) {
  test(`voice settings stay hidden for ${role}`, async ({ page }) => {
    let permissionRequests = 0;
    let settingsRequests = 0;
    await page.route("**/api/app/me", async (route) => {
      permissionRequests++;
      if (role === "unavailable") {
        await route.fulfill({
          status: 503,
          json: { error: { message: "Unavailable" } },
        });
      } else {
        const response = await route.fetch();
        await route.fulfill({
          response,
          json: {
            ...(await response.json()),
            is_instance_owner: false,
            can_manage_voice_service: false,
            role,
          },
        });
      }
    });
    await page.route("**/api/app/voice-settings", async (route) => {
      settingsRequests++;
      await route.fulfill({ status: 403, json: {} });
    });
    await page.goto("/account");
    await expect.poll(() => permissionRequests).toBeGreaterThan(0);
    await expect(
      page.getByText(/Voice recognition settings|语音识别设置/, {
        exact: true,
      }),
    ).toHaveCount(0);
    expect(settingsRequests).toBe(0);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
}

test("owner saves encrypted credentials through the UI and disables capture", async ({
  page,
}) => {
  await page.goto("/account");
  await page.getByRole("button", { name: /语音服务|Voice service/i }).click();
  await expect(page.locator("#voice-secretKey")).toBeVisible();
  await page.locator("#voice-appId").fill("1234567890");
  await page.locator("#voice-secretId").fill("e2e-not-a-real-secret-id");
  await page.locator("#voice-secretKey").fill("e2e-not-a-real-secret-key");
  await page
    .getByRole("switch", { name: /Enable voice capture|启用语音记录/ })
    .click();
  await page
    .getByRole("button", { name: /Save settings|保存配置/, exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    /Settings saved|配置已保存/,
  );
  await expect(page.locator("#voice-secretKey")).toHaveValue("");
  const metadata = await page.request.get("/api/app/voice-settings");
  expect(await metadata.text()).not.toContain("e2e-not-a-real");
  const status = await page.request.get("/api/app/capture/status");
  // The status payload carries an extra `kind` discriminator; assert only the
  // fields this test cares about so unrelated API additions don't break it.
  expect(await status.json()).toMatchObject({
    available: true,
    streaming: true,
    provider: "tencent",
  });
  await page
    .getByRole("button", {
      name: /Delete credentials and disable|删除凭据并停用/,
      exact: true,
    })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", {
      name: /Delete credentials and disable|删除凭据并停用/,
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText(
    /Credentials deleted|凭据已删除/,
  );
  const disabled = await page.request.get("/api/app/capture/status");
  expect(await disabled.json()).toMatchObject({
    available: false,
    streaming: false,
    provider: null,
  });
});
