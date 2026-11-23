import { CAPTURE_MAX_TEXT } from "@flaremo/contracts/constants";
import { BatchRecorder } from "./batch-recorder";
import type { CaptureAudioSink, CapturedAudio } from "./encoder";
import type { Microphone } from "./microphone";
import {
  type CaptureStreamError,
  StreamTransport,
  type StreamTransportHandlers,
} from "./stream-transport";
import type { CaptureSentence, CaptureState } from "./types";

export type CaptureError =
  | "permissionDenied"
  | "noMicrophone"
  | "microphoneBusy"
  | "interrupted"
  | "unavailable"
  | "connectionFailed"
  | "finishFailed"
  | "limitReached"
  | "transcribeFailed";
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
  /** Batch mode progress while state is "transcribing" (rollout §3.3). */
  transcribing: { done: number; total: number } | null;
};
export type CaptureDependencies = {
  microphone: (
    onFrame: (frame: ArrayBuffer) => void,
    signal: AbortSignal,
    interrupt: () => void,
  ) => Promise<Microphone>;
  status: () => Promise<{
    available: boolean;
    kind?: "streaming" | "batch" | null;
  }>;
  socket: () => WebSocket;
  /** Batch ASR (MiniMax): encode locally, then record-then-transcribe. */
  batch?: {
    createSink: () => Promise<CaptureAudioSink>;
    transcribe: (
      audio: CapturedAudio,
      input: {
        language: string;
        startedAtMs: number;
        onProgress: (progress: { done: number; total: number }) => void;
        signal: AbortSignal;
      },
    ) => Promise<CaptureSentence[]>;
  };
};
export function captureIsActive(state: CaptureState) {
  return [
    "requesting_permission",
    "connecting",
    "recording",
    "paused",
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
    transcribing: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly ids = new Set<string>();
  private textLength = 0;
  private abort: AbortController | undefined;
  private mic: Microphone | undefined;
  /** The session's streaming socket; a reconnect replaces its socket only. */
  private transport: StreamTransport | undefined;
  /** Stop's final drain deadline: the ASR never acknowledged the session. */
  private drainTimer: ReturnType<typeof setTimeout> | undefined;
  // D1 (voice-capture-rollout §2.4): a user pause must survive a reconnect
  // (the socket can silently drop while paused), so it lives outside the
  // published state.
  private paused = false;
  // Batch mode (rollout §3.3): the sink taps the same zero-filled frame
  // stream while it is being created, and the recording clock starts with
  // the first encoded frame so transcript timestamps stay wall-clock true.
  private readonly batch: BatchRecorder;
  constructor(deps: CaptureDependencies) {
    this.deps = deps;
    this.batch = new BatchRecorder(() => this.deps.batch, {
      state: () => this.snapshot.state,
      startedAt: () => this.snapshot.startedAt,
      update: (patch) => this.update(patch),
      end: (error = this.snapshot.error) => this.end(error),
      accept: (sentences) => this.acceptBatch(sentences),
      stop: (error) => void this.stop(error),
    });
  }
  getSnapshot = () => this.snapshot;
  /**
   * The encoded audio of the finished recording, kept after transcription
   * succeeds so the capture page can upload it to R2 before saving (rollout
   * §4.1). Cleared on start/reset (new session or discard), never on success:
   * blobs are cheap to hold and the upload may legitimately happen later.
   */
  getCapturedAudio = (): CapturedAudio | null =>
    this.batch.capturedAudio ?? null;
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
    this.paused = false;
    // Batch mode: the sink must exist before the first frame arrives, so its
    // creation starts with the session; the mic handle comes later.
    this.batch.begin();
    const transport = new StreamTransport(this.deps, this.streamHandlers());
    this.transport = transport;
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
      transcribing: null,
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
      transport.noteAudio();
      if (this.batch.opening) {
        await this.batch.open();
        if (abort.signal.aborted) {
          this.batch.dropSink();
          return;
        }
        this.batch.feed(transport.drain());
      }
      this.update({
        microphoneActive: true,
        state: "connecting",
        // The recording clock starts only after the provider confirms that
        // audio can be accepted. Permission and connection time are setup.
        startedAt: null,
      });
      await transport.connect(abort);
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
  /** The hooks the transport talks back through; every policy decision
   * (state, retry, batch) stays in the controller. */
  private streamHandlers(): StreamTransportHandlers {
    return {
      state: () => this.snapshot.state,
      startedAt: () => this.snapshot.startedAt,
      onReady: () => {
        // Preserve the session's original start across reconnects so the
        // recorded start time and the total-duration cap stay truthful.
        this.update({
          state: this.paused ? "paused" : "recording",
          startedAt: this.snapshot.startedAt ?? Date.now(),
        });
      },
      onSentence: (sentence) => this.sentence(sentence),
      onFinished: () => this.end(),
      onInterrupted: () => this.interrupt(),
      onDurationLimit: () => void this.stop("limitReached"),
      onUnavailable: () => this.end("unavailable"),
      onBatch: () => this.recordLocally(),
      onStreaming: () => this.batch.dropSink(),
      onError: (message) => this.handleStreamError(message),
      onLost: () => this.reconnect(),
      onConnectionFailed: () => this.end("connectionFailed"),
      onStatusTimeout: () => this.end("connectionFailed"),
    };
  }
  /** The provider's error codes mapped onto the session's error state; false
   * once the session must reconnect instead. */
  private handleStreamError(message: CaptureStreamError) {
    if (
      message.code === "SESSION_EXPIRED" ||
      message.code === "INVALID_MESSAGE"
    ) {
      this.end("connectionFailed");
      return true;
    }
    if (message.code === "LIMIT_REACHED") {
      this.end("limitReached");
      return true;
    }
    if (message.code === "ASR_UPSTREAM_FAILED" && message.retryable === false) {
      this.end("connectionFailed");
      return true;
    }
    return false;
  }
  /** A dropped socket reconnects on the backoff schedule, then fails the
   * session; a stop in progress instead fails its final drain (D1). */
  private reconnect() {
    if (this.snapshot.state === "stopping") return this.end("finishFailed");
    const abort = this.abort;
    if (!abort || abort.signal.aborted) return;
    const transport = this.transport;
    if (!transport) return;
    if (transport.retriesExhausted) return this.end("connectionFailed");
    this.update({ state: "reconnecting", gap: true, partial: "" });
    transport.scheduleReconnect(abort);
  }
  /** Batch mode (rollout §3.3): no socket; frames feed the local encoder and
   * the provider is only contacted after Stop. */
  private recordLocally() {
    if (!this.batch.hasSink) return this.end("unavailable");
    this.batch.record();
    this.update({
      state: "recording",
      startedAt: this.batch.startedAt ?? Date.now(),
    });
  }
  private audio(frame: ArrayBuffer) {
    const transport = this.transport;
    transport?.noteAudio();
    // Batch mode taps the same frame stream; paused frames are zero-filled
    // exactly like the streaming path so the provider never receives (or
    // transcribes) speech from a paused segment (D1).
    if (this.batch.recording || (this.batch.buffering && this.deps.batch)) {
      const payload = this.paused ? new ArrayBuffer(frame.byteLength) : frame;
      if (this.batch.buffering || !this.batch.hasSink)
        transport?.buffer(payload);
      else this.batch.push(payload);
      return;
    }
    if (
      !transport?.isReady ||
      (this.snapshot.state !== "recording" &&
        this.snapshot.state !== "paused" &&
        this.snapshot.state !== "stopping")
    ) {
      if (
        this.snapshot.state === "connecting" ||
        this.snapshot.state === "reconnecting"
      )
        // A pause survives reconnects, so silence — not captured speech —
        // must be buffered while paused even without a live socket.
        transport?.buffer(
          this.paused ? new ArrayBuffer(frame.byteLength) : frame,
        );
      return;
    }
    // While paused the user's speech must neither reach the ASR provider
    // (no transcript, no billed speech) nor break the audio timeline: the
    // frame cadence continues with zero-filled PCM so server-side timestamps
    // keep matching wall-clock time, and resuming stays gap-free (D1).
    const payload =
      this.snapshot.state === "paused"
        ? new ArrayBuffer(frame.byteLength)
        : frame;
    transport.send(payload);
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
  /** User-intent pause: only between live recording and resuming (D1). */
  pause() {
    if (this.snapshot.state !== "recording" || this.paused) return;
    this.paused = true;
    this.update({ state: "paused", partial: "" });
  }
  resume() {
    if (!this.paused || this.snapshot.state !== "paused") return;
    this.paused = false;
    // A socket lost while paused reconnects without leaving the paused state;
    // if it is somehow gone anyway, fall back to the reconnect path.
    this.update({
      state: this.transport?.isReady ? "recording" : "reconnecting",
    });
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
    this.transport?.cancelTimers();
    this.batch.cancelTimers();
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
    if (this.batch.recording) {
      await this.batch.finish(error);
      return;
    }
    const transport = this.transport;
    if (transport?.live()) {
      this.drainTimer = setTimeout(() => this.end("finishFailed"), 12_000);
      if (!transport.requestStop()) this.end("finishFailed");
    } else this.end(error);
  }
  interrupt() {
    if (captureIsActive(this.snapshot.state)) void this.stop("interrupted");
  }
  /** User exit while the batch transcription is in flight (rollout §3.3):
   * the attempt is abandoned; the session returns to review with whatever
   * text exists so it can be typed or discarded (no partial batch results). */
  cancelTranscription() {
    if (this.snapshot.state !== "transcribing") return;
    this.batch.cancel();
    this.update({ state: "review", transcribing: null, partial: "" });
  }
  /** Retry after a failed batch transcription (rollout §3.3): the encoded
   * audio of the finished recording is re-uploaded as-is. */
  retryTranscription() {
    if (this.snapshot.state !== "review") return;
    const startedAt = this.snapshot.startedAt;
    if (startedAt === null) return;
    this.batch.retry(startedAt);
  }
  private acceptBatch(sentences: CaptureSentence[]) {
    let added = 0;
    for (const sentence of sentences) {
      if (this.ids.has(sentence.id)) continue;
      if (
        this.textLength + sentence.text.length + 20 > CAPTURE_MAX_TEXT ||
        this.ids.size >= 4000
      )
        break;
      this.ids.add(sentence.id);
      this.textLength += sentence.text.length + 20;
      this.snapshot.sentences.push(sentence);
      added++;
    }
    if (added)
      this.update({
        sentenceVersion: this.snapshot.sentenceVersion + 1,
        partial: "",
      });
  }
  private end(error: CaptureError | null = this.snapshot.error) {
    this.dispose();
    this.transport?.clearPending();
    this.paused = false;
    this.batch.end();
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
      transcribing: null,
    });
  }
  reset() {
    this.dispose();
    this.paused = false;
    this.batch.clearAudio();
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
      transcribing: null,
    });
  }
  dispose = () => {
    this.abort?.abort();
    this.mic?.dispose();
    this.mic = undefined;
    this.transport?.close();
    clearTimeout(this.drainTimer);
    this.batch.dispose();
  };
}
