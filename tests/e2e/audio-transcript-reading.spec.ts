import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./auth-fixture";
import { searchTimeline } from "./workspace-helpers";

const E2E_COOKIE_MUTATION_OPTIONS = {
  headers: { origin: E2E_BASE_URL },
};

/**
 * A one-second silent WAV. Kept inline so the fixture needs no binary file on
 * disk; the player only needs metadata to mount.
 */
function silentWav(seconds = 1) {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

async function createTranscriptMemo(
  request: import("@playwright/test").APIRequestContext,
  content: string,
) {
  const createResponse = await request.post("/api/app/memos", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { content },
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { name: string };

  const uploadResponse = await request.post("/api/v1/attachments", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    multipart: {
      memo: created.name,
      file: {
        name: "interview.wav",
        mimeType: "audio/wav",
        buffer: silentWav(),
      },
    },
  });
  expect(uploadResponse.ok()).toBe(true);

  return created.name.split("/").at(-1) as string;
}

test("reads a transcript with a sticky player, timeline seek and outline", async ({
  page,
}) => {
  const marker = Date.now();
  const content = [
    "# Interview transcript",
    "",
    "## Opening",
    "",
    "[00:00:00] Welcome to the session.",
    "",
    "[00:00:01] The second cue is near the end of the clip.",
    "",
    "## Closing",
    "",
    "[00:00:02] Thanks for listening.",
    "",
    `Marker ${marker}`,
  ].join("\n");

  const memoId = await createTranscriptMemo(page.request, content);
  await page.goto(`/memo/${memoId}`);

  // The sticky transport replaces the inline audio element.
  const time = page.getByTestId("reading-time");
  await expect(time).toBeVisible();
  await expect(time).toContainText("/");

  // The outline is built from the headings and links to their anchors.
  const outline = page.getByRole("navigation", { name: /outline|目录/i });
  await expect(outline.getByRole("link", { name: "Opening" })).toBeVisible();

  // A timestamp cue seeks the player: clicking it moves the readout off 00:00.
  const cue = page.getByRole("button", { name: "00:00:02" });
  await expect(cue).toBeVisible();
  await cue.click();
  await expect(time).not.toHaveText(/^00:00 \//);
});

test("collapses a long note in the timeline and expands it on demand", async ({
  page,
}) => {
  const marker = Date.now();
  const paragraph = "A long transcript paragraph that keeps going. ";
  const content = `${paragraph.repeat(40)}\nMarker ${marker}`;

  await page.request.post("/api/app/memos", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { content },
  });

  await page.goto("/");
  await searchTimeline(page, `${marker}`);

  const card = page.locator("article").filter({ hasText: `Marker ${marker}` });
  await expect(card).toBeVisible();

  const expand = card.getByRole("button", { name: /show full text|展开全文/i });
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(
    card.getByRole("button", { name: /show less|收起/i }),
  ).toBeVisible();
});

const FILLER = Array.from(
  { length: 40 },
  (_, i) =>
    `Filler paragraph ${i} carries enough words to occupy vertical space while the transcript scrolls.`,
).join("\n\n");

test("keeps the sticky transport in view while the transcript scrolls", async ({
  page,
}) => {
  const marker = Date.now();
  const content = [
    "# Interview transcript",
    "## Opening",
    "[00:00:00] Welcome to the session.",
    FILLER,
    "## Closing",
    "[00:00:01] Thanks for listening.",
    `Marker ${marker}`,
  ].join("\n\n");

  const memoId = await createTranscriptMemo(page.request, content);
  await page.goto(`/memo/${memoId}`);
  const bar = page.getByTestId("reading-time");
  await expect(bar).toBeVisible();

  // The reading view renders inside the workspace shell, which owns the
  // scrollport (`h-svh overflow-hidden` + an inner `overflow-y-auto` main), so
  // the window itself never scrolls — `window.scrollTo` was a no-op and the
  // sticky bar could not reach the top. Scroll the real container instead.
  const scrolled = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return 0;
    main.scrollTop = 900;
    return main.scrollTop;
  });
  expect(scrolled).toBeGreaterThanOrEqual(900);
  await expect
    .poll(async () => (await bar.boundingBox())?.y ?? -1)
    .toBeGreaterThanOrEqual(0);
  const y = (await bar.boundingBox())?.y ?? -1;
  expect(y).toBeLessThan(100);
});

test("loads the audio so the player has real duration", async ({ page }) => {
  const content = [
    "# Interview transcript",
    "## Opening",
    "[00:00:00] Welcome.",
    "## Closing",
    "[00:00:01] Bye.",
  ].join("\n\n");

  const memoId = await createTranscriptMemo(page.request, content);
  await page.goto(`/memo/${memoId}`);
  await expect(page.getByTestId("reading-time")).toBeVisible();
  await page.waitForFunction(
    () => {
      const audio = document.querySelector("audio");
      return (
        audio !== null &&
        audio.readyState >= 1 &&
        Number.isFinite(audio.duration) &&
        audio.duration > 0
      );
    },
    undefined,
    { timeout: 15_000 },
  );
});

