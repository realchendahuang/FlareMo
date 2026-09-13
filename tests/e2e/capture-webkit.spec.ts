import { expect, test } from "@playwright/test";

test("completes the voice-note flow in mobile WebKit with a mock microphone", async ({
  page,
}) => {
  const unique = `capture-webkit-${Date.now()}`;
  await page.addInitScript(() => {
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    const tracks: MediaStreamTrack[] = [];
    const worklets: string[] = [];
    const NativeWorklet = window.AudioWorkletNode;
    if (NativeWorklet) {
      window.AudioWorkletNode = class extends NativeWorklet {
        constructor(
          context: BaseAudioContext,
          name: string,
          options?: AudioWorkletNodeOptions,
        ) {
          super(context, name, options);
          worklets.push(name);
        }
      };
    }
    Object.assign(window, {
      captureWebkitTracks: tracks,
      captureWebkitWorklets: worklets,
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        const stream = await nativeGetUserMedia(constraints);
        tracks.push(...stream.getTracks());
        return stream;
      },
    });
  });
  await page.route("**/api/app/capture/status", (route) =>
    route.fulfill({
      json: { available: true, streaming: true, provider: "dashscope" },
    }),
  );
  let frames = 0;
  let sentFirstSentence = false;
  await page.routeWebSocket("**/api/app/capture/ws", (ws) => {
    ws.onMessage((message) => {
      if (typeof message !== "string") {
        frames += 1;
        if (!sentFirstSentence) {
          sentFirstSentence = true;
          ws.send(
            JSON.stringify({
              type: "sentence",
              id: "webkit-first",
              text: `${unique} WebKit 实时文字`,
              final: true,
              receivedAt: Date.now(),
            }),
          );
        }
        return;
      }
      const event = JSON.parse(message);
      if (event.type === "start") {
        ws.send(JSON.stringify({ type: "ready" }));
      } else if (event.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      } else if (event.type === "stop") {
        ws.send(
          JSON.stringify({
            type: "sentence",
            id: "webkit-last",
            text: "WebKit 停止末句",
            final: true,
            receivedAt: Date.now(),
          }),
        );
        ws.send(JSON.stringify({ type: "finished" }));
      }
    });
  });

  await page.goto("/capture");
  expect(await trackStates(page)).toEqual([]);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: /开始录音|Start recording/ }).click();
  await expect(page.getByRole("log")).toContainText(
    `${unique} WebKit 实时文字`,
  );
  await expect.poll(() => frames).toBeGreaterThan(0);
  expect(await trackStates(page)).toEqual(["live"]);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { captureWebkitWorklets: string[] })
          .captureWebkitWorklets,
    ),
  ).toEqual(["flaremo-pcm"]);

  await page.getByRole("button", { name: /停止录音|Stop recording/ }).click();
  const transcript = page.getByRole("textbox", {
    name: /逐字稿|Transcript/,
    exact: true,
  });
  await expect(transcript).toContainText("WebKit 停止末句");
  expect(await trackStates(page)).toEqual(["ended"]);
  await expectNoHorizontalOverflow(page);

  await transcript.fill(`${unique} edited on mobile WebKit`);
  await page
    .getByRole("button", { name: /保存到 FlareMo|Save to FlareMo/ })
    .click();
  await expect(page).toHaveURL(/\/memo\//);
  const response = await page.request.get(
    `/api/app/memos?q=${encodeURIComponent(unique)}&tag=voice`,
  );
  const result = await response.json();
  expect(result.memos).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        content: expect.stringContaining("edited on mobile WebKit"),
        visibility: "private",
      }),
    ]),
  );
});

async function trackStates(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    (
      window as unknown as { captureWebkitTracks: MediaStreamTrack[] }
    ).captureWebkitTracks.map((track) => track.readyState),
  );
}

async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}
