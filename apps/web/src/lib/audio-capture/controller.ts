import {
  CAPTURE_MAX_DURATION_MS,
  CAPTURE_MAX_TEXT,
  captureServerMessageSchema,
} from "@flaremo/contracts";
import type { Microphone } from "./microphone";
import type { CaptureSentence, CaptureState } from "./types";

export type CaptureError =
  | "permissionDenied"
  | "noMicrophone"
  | "microphoneBusy"
  | "interrupted"
  | "unavailable"
  | "connectionFailed"
  | "finishFailed"
  | "limitReached";
export type CaptureSnapshot = {
  state: CaptureState;
  sentences: CaptureSentence[];
  sentenceVersion: number;
  partial: string;
  startedAt: number | null;
  stoppedAt: number | null;
  microphoneActive: boolean;
  error: CaptureError | null;
  gap: boolean;
};
export type CaptureDependencies = {
  microphone: (
    onFrame: (frame: ArrayBuffer) => void,
    signal: AbortSignal,
    interrupt: () => void,
  ) => Promise<Microphone>;
  status: () => Promise<{ available: boolean }>;
  socket: () => WebSocket;
};
export function captureIsActive(state: CaptureState) {
  return [
    "requesting_permission",
    "connecting",
    "recording",
    "reconnecting",
    "stopping",
  ].includes(state);
}
export class CaptureController {
  private readonly deps: CaptureDependencies;
  private snapshot: CaptureSnapshot = {
    state: "idle",
    sentences: [],
    sentenceVersion: 0,
    partial: "",
    startedAt: null,
    stoppedAt: null,
    microphoneActive: false,
    error: null,
    gap: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly ids = new Set<string>();
  private textLength = 0;
  private abort: AbortController | undefined;
  private mic: Microphone | undefined;
  private socket: WebSocket | undefined;
  private ready = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lastMessage = 0;
  private lastAudio = 0;
  constructor(deps: CaptureDependencies) {
    this.deps = deps;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<CaptureSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  async start() {
    if (this.snapshot.state !== "idle" && this.snapshot.state !== "error")
      return;
    this.dispose();
    this.ids.clear();
    this.textLength = 0;
    this.retry = 0;
    const abort = new AbortController();
    this.abort = abort;
    this.update({
      state: "requesting_permission",
      sentences: [],
      sentenceVersion: 0,
      partial: "",
      startedAt: null,
      stoppedAt: null,
      microphoneActive: false,
      error: null,
      gap: false,
    });
    try {
      const mic = await this.deps.microphone(
        (frame) => {
          if (!abort.signal.aborted) this.audio(frame);
        },
        abort.signal,
        () => {
          if (!abort.signal.aborted) this.interrupt();
        },
      );
      if (abort.signal.aborted) {
        mic.dispose();
        return;
      }
      this.mic = mic;
      this.lastAudio = Date.now();
      this.update({
        microphoneActive: true,
        state: "connecting",
        // The recording clock starts only after the provider confirms that
        // audio can be accepted. Permission and connection time are setup.
        startedAt: null,
      });
      await this.connect(abort);
    } catch (error) {
      if (abort.signal.aborted) return;
      const name = error instanceof Error ? error.name : "";
      this.end(
        name === "NotAllowedError"
          ? "permissionDenied"
          : name === "NotFoundError"
            ? "noMicrophone"
            : name === "NotReadableError"
              ? "microphoneBusy"
              : "interrupted",
      );
    }
  }
  private async connect(abort: AbortController) {
    const statusDeadline = setTimeout(
      () => this.end("connectionFailed"),
      10_000,
    );
    this.timer = statusDeadline;
    try {
      const status = await this.deps.status();
      clearTimeout(statusDeadline);
      if (abort.signal.aborted || this.snapshot.state === "stopping") return;
      if (!status.available) return this.end("unavailable");
      const socket = this.deps.socket();
      this.socket = socket;
      this.ready = false;
      this.timer = setTimeout(() => {
        if (this.socket === socket) this.lost(socket);
      }, 30_000);
      socket.onopen = () => {
        if (this.socket !== socket || abort.signal.aborted) return;
        socket.send(
          JSON.stringify({
            type: "start",
            sampleRate: 16000,
            encoding: "pcm_s16le",
            language: "auto",
          }),
        );
      };
      socket.onmessage = (event) => {
        if (this.socket !== socket || abort.signal.aborted) return;
        try {
          if (typeof event.data !== "string" || event.data.length > 128_000)
            throw new Error("Invalid response");
          const message = captureServerMessageSchema.parse(
            JSON.parse(event.data),
          );
          this.lastMessage = Date.now();
          if (message.type === "ready") {
            if (
              this.snapshot.state !== "connecting" &&
              this.snapshot.state !== "reconnecting"
            )
              return;
            clearTimeout(this.timer);
            this.ready = true;
            this.lastAudio = Date.now();
            this.update({ state: "recording", startedAt: Date.now() });
            this.heartbeat = setInterval(() => {
              if (Date.now() - this.lastAudio > 10_000) return this.interrupt();
              if (
                Date.now() - (this.snapshot.startedAt ?? Date.now()) >=
                CAPTURE_MAX_DURATION_MS
              ) {
                void this.stop("limitReached");
                return;
              }
              if (Date.now() - this.lastMessage > 15_000)
                return this.lost(socket);
              if (socket.readyState === 1)
                socket.send(JSON.stringify({ type: "ping" }));
            }, 5_000);
          } else if (message.type === "sentence") this.sentence(message);
          else if (message.type === "finished") {
            if (this.snapshot.state === "stopping") this.end();
            else this.lost(socket);
          } else if (message.type === "error") {
            if (
              message.code === "SESSION_EXPIRED" ||
              message.code === "INVALID_MESSAGE"
            )
              this.end("connectionFailed");
            else if (message.code === "LIMIT_REACHED") this.end("limitReached");
            else if (
              message.code === "ASR_UPSTREAM_FAILED" &&
              message.retryable === false
            )
              this.end("connectionFailed");
            else this.lost(socket);
          }
        } catch {
          this.end("connectionFailed");
        }
      };
      socket.onclose = () => this.lost(socket);
      socket.onerror = () => this.lost(socket);
    } catch {
      clearTimeout(statusDeadline);
      if (!abort.signal.aborted) this.end("connectionFailed");
    }
  }
  private audio(frame: ArrayBuffer) {
    this.lastAudio = Date.now();
    if (
      !this.ready ||
      (this.snapshot.state !== "recording" &&
        this.snapshot.state !== "stopping")
    )
      return;
    const socket = this.socket;
    if (socket?.readyState !== 1) return;
    if (socket.bufferedAmount + frame.byteLength > 64_000)
      return this.lost(socket);
    try {
      socket.send(frame);
    } catch {
      this.lost(socket);
    }
  }
  private sentence(sentence: CaptureSentence) {
    if (this.ids.has(sentence.id)) return;
    if (!sentence.final) {
      this.update({ partial: sentence.text });
      return;
    }
    if (
      this.textLength + sentence.text.length + 20 > CAPTURE_MAX_TEXT ||
      this.ids.size >= 4000
    ) {
      void this.stop("limitReached");
      return;
    }
    this.ids.add(sentence.id);
    this.textLength += sentence.text.length + 20;
    this.snapshot.sentences.push(sentence);
    this.update({
      sentenceVersion: this.snapshot.sentenceVersion + 1,
      partial: "",
    });
  }
  private closeSocket() {
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    this.ready = false;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* Closed. */
      }
    }
  }
  private lost(socket: WebSocket) {
    if (this.socket !== socket) return;
    if (this.snapshot.state === "stopping") return this.end("finishFailed");
    this.closeSocket();
    const abort = this.abort;
    if (!abort || abort.signal.aborted) return;
    if (this.retry >= 6) return this.end("connectionFailed");
    const delay = [1000, 2000, 4000, 8000, 15000, 15000][this.retry++];
    this.update({ state: "reconnecting", gap: true, partial: "" });
    this.timer = setTimeout(() => {
      void this.connect(abort);
    }, delay);
  }
  async stop(error: CaptureError | null = null) {
    if (
      !captureIsActive(this.snapshot.state) ||
      this.snapshot.state === "stopping"
    )
      return;
    this.update({
      state: "stopping",
      error,
      stoppedAt: Date.now(),
      microphoneActive: false,
    });
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    const mic = this.mic;
    this.mic = undefined;
    // A pending permission grant must not reopen recording after Stop.
    if (!mic) {
      this.end(error);
      return;
    }
    try {
      await mic.stop();
    } catch {
      mic.dispose();
    }
    if (this.getSnapshot().state !== "stopping") return;
    if (this.ready && this.socket?.readyState === 1) {
      this.timer = setTimeout(() => this.end("finishFailed"), 12_000);
      try {
        this.socket.send(JSON.stringify({ type: "stop" }));
      } catch {
        this.end("finishFailed");
      }
    } else this.end(error);
  }
  interrupt() {
    if (captureIsActive(this.snapshot.state)) void this.stop("interrupted");
  }
  private end(error: CaptureError | null = this.snapshot.error) {
    this.dispose();
    this.update({
      state:
        this.snapshot.startedAt !== null || this.snapshot.sentences.length
          ? "review"
          : error
            ? "error"
            : "idle",
      error,
      microphoneActive: false,
      partial: "",
      stoppedAt: this.snapshot.stoppedAt ?? Date.now(),
    });
  }
  reset() {
    this.dispose();
    this.update({
      state: "idle",
      sentences: [],
      sentenceVersion: 0,
      partial: "",
      startedAt: null,
      stoppedAt: null,
      microphoneActive: false,
      error: null,
      gap: false,
    });
  }
  dispose = () => {
    this.abort?.abort();
    this.mic?.dispose();
    this.mic = undefined;
    this.closeSocket();
  };
}