test("scrolls the active paragraph into view when following playback", async ({
  page,
}) => {
  const content = [
    "# Interview transcript",
    "## Opening",
    "[00:00:00] Welcome to the session.",
    FILLER,
    "## Closing",
    "[00:00:01] This final cue sits far below the first screen.",
    FILLER,
  ].join("\n\n");

  const memoId = await createTranscriptMemo(page.request, content);
  await page.goto(`/memo/${memoId}`);
  const cue = page.getByRole("button", { name: "00:00:01" });
  await expect(cue).toBeVisible();
  await cue.click();

  // Follow-on-seek must land the active paragraph around mid-viewport, not
  // merely where Playwright's click auto-scroll parked it.
  await page.waitForFunction(
    () => {
      const target = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent === "00:00:01",
      );
      const paragraph = target?.closest("p");
      if (!paragraph) return false;
      const rect = paragraph.getBoundingClientRect();
      return (
        rect.top >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.top + rect.height / 2 < window.innerHeight * 0.75
      );
    },
    undefined,
    { timeout: 10_000 },
  );
});

test("keeps the transcript readable on a phone", async ({
  browser,
  request,
}) => {
  const content = [
    "# Interview transcript",
    "## Opening",
    "[00:00:00] Welcome.",
    "## Closing",
    "[00:00:01] Bye.",
  ].join("\n\n");

  const memoId = await createTranscriptMemo(request, content);
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 800 },
  });
  await mobile.goto(`/memo/${memoId}`);
  await expect(mobile.getByTestId("reading-time")).toBeVisible();
  // The transcript body is a lazy content chunk; measuring before it mounts
  // yields an undefined width under a loaded suite.
  await expect(mobile.locator(".memo-markdown")).toBeVisible();
  await expect(mobile.getByText("Welcome.")).toBeVisible();

  const layout = await mobile.evaluate(() => {
    const body = document.querySelector(".memo-markdown");
    const trigger = Array.from(document.querySelectorAll("button")).find(
      (button) => /目录|Outline/i.test(button.textContent ?? ""),
    );
    return {
      bodyWidth: body?.getBoundingClientRect().width,
      bodyTop: body?.getBoundingClientRect().top,
      triggerBottom: trigger?.getBoundingClientRect().bottom,
      hasTrigger: trigger !== undefined,
    };
  });
  expect(layout.bodyWidth).toBeGreaterThan(250);
  expect(layout.hasTrigger).toBe(true);
  expect(layout.triggerBottom ?? 0).toBeLessThanOrEqual(layout.bodyTop ?? 0);
  await mobile.close();
});

test("serves the transcript audio on the public share page", async ({
  page,
  request,
}) => {
  const content = [
    "# Shared transcript",
    "## Opening",
    "[00:00:00] Hello.",
    "## Closing",
    "[00:00:01] Bye.",
  ].join("\n\n");

  const memoId = await createTranscriptMemo(request, content);
  const shareResponse = await request.post(`/api/v1/memos/${memoId}/shares`, {
    headers: { origin: E2E_BASE_URL },
    data: {},
  });
  expect(shareResponse.ok()).toBe(true);
  // The modern wire embeds the token in the share's resource name rather
  // than returning it as a field.
  const share = (await shareResponse.json()) as { name: string };
  const token = share.name.split("/shares/").at(-1) as string;

  await page.goto(`/share/${token}`);
  // /share/:token is the Worker's SSR page, not the SPA's reading view: it
  // renders a native <audio controls> element rather than the sticky
  // ReadingAudioBar, so there is no `reading-time` testid here. The element is
  // deliberately `preload="none"` (no media fetch until the visitor presses
  // play), so duration stays unset by design — assert the control exists and
  // that its source really serves the shared attachment.
  const audio = page.locator("audio");
  await expect(audio).toBeVisible();
  const src = await audio.getAttribute("src");
  expect(src).toMatch(
    /^\/api\/public\/shares\/[^/]+\/attachments\/[^/]+\/blob$/,
  );

  const blob = await request.get(src as string);
  expect(blob.ok()).toBe(true);
  expect(blob.headers()["content-type"]).toContain("audio/");
  expect((await blob.body()).byteLength).toBeGreaterThan(0);
});

test("seeds the player duration from the attachment payload", async ({
  page,
  request,
}) => {
  const marker = Date.now();
  const content = [
    "# Timed transcript",
    "## Opening",
    "[00:00:00] Welcome.",
    `Marker ${marker}`,
  ].join("\n\n");

  const createResponse = await request.post("/api/app/memos", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    data: { content },
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { name: string };
  const uploadResponse = await request.post("/api/v1/attachments", {
    ...E2E_COOKIE_MUTATION_OPTIONS,
    multipart: {
      memo: created.name,
      duration: "10",
      file: {
        name: "timed.wav",
        mimeType: "audio/wav",
        buffer: silentWav(10),
      },
    },
  });
  expect(uploadResponse.ok()).toBe(true);

  await page.goto(`/memo/${created.name.split("/").at(-1) as string}`);
  // The uploaded duration shows even before metadata loads; no 00:00 flash.
  await expect(page.getByTestId("reading-time")).toContainText("/ 00:10");
});
