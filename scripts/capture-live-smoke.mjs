#!/usr/bin/env node

import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, request } from "@playwright/test";
import { parse } from "dotenv";
import { Miniflare, NoOpLog } from "miniflare";
import WebSocket from "ws";
import { PcmEncoder } from "../apps/web/src/lib/audio-capture/pcm.ts";
import { applyFlaremoMigrations } from "../packages/db/src/test-migrations.ts";
import {
  CAPTURE_LIVE_SMOKE_USAGE,
  parseCaptureLiveSmokeArguments,
} from "./lib/capture-smoke-options.mjs";
import { scoreTranscript } from "./lib/transcript-accuracy.mjs";
import { buildWorkerBundle } from "./lib/worker-bundle.mjs";

const INPUT_SAMPLE_RATE = 48_000;
const OUTPUT_SAMPLE_RATE = 16_000;
const DEFAULT_MAX_DURATION_SECONDS = 120;
const LONG_MAX_SESSION_SECONDS = 60 * 60;
const BROWSER_LEADING_SILENCE_SECONDS = 3;
const BROWSER_TRAILING_SILENCE_SECONDS = 10;
const MAX_BUFFERED_BYTES = 64_000;
const READY_TIMEOUT_MS = 35_000;
const FINISH_TIMEOUT_MS = 20_000;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASR_BINDING_NAMES = [
  "FLAREMO_ASR_PROVIDER",
  "FLAREMO_ASR_MODEL",
  "FLAREMO_ASR_DASHSCOPE_API_KEY",
  "FLAREMO_ASR_TENCENT_APP_ID",
  "FLAREMO_ASR_TENCENT_HOTWORD_ID",
  "FLAREMO_ASR_TENCENT_HOTWORD_LIST",
  "FLAREMO_ASR_TENCENT_SECRET_ID",
  "FLAREMO_ASR_TENCENT_SECRET_KEY",
];

process.chdir(repoRoot);

let options;
try {
  options = parseCaptureLiveSmokeArguments(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid arguments.");
  console.error(CAPTURE_LIVE_SMOKE_USAGE);
  process.exitCode = 2;
}
if (!options) {
  if (process.exitCode === undefined) {
    console.error(CAPTURE_LIVE_SMOKE_USAGE);
    process.exitCode = 2;
  }
} else {
  await run(options).catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Capture live smoke failed.",
    );
    process.exitCode = 1;
  });
}

