import { expect, test } from "@playwright/test";
import {
  E2E_BASE_URL,
  E2E_INITIAL_PASSWORD,
  E2E_USERNAME,
} from "./auth-fixture";

// Real browser microphone/AudioWorklet + real memo API. Only ASR transport is simulated.
test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

type CaptureBrowserOptions = {
  disableIndexedDb?: boolean;
  disableWorklet?: boolean;
  trackWakeLock?: boolean;
};

async function trackMicrophones(
  page: import("@playwright/test").Page,
  options: CaptureBrowserOptions = {},
) {
  await page.addInitScript((captureOptions) => {
    const real = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    const tracks: MediaStreamTrack[] = [];
    const worklets: string[] = [];
    const wakeLock = { releases: 0, requests: 0 };
    const NativeWorklet = window.AudioWorkletNode;
    if (captureOptions.disableWorklet) {
      Object.defineProperty(window, "AudioWorkletNode", {
        configurable: true,
        value: undefined,
      });
    } else {
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
    if (captureOptions.disableIndexedDb) {
      Object.defineProperty(indexedDB, "open", {
        configurable: true,
        value: () => {
          throw new DOMException("IndexedDB disabled", "InvalidStateError");
        },
      });
    }
    if (captureOptions.trackWakeLock) {
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: {
          request: async () => {
            wakeLock.requests += 1;
            let released = false;
            return {
              release: async () => {
                if (released) return;
                released = true;
                wakeLock.releases += 1;
              },
            };
          },
        },
      });
    }
    Object.assign(window, {
      captureTracks: tracks,
      captureWakeLock: wakeLock,
      captureWorklets: worklets,
    });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await real(constraints);
      tracks.push(...stream.getTracks());
      return stream;
    };
  }, options);
}
async function microphoneStates(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    (
      window as unknown as { captureTracks: MediaStreamTrack[] }
    ).captureTracks.map((track) => track.readyState),
  );
}
async function wakeLockState(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          captureWakeLock: { releases: number; requests: number };
        }
      ).captureWakeLock,
  );
}
async function enableCapture(
  page: import("@playwright/test").Page,
  text: string,
  options: CaptureBrowserOptions = {},
) {
  await trackMicrophones(page, options);
  await page.route("**/api/app/capture/status", (route) =>
    route.fulfill({
      json: { available: true, streaming: true, provider: "dashscope" },
    }),
  );
  let frames = 0;
  await page.routeWebSocket("**/api/app/capture/ws", (ws) => {
    ws.onMessage((message) => {
      if (typeof message !== "string") {
        frames++;
        return;
      }
      const event = JSON.parse(message);
      if (event.type === "start") {
        ws.send(JSON.stringify({ type: "ready" }));
        ws.send(
          JSON.stringify({
            type: "sentence",
            id: "one",
            text,
            final: true,
            receivedAt: Date.now(),
          }),
        );
      } else if (event.type === "ping")
        ws.send(JSON.stringify({ type: "pong" }));
      else if (event.type === "stop") {
        ws.send(
          JSON.stringify({
            type: "sentence",
            id: "last",
            text: "最后一句不能丢失",
            final: true,
            receivedAt: Date.now(),
          }),
        );
        ws.send(JSON.stringify({ type: "finished" }));
      }
    });
  });
  return () => frames;
}

