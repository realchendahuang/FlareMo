import { PcmEncoder } from "./pcm";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;

class CaptureProcessor extends AudioWorkletProcessor {
  private stopped = false;
  private readonly encoder = new PcmEncoder(sampleRate, (frame) =>
    this.port.postMessage(frame, [frame]),
  );
  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data === "flush") {
        this.stopped = true;
        this.encoder.flush();
        this.port.postMessage("flushed");
      }
    };
  }
  process(inputs: Float32Array[][]) {
    if (this.stopped) return false;
    const channel = inputs[0]?.[0];
    if (channel) this.encoder.push(channel);
    return true;
  }
}
registerProcessor("flaremo-pcm", CaptureProcessor);
