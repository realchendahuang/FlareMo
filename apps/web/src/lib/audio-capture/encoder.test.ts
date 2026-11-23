import {
  CAPTURE_BATCH_SLICE_MS,
  CAPTURE_SAMPLE_RATE,
} from "@flaremo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CaptureAudioSink,
  SLICE_SAMPLES,
  splitOggPages,
  wavHeader,
} from "./encoder";

function frame(sampleCount: number, value = 7): ArrayBuffer {
  // One 16 kHz mono s16le buffer.
  const buffer = new ArrayBuffer(sampleCount * 2);
  new Int16Array(buffer).fill(value);
  return buffer;
}

/** One 10 ms frame (160 samples at 16 kHz). */
function second(value = 7) {
  return frame(160, value);
}

/**
 * First byte offset of an ASCII marker, or -1.
 *
 * The obvious `bytes.findIndex((_, i) => bytes.subarray(i, i + 8).every(...))`
 * allocates one Uint8Array per candidate byte; over multi-hundred-KB slices that
 * ran for tens of seconds and pushed the Opus container test against its 60 s
 * timeout on slower runners. Same result, no per-byte allocation.
 */
function indexOfMagic(bytes: Uint8Array, magic: string): number {
  const last = bytes.byteLength - magic.length;
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < magic.length; j++) {
      if (bytes[i + j] !== magic.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WAV container", () => {
  it("writes a 44-byte RIFF header for 16 kHz mono s16le", () => {
    const header = wavHeader(3200 * 5);
    const view = new DataView(header.buffer);
    const text = (offset: number, length: number) =>
      String.fromCharCode(...header.subarray(offset, offset + length));
    expect(header.byteLength).toBe(44);
    expect(text(0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 3200 * 5);
    expect(text(8, 4)).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(text(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(3200 * 5);
  });

  it("slices long recordings at the 480 s budget with exact frame boundaries", async () => {
    const sink = await CaptureAudioSink.create({ opus: false });
    const frames = Math.ceil(SLICE_SAMPLES / 160) + 10; // a bit past one slice
    for (let i = 0; i < frames; i++) sink.push(second());
    const audio = await sink.finalize();
    expect(audio.mimeType).toBe("audio/wav");
    expect(audio.slices.length).toBeGreaterThanOrEqual(2);
    expect(audio.slices[0]?.startMs).toBe(0);
    // Second slice starts where the first ended.
    expect(audio.slices[1]?.startMs).toBe(
      Math.round(
        ((audio.slices[0]?.blob.size - 44) / 2) * (1000 / CAPTURE_SAMPLE_RATE),
      ),
    );
    for (const slice of audio.slices) {
      const header = wavHeader(0);
      const view = new DataView(await slice.blob.slice(0, 44).arrayBuffer());
      // Every slice is a standalone WAV file with its own header.
      expect(view.getUint32(40, true)).toBe(slice.blob.size - 44);
      expect(header.byteLength).toBe(44);
    }
    // The full-recording blob (rollout §4.1) is one standalone WAV: exactly
    // one header and every slice's payload, headers stripped.
    const recording = audio.recording;
    expect(recording).toBeInstanceOf(Blob);
    if (!recording) throw new Error("finalize() lost the recording blob");
    expect(recording.type).toBe("audio/wav");
    const recordingView = new DataView(
      await recording.slice(0, 44).arrayBuffer(),
    );
    expect(recordingView.getUint32(40, true)).toBe(
      audio.slices.reduce((sum, slice) => sum + slice.blob.size - 44, 0),
    );
    expect(recording.size).toBe(44 + recordingView.getUint32(40, true));
    sink.dispose();
  });

  it("flushes a short session into a single slice", async () => {
    const sink = await CaptureAudioSink.create({ opus: false });
    sink.push(second());
    const audio = await sink.finalize();
    expect(audio.slices).toHaveLength(1);
    expect(audio.slices[0]?.startMs).toBe(0);
    // A short session's recording is byte-identical to its single slice.
    expect(await audio.recording?.arrayBuffer()).toEqual(
      await audio.slices[0]?.blob.arrayBuffer(),
    );
  });
});

describe("Opus container (real WASM encoder)", () => {
  it("produces standalone Ogg Opus slices with headers in every slice", async () => {
    const sink = await CaptureAudioSink.create();
    if (sink.mimeType !== "audio/ogg")
      throw new Error("WASM opus encoder unavailable in this runtime");
    // Slightly more than one slice of silence.
    const frames = Math.ceil(SLICE_SAMPLES / 160) + 10;
    for (let i = 0; i < frames; i++) sink.push(second());
    const audio = await sink.finalize();
    expect(audio.mimeType).toBe("audio/ogg");
    expect(audio.slices.length).toBeGreaterThan(1);
    for (const [index, slice] of audio.slices.entries()) {
      const bytes = new Uint8Array(await slice.blob.arrayBuffer());
      const pages = splitOggPages(bytes);
      expect(pages.length).toBeGreaterThan(0);
      const all = bytes;
      const headIndex = indexOfMagic(all, "OpusHead");
      const tagsIndex = indexOfMagic(all, "OpusTags");
      // Headers are prepended to every slice, so each uploads standalone.
      expect(headIndex).toBeGreaterThanOrEqual(0);
      expect(tagsIndex).toBeGreaterThan(headIndex);
      expect(
        index === 0 ? slice.startMs : slice.startMs,
      ).toBeGreaterThanOrEqual(0);
    }
    // Timeline budget: every slice but the last stays under the provider's
    // 500 s hard limit.
    for (let i = 0; i + 1 < audio.slices.length; i++) {
      const duration = audio.slices[i + 1]?.startMs - audio.slices[i]?.startMs;
      expect(duration).toBeLessThan(500_000);
      expect(duration).toBeGreaterThanOrEqual(CAPTURE_BATCH_SLICE_MS - 500);
    }
    // The full-recording blob (rollout §4.1) is one continuous Ogg Opus
    // stream: the mandatory header pages appear exactly once, and every
    // page of every slice re-parses in order.
    const recording = audio.recording;
    if (!recording) throw new Error("recording missing");
    const recordingBytes = new Uint8Array(await recording.arrayBuffer());
    const countMagic = (bytes: Uint8Array, magic: string) => {
      let count = 0;
      outer: for (let i = 0; i <= bytes.byteLength - magic.length; i++) {
        for (let j = 0; j < magic.length; j++)
          if (bytes[i + j] !== magic.charCodeAt(j)) continue outer;
        count++;
        i += magic.length - 1;
      }
      return count;
    };
    expect(countMagic(recordingBytes, "OpusHead")).toBe(1);
    expect(countMagic(recordingBytes, "OpusTags")).toBe(1);
    expect(splitOggPages(recordingBytes).length).toBeGreaterThan(
      audio.slices.length,
    );
    sink.dispose();
    // Real WASM opus encode of a full recording is CPU-bound; on a busy laptop
    // it blows well past the 5s default, and even the 60s default was tight
    // enough that the suite flipped between pass and "timed out" on the same
    // commit. The value under test is the container structure, not encode
    // speed, so the budget stays generous rather than the assertion loose.
  }, 120_000);
});

describe("Opus fallback", () => {
  it("degrades to WAV when the WASM encoder cannot be initialized", async () => {
    vi.doMock("@audio/encode-opus", () => {
      throw new Error("no wasm in this runtime");
    });
    vi.resetModules();
    const { CaptureAudioSink: FailingSink } = await import("./encoder");
    const sink = await FailingSink.create();
    expect(sink.mimeType).toBe("audio/wav");
    sink.push(second());
    const audio = await sink.finalize();
    expect(audio.mimeType).toBe("audio/wav");
    expect(audio.slices).toHaveLength(1);
    sink.dispose();
  });
});

describe("Ogg page walker", () => {
  it("finds exact page boundaries", () => {
    // Build two concatenated fake pages: 27-byte headers with one segment of
    // 4 bytes each.
    const page = (granule: bigint) => {
      const bytes = new Uint8Array(27 + 1 + 4);
      bytes.set([0x4f, 0x67, 0x67, 0x53], 0);
      new DataView(bytes.buffer).setBigUint64(6, granule, true);
      bytes[26] = 1; // one segment
      bytes[27] = 4; // segment length 4
      bytes.set([1, 2, 3, 4], 28);
      return bytes;
    };
    const a = page(100n);
    const b = page(200n);
    const combined = new Uint8Array(a.byteLength + b.byteLength);
    combined.set(a, 0);
    combined.set(b, a.byteLength);
    const pages = splitOggPages(combined);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.granule).toBe(100n);
    expect(pages[1]?.granule).toBe(200n);
    expect(pages[0]?.bytes.byteLength).toBe(32);
  });
});