test("captures PCM and saves a searchable, tagged, exportable timeline memo", async ({
  page,
}, testInfo) => {
  const unique = `capture-e2e-${Date.now()}`;
  const frameCount = await enableCapture(page, unique);
  await page.goto("/capture");
  await expect(
    page.getByRole("button", { name: /开始录音|Start recording/ }),
  ).toBeEnabled();
  expect(await microphoneStates(page)).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("capture-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /开始录音|Start recording/ }).click();
  await expect(page.getByRole("log")).toContainText(unique);
  await expect.poll(frameCount).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { captureWorklets: string[] }).captureWorklets,
    ),
  ).toEqual(["flaremo-pcm"]);
  await page.getByRole("button", { name: /停止录音|Stop recording/ }).click();
  const transcript = page.getByRole("textbox", {
    name: /逐字稿|Transcript/,
    exact: true,
  });
  await expect(transcript).toContainText("最后一句不能丢失");
  expect(await microphoneStates(page)).toEqual(["ended"]);
  await transcript.fill(`${unique} edited final sentence`);
  await page
    .getByRole("button", { name: /保存到 FlareMo|Save to FlareMo/ })
    .click();
  await expect(page).toHaveURL(/\/memo\//);
  await page.goto("/");
  const card = page.locator("article").filter({ hasText: unique });
  await expect(card).toBeVisible();
  await expect(card.getByText("#voice", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: /search|搜索/i })
    .fill("edited final sentence");
  await expect(card).toBeVisible();

  const response = await page.request.get(
    `/api/app/memos?q=${encodeURIComponent(unique)}&tag=voice`,
  );
  const result = await response.json();
  expect(result.memos).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        content: expect.stringContaining("edited final sentence"),
        payload: expect.objectContaining({
          tags: expect.arrayContaining(["voice"]),
        }),
        visibility: "private",
      }),
    ]),
  );
  const exported = await page.request.get("/api/v1/export");
  expect(exported.ok()).toBe(true);
  const bundle = await exported.json();
  expect(bundle.memos).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        content: expect.stringContaining(`${unique} edited final sentence`),
        source: "voice",
      }),
    ]),
  );
  await page.goto("/capture");
  await expect(
    page.getByRole("button", { name: /开始录音|Start recording/ }),
  ).toBeEnabled();
  expect(await microphoneStates(page)).toEqual([]);
});

