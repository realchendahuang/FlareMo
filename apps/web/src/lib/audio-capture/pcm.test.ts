import { describe, expect, it } from "vitest";
import {
  downsample,
  floatToInt16,
  PcmEncoder,
  StreamingResampler,
} from "./pcm";

describe("streaming audio PCM", () => {
  it("clamps signed PCM and writes little endian bytes", () => {
    expect(
      Array.from(floatToInt16(new Float32Array([-2, -1, 0, 1, 2, Number.NaN]))),
    ).toEqual([-32768, -32768, 0, 32767, 32767, 0]);
    const frames: ArrayBuffer[] = [];
    const encoder = new PcmEncoder(16000, (frame) => frames.push(frame));
    encoder.push(new Float32Array([-1, 1, 0]));
    encoder.flush();
    expect(Array.from(new Uint8Array(frames[0]))).toEqual([
      0, 128, 255, 127, 0, 0,
    ]);
  });
  it.each([44100, 48000, 96000])(
    "produces identical samples across arbitrary chunk boundaries at %i Hz",
    (rate) => {
      const input = Float32Array.from({ length: rate }, (_, i) =>
        Math.sin(i * 0.12),
      );
      const expected = downsample(input, rate);
      const actual: number[] = [];
      const stream = new StreamingResampler(rate);
      for (let i = 0; i < input.length; i += 128)
        stream.push(input.subarray(i, i + 128), (sample) =>
          actual.push(sample),
        );
      expect(new Float32Array(actual)).toEqual(expected);
      expect(actual).toHaveLength(16000);
    },
  );
  it.each([44100, 48000, 96000])(
    "preserves speech while attenuating aliases at %i Hz",
    (rate) => {
      const rms = (frequency: number) => {
        const input = Float32Array.from({ length: rate }, (_, i) =>
          Math.sin((2 * Math.PI * frequency * i) / rate),
        );
        const output = downsample(input, rate).slice(200);
        return Math.sqrt(
          output.reduce((sum, sample) => sum + sample * sample, 0) /
            output.length,
        );
      };
      expect(rms(1000)).toBeGreaterThan(0.68);
      expect(rms(6500)).toBeGreaterThan(0.64);
      expect(rms(12000)).toBeLessThan(0.01);
    },
  );
  // 18000 push/flush cycles are CPU-bound work, not wall-clock I/O; a busy
  // laptop needs well over the 5s default, and the value under test is sample
  // accounting, not speed.
  //
  // That budget is why the frame-size check counts violations instead of
  // asserting inside the callback: 18000 expect() calls cost more than the
  // whole resampling loop and pushed this test past the 60s timeout on loaded
  // CI runners (see the lockfile/flake fixes in fix/ci-20261023).
  it("streams 30 minutes into fixed 100 ms frames without sample drift or audio accumulation", () => {
    let bytes = 0;
    let frames = 0;
    let misSizedFrames = 0;
    const encoder = new PcmEncoder(48000, (frame) => {
      if (frame.byteLength !== 3200) misSizedFrames++;
      bytes += frame.byteLength;
      frames++;
    });
    const chunk = new Float32Array(4800).fill(0.1);
    for (let i = 0; i < 18000; i++) encoder.push(chunk);
    encoder.flush();
    expect(misSizedFrames).toBe(0);
    expect(frames).toBe(18000);
    expect(bytes).toBe(1800 * 16000 * 2);
  }, 60_000);
});