async function run({
  inputPath: path,
  browserMode: useBrowser,
  allowLong: allowLongFixture,
  referencePath,
  maxCer,
}) {
  const maxDurationSeconds = allowLongFixture
    ? LONG_MAX_SESSION_SECONDS -
      (useBrowser ? BROWSER_LEADING_SILENCE_SECONDS : 0)
    : DEFAULT_MAX_DURATION_SECONDS;
  const input = useBrowser
    ? await inspectInput(path, maxDurationSeconds)
    : await encodeInput(path, maxDurationSeconds);
  const reference = referencePath
    ? await loadReferenceTranscript(referencePath)
    : undefined;
  reportPhase("input checked");
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const bundleDir = resolve(".wrangler", `capture-live-smoke-${process.pid}`);
  const bootstrapSecret = randomBytes(32).toString("base64url");
  const authSecret = randomBytes(32).toString("base64url");
  const suffix = randomBytes(6).toString("hex");
  const username = `capturelive${suffix}`;
  const email = `${username}@example.test`;
  const password = randomBytes(48).toString("base64url");
  const bindings = {
    ...(await loadAsrBindings()),
    BETTER_AUTH_SECRET: authSecret,
    FLAREMO_BOOTSTRAP_SECRET: bootstrapSecret,
    FLAREMO_EMBEDDING_PROVIDER: "none",
    FLAREMO_PUBLIC_URL: baseUrl,
    FLAREMO_TRUSTED_ORIGINS: `${baseUrl},http://127.0.0.1`,
  };

  let runtime;
  let api;
  let browser;
  let browserWebSocketConnections;
  let wavePath;
  let serverLogTail = "";
  try {
    await rm(bundleDir, { force: true, recursive: true });
    await prepareWorkerBundle(bundleDir);
    const collectServerLog = (chunk) => {
      serverLogTail = `${serverLogTail}${String(chunk)}`.slice(-8_000);
    };
    runtime = new Miniflare({
      assets: {
        assetConfig: {
          compatibility_date: "2026-07-10",
          compatibility_flags: ["nodejs_compat"],
          not_found_handling: "single-page-application",
        },
        binding: "ASSETS",
        directory: resolve("apps/web/dist"),
        routerConfig: {
          has_user_worker: true,
          invoke_user_worker_ahead_of_assets: true,
        },
      },
      bindings,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: `capture-live-smoke-${randomUUID()}` },
      handleRuntimeStdio(stdout, stderr) {
        stdout.on("data", collectServerLog);
        stderr.on("data", collectServerLog);
      },
      host: "127.0.0.1",
      log: new NoOpLog(),
      modules: [{ path: resolve(bundleDir, "index.js"), type: "ESModule" }],
      port,
      queueProducers: {
        DATA_EXPORT_QUEUE: `capture-live-export-${suffix}`,
        MEMBER_REMOVAL_QUEUE: `capture-live-removal-${suffix}`,
      },
      r2Buckets: { ATTACHMENTS: `capture-live-attachments-${suffix}` },
    });
    const readyUrl = await runtime.ready;
    if (readyUrl.origin !== baseUrl)
      throw new Error("The isolated FlareMo runtime used an unexpected URL.");
    await applyFlaremoMigrations(await runtime.getD1Database("DB"));
    reportPhase("isolated runtime ready");

    api = await request.newContext({ baseURL: baseUrl });
    const bootstrapStatus = await requireJson(
      await api.get("/api/auth/flaremo/bootstrap/status"),
      "bootstrap readiness",
    );
    if (
      bootstrapStatus.initialized ||
      bootstrapStatus.state !== "ready" ||
      !bootstrapStatus.setup_available
    ) {
      throw new Error(
        "The isolated FlareMo database was not ready to bootstrap.",
      );
    }

    await requireJson(
      await api.post("/api/auth/flaremo/bootstrap", {
        data: { email, name: "Capture live smoke", password },
        headers: {
          origin: baseUrl,
          "x-flaremo-bootstrap-secret": bootstrapSecret,
        },
      }),
      "isolated account bootstrap",
      201,
    );
    await requireJson(
      await api.post("/api/auth/sign-in/username", {
        data: { password, username },
        headers: { origin: baseUrl },
      }),
      "isolated account login",
    );
    reportPhase("isolated account ready");

    const status = await requireJson(
      await api.get("/api/app/capture/status"),
      "Capture status",
    );
    if (!status.available || !status.streaming || !status.provider) {
      throw new Error(
        "Capture ASR is unavailable. Check the ignored .dev.vars provider configuration.",
      );
    }

    const storageState = await api.storageState();
    const cookie = cookieHeader(storageState.cookies, baseUrl);
    if (!cookie)
      throw new Error("The isolated login did not create a session cookie.");
    let transcript;
    let saved;
    if (useBrowser) {
      wavePath = resolve(
        tmpdir(),
        `flaremo-capture-live-smoke-${process.pid}-${suffix}.wav`,
      );
      await createWaveFixture(path, wavePath, input.sampleCount);
      reportPhase("browser audio fixture ready");
      browser = await chromium.launch({
        args: [
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          `--use-file-for-fake-audio-capture=${wavePath}`,
        ],
      });
      reportPhase("browser launched");
      const browserResult = await transcribeInBrowser(
        browser,
        baseUrl,
        storageState,
        input.durationSeconds,
      );
      reportPhase("browser capture and save completed");
      transcript = browserResult.transcript;
      saved = browserResult.saved;
      browserWebSocketConnections = browserResult.webSocketConnections;
    } else {
      transcript = await transcribe(baseUrl, cookie, input.frames);
    }
    if (!transcript.text) {
      throw new Error(
        "The ASR provider finished without a finalized transcript.",
      );
    }

    if (!saved) {
      const marker = `capture-live-smoke-${randomUUID()}`;
      saved = await saveAndSearch(api, baseUrl, transcript.text, marker);
    } else {
      saved = await findSavedMemo(
        api,
        saved.marker,
        transcript.text,
        saved.memoId,
      );
    }
    const accuracy = reference
      ? scoreTranscript(reference, transcript.text)
      : undefined;
    const result = {
      duration_seconds: Number(transcript.durationSeconds.toFixed(2)),
      final_sentences: transcript.finalSentences,
      fixture_seconds: Number(input.durationSeconds.toFixed(2)),
      frames: useBrowser ? undefined : input.frames.length,
      audio_worklet: useBrowser ? true : undefined,
      websocket_connections: browserWebSocketConnections,
      memo_id: saved.memoId,
      pipeline: useBrowser ? "browser" : "direct",
      provider: status.provider,
      searchable: true,
      sentence_latency_samples: transcript.latency?.samples,
      sentence_latency_p95_ms: transcript.latency?.p95Ms,
      sentence_latency_max_ms: transcript.latency?.maxMs,
      sentence_latency_target_met:
        transcript.latency === undefined
          ? undefined
          : transcript.latency.maxMs < 10_000,
      transcript_characters: transcript.text.length,
      transcript:
        input.durationSeconds <= DEFAULT_MAX_DURATION_SECONDS
          ? transcript.text
          : undefined,
      transcript_preview:
        input.durationSeconds > DEFAULT_MAX_DURATION_SECONDS
          ? `${transcript.text.slice(0, 240)}${transcript.text.length > 240 ? "..." : ""}`
          : undefined,
      accuracy_reference_characters: accuracy?.referenceCharacters,
      accuracy_hypothesis_characters: accuracy?.hypothesisCharacters,
      accuracy_character_edits: accuracy?.characterEdits,
      accuracy_cer:
        accuracy === undefined
          ? undefined
          : Number(accuracy.characterErrorRate.toFixed(6)),
      accuracy_reference_words: accuracy?.referenceWords,
      accuracy_hypothesis_words: accuracy?.hypothesisWords,
      accuracy_word_edits: accuracy?.wordEdits,
      accuracy_wer:
        accuracy?.wordErrorRate === undefined
          ? undefined
          : Number(accuracy.wordErrorRate.toFixed(6)),
      accuracy_max_cer: maxCer,
      accuracy_target_met:
        accuracy === undefined || maxCer === undefined
          ? undefined
          : accuracy.characterErrorRate <= maxCer,
    };
    console.log(JSON.stringify(result, null, 2));
    if (
      accuracy !== undefined &&
      maxCer !== undefined &&
      accuracy.characterErrorRate > maxCer
    ) {
      throw new Error(
        `Capture CER ${accuracy.characterErrorRate.toFixed(4)} exceeded the ${maxCer.toFixed(4)} limit.`,
      );
    }
  } catch (error) {
    const workerFailure = readSafeWorkerFailure(serverLogTail);
    if (workerFailure && error instanceof Error) {
      throw new Error(`${error.message} Worker category: ${workerFailure}.`);
    }
    throw error;
  } finally {
    reportPhase("cleaning isolated resources");
    await browser?.close().catch(() => undefined);
    await api?.dispose().catch(() => undefined);
    await runtime?.dispose().catch(() => undefined);
    await rm(bundleDir, { force: true, recursive: true });
    if (wavePath) await rm(wavePath, { force: true });
  }
}

