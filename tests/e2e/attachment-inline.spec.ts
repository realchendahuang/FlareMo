import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./auth-fixture";

const E2E_COOKIE_MUTATION_OPTIONS = {
  headers: { origin: E2E_BASE_URL },
};

/** A 1x1 transparent PNG; inline enough that no binary fixture is needed. */
function tinyPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
}

async function uploadPng(
  request: import("@playwright/test").APIRequestContext,
  filename: string,
) {
  const uploadResponse = await request.post("/api/v1/attachments", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    multipart: {
      file: { name: filename, mimeType: "image/png", buffer: tinyPng() },
    },
  });
  expect(uploadResponse.ok()).toBe(true);
  return (await uploadResponse.json()) as { id: string; filename: string };
}

async function bindAttachments(
  request: import("@playwright/test").APIRequestContext,
  memoId: string,
  ids: string[],
) {
  const bindResponse = await request.patch(
    `/api/v1/memos/${memoId}/attachments`,
    {
      // The legacy wire takes bare resource names; the modern one wants
      // objects with a name field and a body wrapper.
      headers: { origin: E2E_BASE_URL, "x-flaremo-wire": "legacy" },
      data: { attachments: ids.map((id) => `attachments/${id}`) },
    },
  );
  expect(bindResponse.ok()).toBe(true);
}

async function createMemo(
  request: import("@playwright/test").APIRequestContext,
  content: string,
) {
  const createResponse = await request.post("/api/app/memos", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { content },
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { name: string };
  return created.name.split("/").at(-1) as string;
}

test("renders inline body images and keeps the gallery for the rest", async ({
  page,
  request,
}) => {
  const inline = await uploadPng(request, "inline-alpha.png");
  const loose = await uploadPng(request, "loose-bravo.png");
  const marker = Date.now();
  const content = [
    "# Gallery memo",
    "![inline alpha](/file/attachments/" +
      inline.id +
      "/" +
      inline.filename +
      ")",
    "Some prose between the images.",
    `Marker ${marker}`,
  ].join("\n\n");

  const memoId = await createMemo(request, content);
  // Bind both uploads to the memo: the inline one plus a loose file for the gallery.
  await bindAttachments(request, memoId, [inline.id, loose.id]);
  await page.goto(`/memo/${memoId}`);

  // The body reference renders through the /file/ bridge with session auth.
  const bodyImage = page.locator(`img[src*="/file/attachments/${inline.id}/"]`);
  await expect(bodyImage).toBeVisible();
  await expect
    .poll(async () =>
      bodyImage.evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBeGreaterThan(0);

  // Dedup: the referenced attachment leaves the gallery, the loose one stays.
  // Gallery images are lightbox buttons named after the file.
  await expect(
    page.getByRole("button", { name: loose.filename }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: inline.filename })).toHaveCount(
    0,
  );
});

test("degrades a dead body image to a placeholder", async ({
  page,
  request,
}) => {
  const content = [
    "# Ghost memo",
    "![ghost screenshot](/file/attachments/00000000-0000-0000-0000-000000000000/missing.png)",
  ].join("\n\n");

  const memoId = await createMemo(request, content);
  await page.goto(`/memo/${memoId}`);
  await expect(page.locator(".memo-image-broken")).toBeVisible();
  await expect(page.locator(".memo-image-broken")).toContainText(
    "ghost screenshot",
  );
});

test("serves inline body images on the public share page", async ({
  browser,
  request,
}) => {
  const inline = await uploadPng(request, "shared-charlie.png");
  const content = [
    "# Shared gallery",
    "![shared image](/file/attachments/" +
      inline.id +
      "/" +
      inline.filename +
      ")",
  ].join("\n\n");
  const memoId = await createMemo(request, content);
  // Public reads validate that the attachment belongs to the shared memo.
  await bindAttachments(request, memoId, [inline.id]);

  const shareResponse = await request.post(`/api/v1/memos/${memoId}/shares`, {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: {},
  });
  expect(shareResponse.ok()).toBe(true);
  // The modern wire embeds the token in the share's resource name.
  const share = (await shareResponse.json()) as { name: string };
  const token = share.name.split("/shares/").at(-1) as string;

  const anonymous = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await anonymous.newPage();
  await page.goto(`/share/${token}`);

  const bodyImage = page.locator("img[src*='share_token=']");
  await expect(bodyImage).toBeVisible();
  await expect
    .poll(async () =>
      bodyImage.evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBeGreaterThan(0);
  await anonymous.close();
});

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/**
 * Pastes one PNG into the element matched by `selector` by constructing a real
 * ClipboardEvent in the page — Playwright's dispatchEvent drops the
 * clipboardData init property, so the event must be built here.
 */
async function pastePng(
  page: import("@playwright/test").Page,
  selector: string,
  filename: string,
) {
  return page.evaluate(
    ([sel, base64, name]) => {
      const element = document.querySelector(sel);
      if (!element) return false;
      const binary = atob(base64 as string);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(
        new File([bytes], name as string, { type: "image/png" }),
      );
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        }),
      );
      return true;
    },
    [selector, PNG_BASE64, filename],
  );
}

