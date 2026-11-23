import { CAPTURE_MAX_DURATION_MS } from "@flaremo/contracts/constants";
import type { CaptureError, CaptureSnapshot } from "./controller";
import type { CaptureAudioSink, CapturedAudio } from "./encoder";
import type { CaptureSentence, CaptureState } from "./types";

/** The batch ASR provider the recorder drives (rollout §3.3). Read lazily:
 * a session only claims it once it starts. */
export type BatchRecorderDependencies = {
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

/** What the recorder asks of the controller while it carries the pipeline:
 * the controller keeps the published state and the retry/cancel decisions. */
export type BatchRecorderHost = {
  /** Published capture state ("transcribing" while the provider works). */
  state: () => CaptureState;
  /** Published session start: the recording clock and the cap measure on it. */
  startedAt: () => number | null;
  update: (patch: Partial<CaptureSnapshot>) => void;
  end: (error?: CaptureError | null) => void;
  /** Publishes finished sentences into the session transcript. */
  accept: (sentences: CaptureSentence[]) => void;
  /** The session exceeded its one-hour cap. */
  stop: (error: CaptureError) => void;
};

/**
 * Batch ASR (MiniMax): encode locally, then record-then-transcribe (rollout
 * §3.3). The sink taps the same zero-filled frame stream while it is being
 * created, and the recording clock starts with the first encoded frame so
 * transcript timestamps stay wall-clock true. The controller decides when to
 * record, stop, cancel or retry; the recorder owns the sink, the frame feed
 * and the transcription attempt.
 */
export class BatchRecorder {
  private readonly deps: () => BatchRecorderDependencies | undefined;
  private readonly host: BatchRecorderHost;
  private batchSink: CaptureAudioSink | undefined;
  private batchSinkPromise: Promise<CaptureAudioSink | null> | undefined;
  private batchBuffering = false;
  private batchMode = false;
  private batchStartedAt: number | null = null;
  private batchTimer: ReturnType<typeof setInterval> | undefined;
  private transcribeAbort: AbortController | undefined;
  // Kept after a failed attempt so the user can retry the transcription
  // without re-recording (rollout §3.3 error path).
  private batchAudio: CapturedAudio | undefined;
  constructor(
    deps: () => BatchRecorderDependencies | undefined,
    host: BatchRecorderHost,
  ) {
    this.deps = deps;
    this.host = host;
  }
  /** Starts a session: the sink is created straight away, so the encoder taps
   * the microphone's frames from the first one (rollout §3.3). */
  begin() {
    const deps = this.deps();
    this.batchMode = false;
    this.batchSink = undefined;
    this.batchStartedAt = null;
    this.batchAudio = undefined;
    this.batchBuffering = Boolean(deps);
    this.batchSinkPromise = deps
      ? deps.createSink().catch(() => null)
      : undefined;
  }
  /** A lazy sink creation is in flight. */
  get opening() {
    return this.batchSinkPromise !== undefined;
  }
  /** Awaits the sink; frames buffered in the meantime are fed by the caller. */
  async open() {
    this.batchSink = (await this.batchSinkPromise) ?? undefined;
    this.batchBuffering = false;
  }
  /** Drops the sink unused: the provider turned out streaming, or the session
   * was abandoned while the sink was being created. */
  dropSink() {
    this.batchBuffering = false;
    this.batchSink?.dispose();
    this.batchSink = undefined;
  }
  /** Replays the frames buffered while the sink was being created. */
  feed(frames: ArrayBuffer[]) {
    for (const frame of frames) this.push(frame);
  }
  /** Taps one frame into the sink; a failed push ends the session. */
  push(frame: ArrayBuffer) {
    // The recording clock starts with the first encoded frame, keeping the
    // millisecond timeline aligned with wall-clock time.
    if (this.batchStartedAt === null) this.batchStartedAt = Date.now();
    try {
      this.batchSink?.push(frame);
    } catch {
      this.host.end("transcribeFailed");
    }
  }
  /** The provider answered batch: record locally, watching the session cap. */
  record() {
    this.batchMode = true;
    this.batchTimer = setInterval(() => {
      const startedAt = this.host.startedAt();
      if (
        startedAt !== null &&
        Date.now() - startedAt >= CAPTURE_MAX_DURATION_MS
      )
        this.host.stop("limitReached");
    }, 5_000);
  }
  /** The session records into the sink; no socket carries its frames. */
  get recording() {
    return this.batchMode;
  }
  /** Frames are buffered while the sink is being created. */
  get buffering() {
    return this.batchBuffering;
  }
  /** The sink exists: batch recording can proceed. */
  get hasSink() {
    return this.batchSink !== undefined;
  }
  /** Wall-clock start of the recording, set with the first frame. */
  get startedAt() {
    return this.batchStartedAt;
  }
  /** The encoded audio of the finished recording (rollout §4.1). */
  get capturedAudio() {
    return this.batchAudio;
  }
  /** Cancels the duration watch without ending the recording: Stop keeps the
   * captured audio for its final drain. */
  cancelTimers() {
    clearInterval(this.batchTimer);
    this.batchTimer = undefined;
  }
  /** Stop: the duration watch ends and the recording is transcribed. */
  async finish(stopError: CaptureError | null) {
    this.cancelTimers();
    const sink = this.batchSink;
    this.batchSink = undefined;
    const batch = this.deps();
    const startedAt = this.host.startedAt();
    if (!sink || !batch || startedAt === null) return this.host.end(stopError);
    let audio: CapturedAudio;
    try {
      audio = await sink.finalize();
    } catch {
      return this.host.end("transcribeFailed");
    } finally {
      sink.dispose();
    }
    this.batchAudio = audio;
    await this.runTranscribe(audio, startedAt, stopError);
  }
  /** User exit while the transcription is in flight (rollout §3.3): the
   * attempt is abandoned and no retry is offered afterwards. */
  cancel() {
    const signal = this.transcribeAbort;
    this.transcribeAbort = undefined;
    signal?.abort();
    this.batchAudio = undefined;
  }
  /** Retry after a failed transcription (rollout §3.3): the encoded audio of
   * the finished recording is re-uploaded as-is. */
  retry(startedAt: number) {
    const audio = this.batchAudio;
    if (!audio) return;
    void this.runTranscribe(audio, startedAt, null);
  }
  /** Session teardown: the sink, the duration watch and an in-flight
   * transcription all end here. */
  dispose() {
    clearInterval(this.batchTimer);
    this.batchTimer = undefined;
    this.transcribeAbort?.abort();
    this.transcribeAbort = undefined;
    this.batchSink?.dispose();
    this.batchSink = undefined;
  }
  /** The session is over: no further frame is routed into the batch. */
  end() {
    this.batchBuffering = false;
    this.batchMode = false;
  }
  /** Discards the finished recording: a new session starts empty. */
  clearAudio() {
    this.batchAudio = undefined;
  }
  private async runTranscribe(
    audio: CapturedAudio,
    startedAt: number,
    stopError: CaptureError | null,
  ) {
    const batch = this.deps();
    if (!batch) return this.host.end(stopError);
    if (!audio.slices.length) return this.host.end(stopError);
    this.host.update({ state: "transcribing", partial: "", error: stopError });
    const signal = new AbortController();
    this.transcribeAbort = signal;
    try {
      const sentences = await batch.transcribe(audio, {
        language: "zh",
        startedAtMs: startedAt,
        onProgress: (transcribing) => {
          if (
            this.host.state() === "transcribing" &&
            this.transcribeAbort === signal
          )
            this.host.update({ transcribing });
        },
        signal: signal.signal,
      });
      if (this.transcribeAbort !== signal) return; // Cancelled by the user.
      this.host.accept(sentences);
      // The audio stays available for the page's R2 upload (getCapturedAudio);
      // only a discard/new session clears it.
      this.host.end();
    } catch {
      if (this.transcribeAbort !== signal) return;
      this.host.end("transcribeFailed");
    } finally {
      if (this.transcribeAbort === signal) this.transcribeAbort = undefined;
    }
  }
}
