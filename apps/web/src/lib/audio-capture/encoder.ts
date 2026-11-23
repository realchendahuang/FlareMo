import {
  CAPTURE_BATCH_SLICE_MS,
  CAPTURE_SAMPLE_RATE,
} from "@flaremo/contracts/constants";

// Client-side container encoding for batch ASR (rollout §3.3, D3). The tap
// receives the controller's 16 kHz mono s16le frames — the same
// pause-zero-filled stream the streaming path sends — so paused speech never
// reaches the provider. Opus (WASM libopus + Ogg muxer) is the default
// container; a 44-byte RIFF WAV is the fallback when the encoder cannot be
// initialized (D3). Slices stay below the provider's 500 s per-request limit:
// WAV is cut at exact frame boundaries, Opus at Ogg page boundaries with the
// header pages prepended to every slice.
export type CaptureAudioSlice = {
  blob: Blob;
  /** Slice start on the audio timeline (ms; relative to the session start). */
  startMs: number;
};
export type CapturedAudio = {
  slices: CaptureAudioSlice[];
  mimeType: "audio/ogg" | "audio/wav";
  /**
   * The whole session as one decodable file (rollout §4.1): the ASR slices
   * carry duplicated container headers so each uploads standalone, the R2
   * attachment must not. Cheap to build — slices are re-viewed via Blob.slice,
   * never copied. Null when the session captured no audio at all.
   */
  recording?: Blob | null;
};

type OpusStreamEncoder = {
  encode(channels: Float32Array[]): Uint8Array;
  flush(): Uint8Array;
  free(): void;
};

// The muxer does not expose the encoder delay, so it is read from the
// OpusHead packet it writes (RFC 7845: magic "OpusHead", then version,
// channels, then the 2-byte little-endian pre-skip).
const OPUSHEAD_PRESKIP_OFFSET = 10;
function opusPreSkip(headerPage: Uint8Array): number {
  const payloadStart = 27 + headerPage[26];
  const magic = Array.from("OpusHead", (char) => char.charCodeAt(0));
  for (let i = payloadStart; i <= headerPage.byteLength - 12; i++) {
    if (magic.every((value, index) => headerPage[i + index] === value))
      return (
        headerPage[i + OPUSHEAD_PRESKIP_OFFSET] |
        (headerPage[i + OPUSHEAD_PRESKIP_OFFSET + 1] << 8)
      );
  }
  return 0;
}

// A full slice stays well under the 16 MB proxy bound even as raw PCM.
export const SLICE_SAMPLES = Math.round(
  (CAPTURE_SAMPLE_RATE * CAPTURE_BATCH_SLICE_MS) / 1000,
);
export const WAV_HEADER_BYTES = 44;

/** 44-byte RIFF header for 16 kHz mono s16le PCM data. */
export function wavHeader(dataBytes: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(header.buffer);
  const writeText = (offset: number, text: string) => {
    for (const [index, char] of Array.from(text).entries())
      header[offset + index] = char.charCodeAt(0);
  };
  writeText(0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk length
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, CAPTURE_SAMPLE_RATE, true);
  view.setUint32(28, CAPTURE_SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);
  return header;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** s16le mono frame → mono f32 samples for libopus. */
export function decodePcmFrame(frame: ArrayBuffer): Float32Array {
  const samples = new Int16Array(frame);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 0x8000;
  return out;
}

export type OggPage = {
  granule: bigint;
  bytes: Uint8Array;
};

/**
 * Splits a byte stream into Ogg pages (RFC 3533). Exported for tests: page
 * boundaries are where an Opus stream may safely be cut.
 */
export function splitOggPages(bytes: Uint8Array): OggPage[] {
  const pages: OggPage[] = [];
  let offset = 0;
  while (offset + 27 <= bytes.byteLength) {
    if (
      bytes[offset] !== 0x4f ||
      bytes[offset + 1] !== 0x67 ||
      bytes[offset + 2] !== 0x67 ||
      bytes[offset + 3] !== 0x53
    )
      break; // Not an Ogg page; stop before corrupting the stream.
    const segments = bytes[offset + 26];
    if (offset + 27 + segments > bytes.byteLength) break;
    let payload = 0;
    for (let i = 0; i < segments; i++) payload += bytes[offset + 27 + i];
    const length = 27 + segments + payload;
    if (offset + length > bytes.byteLength) break;
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset,
      bytes.byteLength - offset,
    );
    pages.push({
      granule: view.getBigUint64(6, true),
      bytes: bytes.subarray(offset, offset + length),
    });
    offset += length;
  }
  return pages;
}