async function loadReferenceTranscript(path) {
  let value;
  try {
    value = await readFile(path, "utf8");
  } catch {
    throw new Error(`Could not read the reference transcript: ${path}`);
  }
  if (value.length > 100_000)
    throw new Error("The reference transcript exceeds 100,000 characters.");
  if (!value.trim()) throw new Error("The reference transcript is empty.");
  return value;
}

async function loadAsrBindings() {
  let configured;
  try {
    configured = parse(await readFile(resolve(".dev.vars"), "utf8"));
  } catch {
    throw new Error(
      "Could not read the ignored .dev.vars ASR provider configuration.",
    );
  }
  return Object.fromEntries(
    ASR_BINDING_NAMES.flatMap((name) => {
      const value = configured[name]?.trim();
      return value ? [[name, value]] : [];
    }),
  );
}

async function prepareWorkerBundle(bundleDir) {
  const reusableBundle = process.env.FLAREMO_CAPTURE_SMOKE_BUNDLE?.trim();
  if (!reusableBundle) {
    buildWorkerBundle(bundleDir);
    reportPhase("Worker bundle built");
    return;
  }
  await mkdir(bundleDir, { recursive: true });
  await copyFile(resolve(reusableBundle), resolve(bundleDir, "index.js"));
  reportPhase("verified local Worker bundle reused");
}

