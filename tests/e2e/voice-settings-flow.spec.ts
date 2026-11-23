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
    // The settings panel mounts once per responsive branch (mobile and
    // desktop), so every string inside it appears twice in the DOM. Scope all
    // visibility assertions to the rendered branch; `visible=true` is what
    // keeps strict mode satisfied.
    // The pane no longer draws its own heading; its first settings row is the
    // stable marker that the permission-gated content mounted.
    const voiceTitle = page
      .getByText(/Enable voice capture|启用语音记录/, { exact: true })
      .locator("visible=true");
    await expect(voiceTitle).toHaveCount(0);
    expect(settingsRequests).toBe(0);
    release();
    // Voice settings moved to their own settings pane; the pane entry only
    // appears once the viewer permission resolves.
    await page.getByRole("button", { name: /语音服务|Voice service/i }).click();
    await expect(voiceTitle).toBeVisible();
    // Credentials sit behind the "凭据" dialog; opening it proves the
    // fields are reachable and rendered as password inputs.
    await page
      .getByRole("button", { name: /^(凭据|Credentials)/i })
      .locator("visible=true")
      .first()
      .click();
    const credentialDialog = page.locator('[role="dialog"]:visible').last();
    const voiceSecret = credentialDialog.locator("#voice-secretKey");
    await expect(voiceSecret).toHaveAttribute("type", "password");
    await expect(voiceSecret).toHaveValue("");
    await credentialDialog
      .getByRole("button", { name: /取消|Cancel/i })
      .click();
    expect(settingsRequests).toBeGreaterThan(0);
    await voiceTitle.scrollIntoViewIfNeeded();
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
      page
        .getByText(/Voice recognition settings|语音识别设置/, { exact: true })
        .locator("visible=true"),
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
  // The enable switch sits on the pane itself, so flip it before the
  // credential dialog opens — while that dialog is up, Radix marks the pane
  // aria-hidden and role queries can no longer reach it.
  //
  // The Switch renders an unnamed `role="switch"` next to its label text
  // rather than a labelled control, so a `getByRole("switch", { name })` query
  // can never match; locate the row by its visible label and take the switch
  // inside it. `:visible` picks the rendered responsive branch.
  await page
    .locator("div")
    .filter({ hasText: /^Enable voice capture|^启用语音记录/ })
    .locator('[role="switch"]:visible')
    .first()
    .click();
  // The credential fields live behind the "凭据" dialog now; the pane
  // itself only shows the status rows.
  await page
    .getByRole("button", { name: /^(凭据|Credentials)/i })
    .locator("visible=true")
    .first()
    .click();
  const dialog = page.locator('[role="dialog"]:visible').last();
  // One id per responsive branch; `:visible` picks the rendered one.
  const secretKey = dialog.locator("#voice-secretKey");
  await expect(secretKey).toBeVisible();
  await dialog.locator("#voice-appId").fill("1234567890");
  await dialog.locator("#voice-secretId").fill("e2e-not-a-real-secret-id");
  await secretKey.fill("e2e-not-a-real-secret-key");
  await dialog
    .getByRole("button", { name: /^Save$|^保存$/, exact: true })
    .click();
  // Sonner renders toasts as an `aria-live="polite"` list, not `role="status"`,
  // so match the toast text itself.
  await expect(
    page
      .getByText(/Settings saved|配置已保存/)
      .locator("visible=true")
      .first(),
  ).toBeVisible();
  await expect(secretKey).toHaveValue("");
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
  // The destructive row is labelled "Clear voice configuration"; only the
  // confirm action inside the AlertDialog uses the "delete credentials"
  // wording.
  await page
    .getByRole("button", {
      name: /Clear voice configuration|清除语音配置/,
      exact: true,
    })
    .locator("visible=true")
    .first()
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", {
      name: /Delete credentials and disable|删除凭据并停用/,
      exact: true,
    })
    .click();
  await expect(
    page
      .getByText(/Credentials deleted|凭据已删除/)
      .locator("visible=true")
      .first(),
  ).toBeVisible();
  const disabled = await page.request.get("/api/app/capture/status");
  expect(await disabled.json()).toMatchObject({
    available: false,
    streaming: false,
    provider: null,
  });
});