function findPacketMagic(page: Uint8Array, magic: string): number {
  // The segment table (27 + segment count) is followed by packet payloads;
  // scan the payload area for the magic string.
  const payloadStart = 27 + page[26];
  const needle = Array.from(magic, (char) => char.charCodeAt(0));
  outer: for (let i = payloadStart; i <= page.byteLength - needle.length; i++) {
    for (let j = 0; j < needle.length; j++)
      if (page[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Consumes the controller's PCM frames and produces uploadable container
 * slices. Frames are consumed synchronously like the waveform's analyser
 * tap — encoding never touches or blocks the microphone pipeline.
 */
export class CaptureAudioSink {
  private opus: OpusStreamEncoder | null;
  private readonly mode: "opus" | "wav";
  private readonly slices: CaptureAudioSlice[] = [];
  // WAV state: raw frames of the slice currently being filled.
  private wavChunks: Uint8Array[] = [];
  private wavSliceStartSamples = 0;
  private wavSamples = 0;
  // Opus state: one continuous page stream for the whole session.
  private opusChunks: Uint8Array[] = [];
  private finished = false;
  // Full-recording assembly (rollout §4.1): the mandatory header pages kept
  // once so slices can shed their copies, plus the WAV data-byte total.
  private opusHeaderPages: Uint8Array[] = [];
  private opusHeaderBytes = 0;
  private wavDataBytes = 0;

  private constructor(mode: "opus" | "wav", opus: OpusStreamEncoder | null) {
    this.mode = mode;
    this.opus = opus;
  }

  /** Never rejects: encoder initialization failures degrade to the WAV path. */
  static async create(
    options: { opus?: boolean } = {},
  ): Promise<CaptureAudioSink> {
    let opus: OpusStreamEncoder | null = null;
    if (options.opus !== false) {
      try {
        const { default: createOpus } = await import("@audio/encode-opus");
        opus = await createOpus({
          sampleRate: CAPTURE_SAMPLE_RATE,
          channels: 1,
          bitrate: 24,
          application: "voip",
        });
      } catch {
        opus = null;
      }
    }
    return new CaptureAudioSink(opus ? "opus" : "wav", opus);
  }

  get mimeType(): "audio/ogg" | "audio/wav" {
    return this.mode === "opus" ? "audio/ogg" : "audio/wav";
  }

  /** Accepts one s16le mono 16 kHz PCM frame (typically 100 ms). */
  push(frame: ArrayBuffer) {
    if (this.finished || frame.byteLength === 0 || frame.byteLength % 2) return;
    const bytes = new Uint8Array(frame.byteLength);
    bytes.set(new Uint8Array(frame, 0, frame.byteLength));
    if (this.mode === "wav") {
      const samples = bytes.byteLength / 2;
      if (this.wavSamples >= SLICE_SAMPLES) this.closeWavSlice();
      this.wavChunks.push(bytes);
      this.wavSamples += samples;
      return;
    }
    if (!this.opus) return;
    const encoded = this.opus.encode([decodePcmFrame(frame)]);
    if (encoded.byteLength) this.opusChunks.push(encoded);
  }

  /** Flushes the trailing slice; the result is ready for the batch runner. */
  async finalize(): Promise<CapturedAudio> {
    if (!this.finished) {
      this.finished = true;
      if (this.mode === "wav") {
        this.closeWavSlice();
      } else if (this.opus) {
        const tail = this.opus.flush();
        if (tail.byteLength) this.opusChunks.push(tail);
        this.sliceOpusStream();
        this.opus.free();
        this.opus = null;
      }
    }
    return {
      slices: this.slices,
      mimeType: this.mimeType,
      recording: this.buildRecording(),
    };
  }

  /**
   * One container for the whole session: WAV slices lose their per-slice RIFF
   * headers under a single fresh one; Opus slices lose their repeated header
   * pages because the originals are kept only here. Blob.slice re-views the
   * existing bytes instead of copying them.
   */
  private buildRecording(): Blob | null {
    if (!this.slices.length) return null;
    if (this.mode === "wav") {
      return new Blob(
        [
          wavHeader(this.wavDataBytes),
          ...this.slices.map((slice) => slice.blob.slice(WAV_HEADER_BYTES)),
        ],
        { type: "audio/wav" },
      );
    }
    if (!this.opusHeaderPages.length) return null;
    return new Blob(
      [
        concatBytes(this.opusHeaderPages),
        ...this.slices.map((slice) => slice.blob.slice(this.opusHeaderBytes)),
      ],
      { type: "audio/ogg" },
    );
  }

  dispose() {
    this.finished = true;
    try {
      this.opus?.free();
    } catch {
      /* Already freed. */
    }
    this.opus = null;
    this.wavChunks = [];
    this.opusChunks = [];
    this.opusHeaderPages = [];
  }

  private closeWavSlice() {
    if (!this.wavSamples) {
      this.wavChunks = [];
      return;
    }
    const blob = new Blob(
      [wavHeader(this.wavSamples * 2), concatBytes(this.wavChunks)],
      { type: "audio/wav" },
    );
    this.slices.push({
      blob,
      startMs: Math.round(
        (this.wavSliceStartSamples * 1000) / CAPTURE_SAMPLE_RATE,
      ),
    });
    this.wavDataBytes += this.wavSamples * 2;
    this.wavSliceStartSamples += this.wavSamples;
    this.wavChunks = [];
    this.wavSamples = 0;
  }

  /**
   * Cuts the continuous Opus page stream at page boundaries so each slice is
   * a decodable Ogg Opus file: header pages (OpusHead + OpusTags) are
   * prepended to every slice, and a boundary falls after the first page
   * whose input-time end reaches the slice budget. Page-relative times use
   * the 48 kHz granule position minus the encoder's pre-skip.
   */
  private sliceOpusStream() {
    const pages = this.opusChunks.flatMap((chunk) => splitOggPages(chunk));
    this.opusChunks = [];
    const headerPages: Uint8Array[] = [];
    let headerDone = false;
    let preSkip = 0;
    const inputMs = (granule: bigint) =>
      Number((granule - BigInt(preSkip)) * 1000n) / 48_000;
    let sliceStartMs = 0;
    let slicePages: Uint8Array[] = [];
    const flushSlice = (nextStartMs: number) => {
      if (!slicePages.length) return;
      this.slices.push({
        blob: new Blob([concatBytes([...headerPages, ...slicePages])], {
          type: "audio/ogg",
        }),
        startMs: Math.round(sliceStartMs),
      });
      slicePages = [];
      sliceStartMs = nextStartMs;
    };
    for (const page of pages) {
      if (!headerDone) {
        headerPages.push(page.bytes);
        if (findPacketMagic(page.bytes, "OpusHead") >= 0)
          preSkip = opusPreSkip(page.bytes);
        // The OpusTags packet ends the mandatory header pages.
        if (findPacketMagic(page.bytes, "OpusTags") >= 0) headerDone = true;
        continue;
      }
      slicePages.push(page.bytes);
      const pageEndMs = inputMs(page.granule);
      if (pageEndMs - sliceStartMs >= CAPTURE_BATCH_SLICE_MS)
        flushSlice(pageEndMs);
    }
    flushSlice(inputMs(pages.at(-1)?.granule ?? 0n));
    this.opusHeaderPages = headerPages;
    this.opusHeaderBytes = headerPages.reduce(
      (sum, page) => sum + page.byteLength,
      0,
    );
  }
}

/** Convenience factory for the capture page's controller deps. */
export function createCaptureAudioSink(): Promise<CaptureAudioSink> {
  return CaptureAudioSink.create();
}