async function inspectInput(path, maxDurationSeconds) {
  let size;
  try {
    size = (await stat(path)).size;
  } catch {
    throw new Error(`Could not read the PCM fixture: ${path}`);
  }
  if (!size || size % Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(
      "The fixture must contain raw little-endian Float32 samples.",
    );
  }
  const sampleCount = size / Float32Array.BYTES_PER_ELEMENT;
  const durationSeconds = sampleCount / INPUT_SAMPLE_RATE;
  if (durationSeconds > maxDurationSeconds) {
    throw new Error(
      `The live smoke fixture is limited to ${maxDurationSeconds} seconds${maxDurationSeconds === DEFAULT_MAX_DURATION_SECONDS ? "; pass --allow-long for an explicit long-session run" : ""}.`,
    );
  }
  return { durationSeconds, sampleCount };
}

async function encodeInput(path, maxDurationSeconds) {
  const inspected = await inspectInput(path, maxDurationSeconds);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    throw new Error(`Could not read the PCM fixture: ${path}`);
  }
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  const samples = new Float32Array(buffer);
  const frames = [];
  const encoder = new PcmEncoder(INPUT_SAMPLE_RATE, (frame) =>
    frames.push(frame),
  );
  encoder.push(samples);
  encoder.flush();
  if (!frames.length) throw new Error("The PCM fixture is too short.");
  return { ...inspected, frames };
}

