import { CAPTURE_MAX_TEXT } from "@flaremo/contracts/constants";
import { transcribeCaptureChunk } from "../../api";
import type { CapturedAudio } from "./encoder";
import type { CaptureSentence } from "./types";

// Uploads one captured container slice at a time and stitches the returned
// utterances back into the session timeline (rollout §3.3). The server has
// already applied each slice's `startMs` offset, so no client-side offset
// math remains. A failed slice is retried once; a second failure fails the
// whole session — the draft keeps whatever the user can still edit (D4).
const BATCH_RETRY_DELAY_MS = 1_000;

export type BatchProgress = { done: number; total: number };

export type BatchTranscribeOptions = {
  language: string;
  /** Wall-clock start of the recording; utterances map onto it. */
  startedAtMs: number;
  onProgress?: (progress: BatchProgress) => void;
  signal?: AbortSignal;
};

export async function transcribeCapturedAudio(
  audio: CapturedAudio,
  options: BatchTranscribeOptions,
): Promise<CaptureSentence[]> {
  const { slices, mimeType } = audio;
  const total = slices.length;
  // The pinned proxy contract carries the container as a query parameter so
  // the Worker can tell MiniMax which multipart field format to declare.
  const format = mimeType === "audio/ogg" ? "opus" : "wav";
  const sentences: CaptureSentence[] = [];
  let textLength = 0;
  for (const [index, slice] of slices.entries()) {
    if (options.signal?.aborted) throw new Error("Capture cancelled");
    const response = await transcribeWithRetry(
      slice.blob,
      slice.startMs,
      format,
      options,
    );
    options.onProgress?.({ done: index + 1, total });
    for (const [utteranceIndex, utterance] of response.utterances.entries()) {
      const text = utterance.text.trim();
      if (!text) continue;
      if (textLength + text.length + 20 > CAPTURE_MAX_TEXT) return sentences;
      textLength += text.length + 20;
      sentences.push({
        id: `batch:${index}:${utteranceIndex}:${utterance.startMs}`,
        text,
        final: true,
        startedAt: utterance.startMs,
        endedAt: utterance.endMs,
        receivedAt: options.startedAtMs + utterance.startMs,
      });
    }
  }
  return sentences;
}

async function transcribeWithRetry(
  blob: Blob,
  startMs: number,
  format: "opus" | "wav",
  options: BatchTranscribeOptions,
) {
  try {
    return await transcribeChunk(blob, startMs, format, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // Exactly one retry (rollout §3.3): transient proxy or upstream faults
    // recover here; persistent failures surface to the session.
    await new Promise((resolve) => setTimeout(resolve, BATCH_RETRY_DELAY_MS));
    if (options.signal?.aborted) throw new Error("Capture cancelled");
    return await transcribeChunk(blob, startMs, format, options);
  }
}

async function transcribeChunk(
  blob: Blob,
  startMs: number,
  format: "opus" | "wav",
  options: BatchTranscribeOptions,
) {
  const audio = await blob.arrayBuffer();
  return await transcribeCaptureChunk(audio, {
    startMs,
    language: options.language,
    format,
    signal: options.signal,
  });
}
