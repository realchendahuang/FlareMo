import { PcmEncoder } from "./pcm";
import workletUrl from "./worklet?worker&url";

export type Microphone = { stop(): Promise<void>; dispose(): void };

/** Called synchronously from a user gesture; never reopens the mic on reconnect. */
export async function openMicrophone(
  onPcm: (pcm: ArrayBuffer) => void,
  signal: AbortSignal,
  onInterruption: () => void,
): Promise<Microphone> {
  let context: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let sink: GainNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let encoder: PcmEncoder | undefined;
  let disposed = false;
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  let flushed: (() => void) | undefined;
  const interrupt = () => {
    if (!stopping && !disposed) onInterruption();
  };
  const stateChanged = () => {
    if (context?.state !== "running") interrupt();
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    stream?.getTracks().forEach((track) => {
      track.removeEventListener("ended", interrupt);
      track.removeEventListener("mute", interrupt);
      track.stop();
    });
    source?.disconnect();
    processor?.disconnect();
    worklet?.disconnect();
    sink?.disconnect();
    if (processor) processor.onaudioprocess = null;
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.port.close();
    }
    context?.removeEventListener("statechange", stateChanged);
    if (context && context.state !== "closed")
      void context.close().catch(() => undefined);
    flushed?.();
  }
  function check() {
    if (disposed || signal.aborted)
      throw new DOMException("Capture cancelled", "AbortError");
  }
  signal.addEventListener("abort", dispose, { once: true });
  try {
    check();
    // Resume before awaiting permission so Safari retains the click activation.
    context = new AudioContext();
    const resume = context.resume();
    void resume.catch(() => undefined);
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (disposed || signal.aborted) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      check();
    }
    await resume;
    check();
    if (context.state !== "running")
      throw new Error("AudioContext unavailable");
    source = context.createMediaStreamSource(stream);
    sink = context.createGain();
    sink.gain.value = 0;
    sink.connect(context.destination);
    if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        await context.audioWorklet.addModule(workletUrl);
        check();
        worklet = new AudioWorkletNode(context, "flaremo-pcm", {
          channelCount: 1,
          channelCountMode: "explicit",
        });
        worklet.port.onmessage = (event) => {
          if (event.data === "flushed") flushed?.();
          else if (event.data instanceof ArrayBuffer && !disposed)
            onPcm(event.data);
        };
        worklet.onprocessorerror = interrupt;
        source.connect(worklet).connect(sink);
      } catch (error) {
        check();
        worklet?.disconnect();
        worklet?.port.close();
        worklet = undefined;
        if (error instanceof DOMException && error.name === "AbortError")
          throw error;
      }
    }
    if (!worklet) {
      encoder = new PcmEncoder(context.sampleRate, onPcm);
      processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        if (!disposed && !stopping)
          encoder?.push(event.inputBuffer.getChannelData(0));
      };
      source.connect(processor).connect(sink);
    }
    context.addEventListener("statechange", stateChanged);
    stream.getTracks().forEach((track) => {
      track.addEventListener("ended", interrupt);
      track.addEventListener("mute", interrupt);
    });
    return {
      dispose,
      stop() {
        if (stopPromise) return stopPromise;
        stopping = true;
        // Release hardware immediately; drain the already captured worklet frame.
        stream?.getTracks().forEach((track) => {
          track.stop();
        });
        source?.disconnect();
        stopPromise = new Promise<void>((resolve) => {
          const timer = setTimeout(() => flushed?.(), 300);
          flushed = () => {
            clearTimeout(timer);
            resolve();
          };
          if (worklet && !disposed) worklet.port.postMessage("flush");
          else {
            encoder?.flush();
            flushed();
          }
        }).finally(dispose);
        return stopPromise;
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