async function createWaveFixture(inputPath, outputPath, sampleCount) {
  const leadingSamples = INPUT_SAMPLE_RATE * BROWSER_LEADING_SILENCE_SECONDS;
  const trailingSamples = INPUT_SAMPLE_RATE * BROWSER_TRAILING_SILENCE_SECONDS;
  const totalSamples = leadingSamples + sampleCount + trailingSamples;
  const headerBytes = 44;
  const bytesPerSample = 2;
  const header = Buffer.alloc(headerBytes);
  header.write("RIFF", 0);
  header.writeUInt32LE(headerBytes + totalSamples * bytesPerSample - 8, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(INPUT_SAMPLE_RATE, 24);
  header.writeUInt32LE(INPUT_SAMPLE_RATE * bytesPerSample, 28);
  header.writeUInt16LE(bytesPerSample, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(totalSamples * bytesPerSample, 40);

  const input = await open(inputPath, "r");
  const output = await open(outputPath, "wx");
  const inputBuffer = Buffer.allocUnsafe(64 * 1024);
  const write = async (chunk) => {
    let offset = 0;
    while (offset < chunk.length) {
      const { bytesWritten } = await output.write(
        chunk,
        offset,
        chunk.length - offset,
        null,
      );
      if (!bytesWritten) throw new Error("Could not write the WAV fixture.");
      offset += bytesWritten;
    }
  };
  try {
    await write(header);
    await write(Buffer.alloc(leadingSamples * bytesPerSample));
    const inputBytes = sampleCount * Float32Array.BYTES_PER_ELEMENT;
    let inputOffset = 0;
    while (inputOffset < inputBytes) {
      const requestedBytes = Math.min(
        inputBuffer.length,
        inputBytes - inputOffset,
      );
      const { bytesRead } = await input.read(
        inputBuffer,
        0,
        requestedBytes,
        inputOffset,
      );
      if (!bytesRead) throw new Error("The PCM fixture ended unexpectedly.");
      if (bytesRead % Float32Array.BYTES_PER_ELEMENT) {
        throw new Error("The PCM fixture ended mid-sample.");
      }
      const pcm = Buffer.allocUnsafe((bytesRead / 4) * bytesPerSample);
      for (let offset = 0; offset < bytesRead; offset += 4) {
        const rawSample = inputBuffer.readFloatLE(offset);
        const sample = Math.max(
          -1,
          Math.min(1, Number.isFinite(rawSample) ? rawSample : 0),
        );
        pcm.writeInt16LE(
          Math.round(sample < 0 ? sample * 32768 : sample * 32767),
          offset / 2,
        );
      }
      await write(pcm);
      inputOffset += bytesRead;
    }
    await write(Buffer.alloc(trailingSamples * bytesPerSample));
  } finally {
    await Promise.allSettled([input.close(), output.close()]);
  }
}

function reportPhase(phase) {
  console.error(`[capture-live-smoke] ${phase}`);
}

async function transcribeInBrowser(
  browser,
  baseUrl,
  storageState,
  fixtureDurationSeconds,
) {
  const context = await browser.newContext({
    baseURL: baseUrl,
    permissions: ["microphone"],
    storageState,
  });
  try {
    await context.addInitScript(() => {
      const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      const tracks = [];
      const worklets = [];
      const finalSentenceIds = new Set();
      const NativeWorklet = window.AudioWorkletNode;
      const NativeWebSocket = window.WebSocket;
      window.AudioWorkletNode = class extends NativeWorklet {
        constructor(audioContext, name, options) {
          super(audioContext, name, options);
          worklets.push(name);
        }
      };
      window.WebSocket = class extends NativeWebSocket {
        constructor(url, protocols) {
          super(url, protocols);
          if (String(url).includes("/api/app/capture/ws")) {
            window.captureLiveSmokeWebSocketConnections += 1;
            this.addEventListener("message", (event) => {
              if (typeof event.data !== "string") return;
              try {
                const message = JSON.parse(event.data);
                if (message.type === "ready") {
                  window.captureLiveSmokeReadyAt = Date.now();
                  return;
                }
                if (
                  message.type !== "sentence" ||
                  message.final !== true ||
                  typeof message.id !== "string" ||
                  typeof message.endedAt !== "number" ||
                  typeof message.receivedAt !== "number" ||
                  typeof window.captureLiveSmokeReadyAt !== "number" ||
                  finalSentenceIds.has(message.id)
                )
                  return;
                finalSentenceIds.add(message.id);
                const latency =
                  message.receivedAt -
                  window.captureLiveSmokeReadyAt -
                  message.endedAt;
                // Small ordering skew is possible because the ready event is
                // timestamped in the browser while sentences are stamped by Worker.
                if (Number.isFinite(latency) && latency >= -100)
                  window.captureLiveSmokeSentenceLatencies.push(
                    Math.max(0, latency),
                  );
              } catch {
                // CaptureController remains responsible for protocol validation.
              }
            });
          }
        }
      };
      Object.assign(window, {
        captureLiveSmokeTracks: tracks,
        captureLiveSmokeWorklets: worklets,
        captureLiveSmokeWebSocketConnections: 0,
        captureLiveSmokeReadyAt: undefined,
        captureLiveSmokeSentenceLatencies: [],
      });
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await nativeGetUserMedia(constraints);
        tracks.push(...stream.getTracks());
        return stream;
      };
    });
    const page = await context.newPage();
    await page.goto("/capture");
    const start = page.getByRole("button", {
      name: /开始录音|Start recording/,
    });
    await start.waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
    if (!(await start.isEnabled()))
      throw new Error("The browser Capture start button is unavailable.");
    const tracksBeforeStart = await page.evaluate(
      () => window.captureLiveSmokeTracks.length,
    );
    if (tracksBeforeStart !== 0)
      throw new Error("The browser opened a microphone before explicit Start.");

    const startedAt = performance.now();
    await start.click();
    await page
      .getByText(/正在录音|Recording/, { exact: true })
      .waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
    const targetDurationMs =
      (fixtureDurationSeconds + BROWSER_LEADING_SILENCE_SECONDS) * 1_000;
    const stop = page.getByRole("button", {
      name: /停止录音|Stop recording/,
    });
    while (performance.now() - startedAt < targetDurationMs) {
      await delay(
        Math.min(5_000, targetDurationMs - (performance.now() - startedAt)),
      );
      if (!(await stop.isVisible()) || !(await stop.isEnabled())) {
        throw new Error(
          "The browser Capture session left its active state before the requested duration.",
        );
      }
    }
    await stop.click();

    const editor = page.getByRole("textbox", {
      name: /逐字稿|Transcript/,
      exact: true,
    });
    await editor.waitFor({ state: "visible", timeout: FINISH_TIMEOUT_MS });
    const text = (await editor.inputValue()).trim();
    if (!text)
      throw new Error("The browser review opened without finalized ASR text.");
    const diagnostics = await page.evaluate(() => ({
      tracks: window.captureLiveSmokeTracks.map((track) => track.readyState),
      worklets: window.captureLiveSmokeWorklets,
      webSocketConnections: window.captureLiveSmokeWebSocketConnections,
      sentenceLatencies: window.captureLiveSmokeSentenceLatencies,
    }));
    if (
      !diagnostics.tracks.length ||
      diagnostics.tracks.some((state) => state !== "ended")
    )
      throw new Error("The browser microphone was still active after Stop.");
    if (!diagnostics.worklets.includes("flaremo-pcm"))
      throw new Error("The browser did not use FlareMo's AudioWorklet path.");

    const marker = `capture-browser-live-smoke-${randomUUID()}`;
    await editor.fill(`${text}\n\n${marker}`);
    await page
      .getByRole("button", { name: /保存到 FlareMo|Save to FlareMo/ })
      .click();
    await page.waitForURL(/\/memo\//, { timeout: FINISH_TIMEOUT_MS });
    const finalSentences = text.match(/^\[/gm)?.length ?? 1;
    return {
      saved: { marker },
      webSocketConnections: diagnostics.webSocketConnections,
      transcript: {
        durationSeconds:
          fixtureDurationSeconds + BROWSER_LEADING_SILENCE_SECONDS,
        finalSentences,
        latency: summarizeSentenceLatency(diagnostics.sentenceLatencies),
        text,
      },
    };
  } finally {
    await context.close();
  }
}

async function transcribe(baseUrl, cookie, frames) {
  const state = {
    failure: undefined,
    latencies: [],
    phase: "connecting",
    readyAt: undefined,
    seen: new Set(),
    sentences: [],
  };
  const socket = new WebSocket(
    `${baseUrl.replace(/^http/, "ws")}/api/app/capture/ws`,
    { headers: { Cookie: cookie, Origin: baseUrl } },
  );
  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        encoding: "pcm_s16le",
        language: "zh",
        sampleRate: 16000,
        type: "start",
      }),
    );
  });
  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      state.failure = "INVALID_SERVER_MESSAGE";
      return;
    }
    let message;
    try {
      message = JSON.parse(data.toString("utf8"));
    } catch {
      state.failure = "INVALID_SERVER_MESSAGE";
      return;
    }
    if (message.type === "ready") {
      state.phase = "ready";
      state.readyAt = Date.now();
    }
    if (message.type === "error") {
      state.failure =
        typeof message.code === "string" ? message.code : "ASR_UPSTREAM_FAILED";
    }
    if (
      message.type === "sentence" &&
      message.final === true &&
      typeof message.id === "string" &&
      typeof message.text === "string" &&
      !state.seen.has(message.id)
    ) {
      state.seen.add(message.id);
      state.sentences.push(message.text);
      if (
        typeof message.endedAt === "number" &&
        typeof message.receivedAt === "number" &&
        typeof state.readyAt === "number"
      ) {
        const latency = message.receivedAt - state.readyAt - message.endedAt;
        if (Number.isFinite(latency) && latency >= -100)
          state.latencies.push(Math.max(0, latency));
      }
    }
    if (message.type === "finished") state.phase = "finished";
  });
  socket.on("error", () => {
    state.failure ??= "SOCKET_ERROR";
  });
  socket.on("close", (code) => {
    if (state.phase !== "finished") state.failure ??= `SOCKET_CLOSED_${code}`;
  });

  try {
    await waitForCapturePhase(state, "ready", READY_TIMEOUT_MS);
    const audioStartedAt = performance.now();
    let sentSamples = 0;
    for (const [index, frame] of frames.entries()) {
      assertCaptureOpen(socket, state, index, sentSamples);
      if (socket.bufferedAmount + frame.byteLength > MAX_BUFFERED_BYTES) {
        throw new Error(
          `The local WebSocket send queue exceeded ${MAX_BUFFERED_BYTES} bytes.`,
        );
      }
      socket.send(Buffer.from(frame), { binary: true });
      sentSamples += frame.byteLength / 2;
      const targetElapsed = (sentSamples / OUTPUT_SAMPLE_RATE) * 1_000;
      await delay(
        Math.max(0, targetElapsed - (performance.now() - audioStartedAt)),
      );
    }
    assertCaptureOpen(socket, state, frames.length, sentSamples);
    state.phase = "stopping";
    socket.send(JSON.stringify({ type: "stop" }));
    await waitForCapturePhase(state, "finished", FINISH_TIMEOUT_MS);
    return {
      durationSeconds: sentSamples / OUTPUT_SAMPLE_RATE,
      finalSentences: state.sentences.length,
      latency: summarizeSentenceLatency(state.latencies),
      text: state.sentences
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\n"),
    };
  } finally {
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close(1000, "Smoke complete");
    }
  }
}

