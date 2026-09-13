import { describe, expect, it, vi } from "vitest";
import { CaptureTranscriptAccumulator } from "./transcript";
import type { CaptureSentence } from "./types";

function sentence(index: number): CaptureSentence {
  return {
    id: `sentence-${index}`,
    text: `text-${index}`,
    final: true,
    receivedAt: index * 1000,
  };
}

describe("capture transcript accumulator", () => {
  it("formats only newly finalized sentences", () => {
    const format = vi.fn((value: CaptureSentence) => value.text);
    const accumulator = new CaptureTranscriptAccumulator(format);
    const sentences = [sentence(0)];

    expect(accumulator.sync(sentences, 100)).toBe("text-0");
    expect(accumulator.sync(sentences, 100)).toBe("text-0");
    sentences.push(sentence(1), sentence(2));
    expect(accumulator.sync(sentences, 100)).toBe("text-0\n\ntext-1\n\ntext-2");
    expect(format.mock.calls.map(([value]) => value.id)).toEqual([
      "sentence-0",
      "sentence-1",
      "sentence-2",
    ]);
  });

  it("resets for a new capture and keeps 4,000 appends linear", () => {
    const format = vi.fn((value: CaptureSentence) => value.text);
    const accumulator = new CaptureTranscriptAccumulator(format);
    const sentences: CaptureSentence[] = [];
    let text = "";

    for (let index = 0; index < 4000; index += 1) {
      sentences.push(sentence(index));
      text = accumulator.sync(sentences, 100);
    }
    expect(format).toHaveBeenCalledTimes(4000);
    expect(text.startsWith("text-0\n\ntext-1")).toBe(true);
    expect(text.endsWith("text-3999")).toBe(true);

    expect(accumulator.sync([sentence(9)], 200)).toBe("text-9");
    expect(format).toHaveBeenCalledTimes(4001);
  });
});
