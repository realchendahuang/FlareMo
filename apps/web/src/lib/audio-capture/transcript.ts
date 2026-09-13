import type { CaptureSentence } from "./types";

export type CaptureSentenceFormatter = (sentence: CaptureSentence) => string;

export function formatCaptureSentence(sentence: CaptureSentence) {
  return `[${new Date(sentence.receivedAt).toLocaleTimeString([], { hour12: false })}] ${sentence.text}`;
}

/** Keeps live transcript work proportional to newly finalized sentences. */
export class CaptureTranscriptAccumulator {
  private startedAt: number | null = null;
  private sentenceCount = 0;
  private text = "";
  private readonly formatSentence: CaptureSentenceFormatter;

  constructor(
    formatSentence: CaptureSentenceFormatter = formatCaptureSentence,
  ) {
    this.formatSentence = formatSentence;
  }

  sync(
    sentences: CaptureSentence[],
    startedAt: number,
    finalizedCount = sentences.length,
  ) {
    const nextCount = Math.min(finalizedCount, sentences.length);
    if (this.startedAt !== startedAt || nextCount < this.sentenceCount) {
      this.startedAt = startedAt;
      this.sentenceCount = 0;
      this.text = "";
    }

    const added = sentences
      .slice(this.sentenceCount, nextCount)
      .map(this.formatSentence)
      .join("\n\n");
    if (added) this.text = this.text ? `${this.text}\n\n${added}` : added;
    this.sentenceCount = nextCount;
    return this.text;
  }

  reset() {
    this.startedAt = null;
    this.sentenceCount = 0;
    this.text = "";
  }
}