function summarizeSentenceLatency(samples) {
  if (!samples.length) return undefined;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p95Ms: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    maxMs: Math.round(sorted.at(-1)),
  };
}

function assertCaptureOpen(socket, state, sentFrames, sentSamples) {
  if (state.failure || socket.readyState !== WebSocket.OPEN) {
    throw new Error(
      `Capture socket stopped after ${sentFrames} frames (${(sentSamples / OUTPUT_SAMPLE_RATE).toFixed(2)} seconds): ${state.failure ?? "SOCKET_NOT_OPEN"}.`,
    );
  }
}

async function waitForCapturePhase(state, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.failure) {
      throw new Error(`Capture WebSocket failed: ${state.failure}.`);
    }
    if (state.phase === expected) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for Capture state ${expected}.`);
}

function cookieHeader(cookies, baseUrl) {
  const url = new URL(baseUrl);
  return cookies
    .filter((cookie) => {
      const domain = cookie.domain.replace(/^\./, "");
      const domainMatches =
        url.hostname === domain || url.hostname.endsWith(`.${domain}`);
      return (
        domainMatches &&
        url.pathname.startsWith(cookie.path) &&
        (!cookie.secure || url.protocol === "https:")
      );
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function saveAndSearch(api, baseUrl, transcript, marker) {
  const memo = await requireJson(
    await api.post("/api/app/memos", {
      data: {
        content: `# Voice Capture live smoke\n\n${transcript}\n\n${marker}`,
        payload: { client_id: randomUUID(), tags: ["voice"] },
        source: "voice",
        visibility: "private",
      },
      headers: { origin: baseUrl },
    }),
    "isolated Memo save",
    201,
  );
  return findSavedMemo(api, marker, transcript, memo.name);
}