test("keeps the latest edit after a committed create response is lost", async ({
  page,
}) => {
  const unique = `capture-uncertain-save-${Date.now()}`;
  await enableCapture(page, unique);
  await page.goto("/capture");
  await page.getByRole("button", { name: /开始录音|Start recording/ }).click();
  await expect(page.getByRole("log")).toContainText(unique);
  await page.getByRole("button", { name: /停止录音|Stop recording/ }).click();
  const transcript = page.getByRole("textbox", {
    name: /逐字稿|Transcript/,
    exact: true,
  });
  await transcript.fill(`${unique} before the lost response`);

  let createResponsesLost = 0;
  await page.route("**/api/app/memos", async (route) => {
    if (route.request().method() !== "POST" || createResponsesLost > 0) {
      await route.continue();
      return;
    }
    createResponsesLost += 1;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("connectionfailed");
  });

  await page
    .getByRole("button", { name: /保存到 FlareMo|Save to FlareMo/ })
    .click();
  await expect(page.getByRole("alert")).toContainText(/保存失败|Save failed/);
  await transcript.fill(`${unique} latest edit must survive`);
  await page
    .getByRole("button", { name: /保存到 FlareMo|Save to FlareMo/ })
    .click();
  await expect(page).toHaveURL(/\/memo\//);
  expect(createResponsesLost).toBe(1);

  const response = await page.request.get(
    `/api/app/memos?q=${encodeURIComponent(unique)}&tag=voice`,
  );
  const result = await response.json();
  const matching = result.memos.filter((memo: { content: string }) =>
    memo.content.includes(unique),
  );
  expect(matching).toHaveLength(1);
  expect(matching[0]).toMatchObject({
    content: expect.stringContaining("latest edit must survive"),
    visibility: "private",
  });
});

test("preserves the draft instead of overwriting a concurrently edited memo", async ({
  page,
}) => {
  const unique = `capture-save-conflict-${Date.now()}`;
  await enableCapture(page, unique);
  await page.goto("/capture");
  await page.getByRole("button", { name: /开始录音|Start recording/ }).click();
  await expect(page.getByRole("log")).toContainText(unique);
  await page.getByRole("button", { name: /停止录音|Stop recording/ }).click();
  const transcript = page.getByRole("textbox", {
    name: /逐字稿|Transcript/,
    exact: true,
  });
  await transcript.fill(`${unique} first submitted text`);

  let committedMemoId = "";
  await page.route("**/api/app/memos", async (route) => {
    if (route.request().method() !== "POST" || committedMemoId) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committedMemoId = (await response.json()).id;
    await route.abort("connectionfailed");
  });

  await page
    .getByRole("button", { name: /保存到 FlareMo|Save to FlareMo/ })
    .click();
  await expect(page.getByRole("alert")).toContainText(/保存失败|Save failed/);
  expect(committedMemoId).not.toBe("");

  const serverEdit = `${unique} changed from another tab`;
  const changed = await page.evaluate(
    async ({ content, memoId }) => {
      const response = await fetch(
        `/api/app/memos/${encodeURIComponent(memoId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      return { ok: response.ok, status: response.status };
    },
    { content: serverEdit, memoId: committedMemoId },
  );
  expect(changed).toEqual({ ok: true, status: 200 });
  const localEdit = `${unique} local draft must remain`;
  await transcript.fill(localEdit);
  await page
    .getByRole("button", { name: /保存到 FlareMo|Save to FlareMo/ })
    .click();

  await expect(page).toHaveURL(/\/capture$/);
  await expect(page.getByRole("alert")).toContainText(/保存失败|Save failed/);
  await expect(transcript).toHaveValue(localEdit);
  const memo = await page.request.get(
    `/api/app/memos/${encodeURIComponent(committedMemoId)}`,
  );
  expect(memo.ok()).toBe(true);
  expect((await memo.json()).memo.content).toBe(serverEdit);
});

test("keeps one microphone across reconnect and saves an explicit transcript gap", async ({
  page,
}) => {
  const unique = `capture-reconnect-${Date.now()}`;
  await trackMicrophones(page);
  await page.route("**/api/app/capture/status", (route) =>
    route.fulfill({
      json: { available: true, streaming: true, provider: "dashscope" },
    }),
  );
  let connections = 0;
  let firstConnectionClosed = false;
  await page.routeWebSocket("**/api/app/capture/ws", (ws) => {
    const connection = ++connections;
    ws.onMessage(async (message) => {
      if (typeof message !== "string") {
        if (connection === 1 && !firstConnectionClosed) {
          firstConnectionClosed = true;
          ws.send(
            JSON.stringify({
              type: "sentence",
              id: "before-gap",
              text: `${unique} 断线前`,
              final: true,
              receivedAt: Date.now(),
            }),
          );
          await ws.close({ code: 1012, reason: "network switch" });
        }
        return;
      }
      const event = JSON.parse(message);
      if (event.type === "start") {
        if (connection === 1) {
          ws.send(JSON.stringify({ type: "ready" }));
          return;
        }
        setTimeout(() => {
          ws.send(JSON.stringify({ type: "ready" }));
          ws.send(
            JSON.stringify({
              type: "sentence",
              id: "after-gap",
              text: "重新连接后继续识别",
              final: true,
              receivedAt: Date.now(),
            }),
          );
        }, 250);
      } else if (event.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      } else if (event.type === "stop") {
        ws.send(JSON.stringify({ type: "finished" }));
      }
    });
  });

  await page.goto("/capture");
  await page.getByRole("button", { name: /开始录音|Start recording/ }).click();
  await expect(page.getByRole("log")).toContainText(`${unique} 断线前`);
  await expect(
    page.getByRole("status").filter({
      hasText: /正在重新连接识别服务|reconnecting transcription/,
    }),
  ).toBeVisible();
  expect(await microphoneStates(page)).toEqual(["live"]);

  await expect(page.getByRole("log")).toContainText("重新连接后继续识别");
  await expect.poll(() => connections).toBe(2);
  expect(await microphoneStates(page)).toEqual(["live"]);
  await page.getByRole("button", { name: /停止录音|Stop recording/ }).click();

  const transcript = page.getByRole("textbox", {
    name: /逐字稿|Transcript/,
    exact: true,
  });
  await expect(transcript).toContainText(`${unique} 断线前`);
  await expect(transcript).toContainText("重新连接后继续识别");
  await expect(
    page.getByRole("status").filter({
      hasText:
        /连接中断期间的语音可能缺失|Speech during a connection interruption may be missing/,
    }),
  ).toBeVisible();
  expect(await microphoneStates(page)).toEqual(["ended"]);

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
        content: expect.stringMatching(
          /连接中断期间的语音可能缺失|Speech during a connection interruption may be missing/,
        ),
        visibility: "private",
      }),
    ]),
  );
});

test("holds a screen wake lock only while the microphone is active", async ({
  page,
}) => {
  await enableCapture(page, "wake-lock-capture", { trackWakeLock: true });
  await page.goto("/capture");
  expect(await wakeLockState(page)).toEqual({ releases: 0, requests: 0 });

  await page.getByRole("button", { name: /开始录音|Start recording/ }).click();
  await expect(page.getByRole("log")).toContainText("wake-lock-capture");
  await expect
    .poll(() => wakeLockState(page))
    .toEqual({
      releases: 0,
      requests: 1,
    });

  await page.getByRole("button", { name: /停止录音|Stop recording/ }).click();
  await expect(
    page.getByRole("textbox", { name: /逐字稿|Transcript/, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => wakeLockState(page))
    .toEqual({
      releases: 1,
      requests: 1,
    });
  expect(await microphoneStates(page)).toEqual(["ended"]);
});

test("restores edited text after reload without restarting the microphone on mobile", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enableCapture(page, "恢复测试的原始文字");
  await page.goto("/capture");
  await page.getByRole("button", { name: /开始录音|Start recording/ }).click();
  await expect(page.getByRole("log")).toContainText("恢复测试的原始文字");
  await page.getByRole("button", { name: /停止录音|Stop recording/ }).click();
  await page
    .getByRole("textbox", { name: /逐字稿|Transcript/, exact: true })
    .fill("修改后的恢复文字");
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("flaremo-local-memo-capture");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const values = await new Promise<{ content: string }[]>((resolve) => {
          const r = db.transaction("drafts").objectStore("drafts").getAll();
          r.onsuccess = () => resolve(r.result);
        });
        db.close();
        return values.some((value) =>
          value.content.includes("修改后的恢复文字"),
        );
      }),
    )
    .toBe(true);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: /恢复文字|Restore text/ }).click();
  await expect(
    page.getByRole("textbox", { name: /逐字稿|Transcript/, exact: true }),
  ).toHaveValue("修改后的恢复文字");
  expect(await microphoneStates(page)).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("capture-mobile-review.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /放弃记录|Discard capture/ }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /放弃记录|Discard capture/ })
    .click();
  await expect(
    page.getByRole("button", { name: /开始录音|Start recording/ }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /恢复文字|Restore text/ }),
  ).toHaveCount(0);
});

test("confirms navigation, releases the microphone and preserves captured text", async ({
  page,
}) => {
  const transcript = `leave-capture-${Date.now()}`;
  await enableCapture(page, transcript);
  await page.goto("/capture");
  await page.getByRole("button", { name: /开始录音|Start recording/ }).click();
  await expect(page.getByRole("log")).toContainText(transcript);

  await page.getByRole("link", { name: /返回|Back/ }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  expect(await microphoneStates(page)).toEqual(["live"]);
  await dialog
    .getByRole("button", { name: /继续录音|Continue recording/ })
    .click();
  await expect(page).toHaveURL(/\/capture$/);
  expect(await microphoneStates(page)).toEqual(["live"]);

  await page.getByRole("link", { name: /返回|Back/ }).click();
  await dialog
    .getByRole("button", { name: /停止并离开|Stop and leave/ })
    .click();
  await expect(page).toHaveURL(/\/$/);
  expect(await microphoneStates(page)).toEqual(["ended"]);

  await page.goto("/capture");
  await expect(
    page.getByRole("button", { name: /恢复文字|Restore text/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /恢复文字|Restore text/ }).click();
  await expect(
    page.getByRole("textbox", { name: /逐字稿|Transcript/, exact: true }),
  ).toContainText(transcript);
});

test("stops and releases the microphone when the page becomes hidden", async ({
  page,
}) => {
  const transcript = `background-capture-${Date.now()}`;
  await enableCapture(page, transcript);
  await page.goto("/capture");
  await page.getByRole("button", { name: /开始录音|Start recording/ }).click();
  await expect(page.getByRole("log")).toContainText(transcript);
  expect(await microphoneStates(page)).toEqual(["live"]);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  const review = page.getByRole("textbox", {
    name: /逐字稿|Transcript/,
    exact: true,
  });
  await expect(review).toContainText(transcript);
  await expect(review).toContainText("最后一句不能丢失");
  await expect(page.getByRole("alert")).toContainText(
    /录音已被中断|Recording was interrupted/,
  );
  expect(await microphoneStates(page)).toEqual(["ended"]);
});

test("releases the microphone when the authenticated session signs out", async ({
  page,
}) => {
  const login = await page
    .context()
    .request.post("/api/auth/sign-in/username", {
      data: {
        password: E2E_INITIAL_PASSWORD,
        username: E2E_USERNAME,
      },
      headers: { origin: E2E_BASE_URL },
    });
  expect(login.ok()).toBe(true);

  await enableCapture(page, `logout-capture-${Date.now()}`);
  await page.goto("/capture");
  await page.getByRole("button", { name: /开始录音|Start recording/ }).click();
  await expect(page.getByRole("status")).toContainText(/正在录音|Recording/);
  expect(await microphoneStates(page)).toEqual(["live"]);

  await page.evaluate(async () => {
    const response = await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error(`Sign out failed: ${response.status}`);
    const key = "better-auth.message";
    const newValue = JSON.stringify({
      event: "session",
      data: { trigger: "sign-out" },
      clientId: "capture-e2e",
      timestamp: Math.floor(Date.now() / 1000),
    });
    localStorage.setItem(key, newValue);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        newValue,
        storageArea: localStorage,
        url: location.href,
      }),
    );
  });

  await expect(page).toHaveURL(/\/login\?redirect=/);
  expect(await microphoneStates(page)).toEqual(["ended"]);
});

test("falls back to ScriptProcessor when AudioWorklet is unavailable", async ({
  page,
}) => {
  const frameCount = await enableCapture(page, "fallback transcript", {
    disableWorklet: true,
  });
  await page.goto("/capture");
  await page.getByRole("button", { name: /开始录音|Start recording/ }).click();
  await expect(page.getByRole("log")).toContainText("fallback transcript");
  await expect.poll(frameCount).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { captureWorklets: string[] }).captureWorklets,
    ),
  ).toEqual([]);

  await page.getByRole("button", { name: /停止录音|Stop recording/ }).click();
  await expect(
    page.getByRole("textbox", { name: /逐字稿|Transcript/, exact: true }),
  ).toContainText("最后一句不能丢失");
  expect(await microphoneStates(page)).toEqual(["ended"]);
});

test("saves successfully when IndexedDB is unavailable from the start", async ({
  page,
}) => {
  const transcript = `no-indexeddb-${Date.now()}`;
  await enableCapture(page, transcript, { disableIndexedDb: true });
  await page.goto("/capture");
  await page.getByRole("button", { name: /开始录音|Start recording/ }).click();
  await expect(page.getByRole("log")).toContainText(transcript);
  await expect(page.getByRole("alert")).toContainText(
    /本地草稿不可用|Local drafts are unavailable/,
  );

  await page.getByRole("button", { name: /停止录音|Stop recording/ }).click();
  await page
    .getByRole("button", { name: /保存到 FlareMo|Save to FlareMo/ })
    .click();
  await expect(page).toHaveURL(/\/memo\//);
  expect(await microphoneStates(page)).toEqual(["ended"]);

  const response = await page.request.get(
    `/api/app/memos?q=${encodeURIComponent(transcript)}&tag=voice`,
  );
  const result = await response.json();
  expect(result.memos).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        content: expect.stringContaining(transcript),
        visibility: "private",
      }),
    ]),
  );
});