test("pasting an image into the composer inserts a reference and binds it on send", async ({
  page,
  request,
}) => {
  const marker = Date.now();
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /new note|新笔记/i });
  await expect(composer).toBeVisible();

  expect(
    await pastePng(page, "#flaremo-composer-input", "pasted-shot.png"),
  ).toBe(true);

  // The upload completes before the reference appears in the draft. The rich
  // editor renders the reference as an inline image node, not raw markdown
  // text, so assert on the rendered <img> instead of an input value.
  await expect(composer.locator("img[src*='/file/attachments/']")).toBeVisible({
    timeout: 15_000,
  });
  await composer.pressSequentially(` Marker ${marker}`);
  // Anchored match: the composer row also has a "Send target" dropdown
  // trigger next to the submit button (spaces feature).
  await page.getByRole("button", { name: /^(发送|Send)$/i }).click();
  await expect(composer).toHaveText("", { timeout: 15_000 });

  const listResponse = await request.get("/api/app/memos?page_size=50");
  const list = (await listResponse.json()) as {
    memos: { name: string; content: string }[];
  };
  const memo = list.memos.find((item) =>
    item.content.includes(`Marker ${marker}`),
  );
  expect(memo).toBeDefined();
  const memoId = (memo as { name: string }).name.split("/").at(-1) as string;

  // The send flow claimed the pre-uploaded attachment: the memo owns exactly
  // the pasted image, and the body renders it inline.
  const contextResponse = await request.get(`/api/app/memos/${memoId}`);
  const context = (await contextResponse.json()) as {
    attachments: { filename: string }[];
  };
  expect(context.attachments).toHaveLength(1);
  expect(context.attachments[0].filename).toBe("pasted-shot.png");

  await page.goto(`/memo/${memoId}`);
  await expect(page.locator("img[src*='/file/attachments/']")).toBeVisible();
});

test("pasting into the timeline editor uploads bound and saves inline", async ({
  page,
}) => {
  const marker = Date.now();
  const memoId = await createMemo(
    page.request,
    `Editor paste memo Marker ${marker}`,
  );
  await page.goto("/");
  const card = page.locator("article").filter({ hasText: `Marker ${marker}` });
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: /actions|操作/i }).click();
  await page.getByRole("menuitem", { name: /edit|编辑/i }).click();

  // The card editor is the same rich editor; its id distinguishes it from
  // the page composer.
  const editor = card.locator("#flaremo-card-editor-input");
  await editor.click();
  expect(
    await pastePng(page, "#flaremo-card-editor-input", "edited-shot.png"),
  ).toBe(true);
  await expect(editor.locator("img[src*='/file/attachments/']")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: /^(保存|Save)/ }).click();
  await page.goto(`/memo/${memoId}`);
  await expect(page.locator("img[src*='/file/attachments/']")).toBeVisible();
});
