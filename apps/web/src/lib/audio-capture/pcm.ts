const BASE_TAPS = 96;
const BASE_INPUT_RATE = 48_000;
const PHASES = 128;

/** Stateful low-pass resampling. Integer phase avoids block-boundary drift. */
export class StreamingResampler {
  private readonly ring: Float32Array;
  private readonly filters: Float32Array[];
  private readonly taps: number;
  private cursor = 0;
  private phase = 0;
  private readonly inputRate: number;
  private readonly outputRate: number;
  constructor(inputRate: number, outputRate = 16000) {
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    if (
      !Number.isFinite(inputRate) ||
      inputRate < outputRate ||
      outputRate <= 0
    )
      throw new Error("Unsupported sample rate");
    const scaledTaps = Math.ceil((BASE_TAPS * inputRate) / BASE_INPUT_RATE);
    this.taps = Math.max(BASE_TAPS, scaledTaps + (scaledTaps % 2));
    this.ring = new Float32Array(this.taps + 16);
    const cutoff = (0.45 * outputRate) / inputRate;
    this.filters = Array.from({ length: PHASES }, (_, phase) => {
      const filter = new Float32Array(this.taps);
      let sum = 0;
      for (let k = 0; k < this.taps; k++) {
        const x = k - (this.taps - 1) / 2 - phase / PHASES;
        const sinc =
          x === 0
            ? 2 * cutoff
            : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
        const window =
          0.42 -
          0.5 * Math.cos((2 * Math.PI * k) / (this.taps - 1)) +
          0.08 * Math.cos((4 * Math.PI * k) / (this.taps - 1));
        filter[k] = sinc * window;
        sum += filter[k];
      }
      for (let k = 0; k < this.taps; k++) filter[k] /= sum;
      return filter;
    });
  }
  push(input: Float32Array, emit: (sample: number) => void) {
    for (const sample of input) {
      this.ring[this.cursor] = Number.isFinite(sample) ? sample : 0;
      this.phase += this.outputRate;
      if (this.phase >= this.inputRate) {
        this.phase -= this.inputRate;
        if (this.inputRate === this.outputRate) emit(sample);
        else {
          const filter =
            this.filters[
              Math.min(
                PHASES - 1,
                Math.floor((this.phase / this.outputRate) * PHASES),
              )
            ];
          let value = 0;
          for (let k = 0; k < this.taps; k++)
            value +=
              this.ring[
                (this.cursor - k + this.ring.length) % this.ring.length
              ] * filter[k];
          emit(value);
        }
      }
      this.cursor = (this.cursor + 1) % this.ring.length;
    }
  }
}

export function floatToInt16(input: Float32Array) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const value = Math.max(
      -1,
      Math.min(1, Number.isFinite(input[i]) ? input[i] : 0),
    );
    output[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return output;
}
export function downsample(
  input: Float32Array,
  inputRate: number,
  outputRate = 16000,
) {
  const result: number[] = [];
  new StreamingResampler(inputRate, outputRate).push(input, (value) =>
    result.push(value),
  );
  return new Float32Array(result);
}

/** 100 ms mono PCM frames. All buffers have bounded size and explicit LE encoding. */
export class PcmEncoder {
  private readonly resampler: StreamingResampler;
  private buffer = new ArrayBuffer(3200);
  private view = new DataView(this.buffer);
  private offset = 0;
  private readonly emit: (frame: ArrayBuffer) => void;
  constructor(inputRate: number, emit: (frame: ArrayBuffer) => void) {
    this.emit = emit;
    this.resampler = new StreamingResampler(inputRate);
  }
  push(input: Float32Array) {
    this.resampler.push(input, (sample) => {
      const value = Math.max(
        -1,
        Math.min(1, Number.isFinite(sample) ? sample : 0),
      );
      this.view.setInt16(
        this.offset,
        value < 0 ? value * 32768 : value * 32767,
        true,
      );
      this.offset += 2;
      if (this.offset === this.buffer.byteLength) this.flush();
    });
  }
  flush() {
    if (!this.offset) return;
    const frame = this.buffer.slice(0, this.offset);
    this.offset = 0;
    this.emit(frame);
  }
}