async function findSavedMemo(api, marker, transcript, expectedMemoId) {
  const search = new URLSearchParams({ q: marker, tag: "voice" });
  const result = await requireJson(
    await api.get(`/api/app/memos?${search}`),
    "isolated Memo search",
  );
  const found = result.memos?.find(
    (candidate) =>
      (!expectedMemoId || candidate.name === expectedMemoId) &&
      candidate.visibility === "private" &&
      candidate.content.includes(transcript) &&
      candidate.content.includes(marker),
  );
  if (!found || typeof found.name !== "string") {
    throw new Error("The saved voice Memo was not returned by tagged search.");
  }
  return { marker, memoId: found.name };
}

async function requireJson(response, operation, expectedStatus = 200) {
  if (!response.ok() || response.status() !== expectedStatus) {
    throw new Error(`${operation} failed with HTTP ${response.status()}.`);
  }
  return response.json();
}

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not allocate a local test port."));
        return;
      }
      probe.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function readSafeWorkerFailure(log) {
  const providerMarker = log.lastIndexOf("[capture] ASR provider failed");
  if (providerMarker >= 0) {
    const detail = log.slice(providerMarker, providerMarker + 300);
    const reason = detail.match(/reason:\s*['"]([a-z_]+)['"]/)?.[1];
    const retryable = detail.match(/retryable:\s*(true|false)/)?.[1];
    if (reason) {
      return `[capture] ASR provider failed reason=${reason}${retryable ? ` retryable=${retryable}` : ""}`;
    }
  }
  const markers = [
    "[capture] delivery failed",
    "[capture] browser disconnected",
    "[capture] session failed",
    "[capture] ASR provider failed",
  ];
  const marker = Math.max(...markers.map((value) => log.lastIndexOf(value)));
  if (marker < 0) return undefined;
  return log
    .slice(marker, marker + 300)
    .split(/\r?\n/)
    .slice(0, 5)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
