import { describe, expect, it } from "vitest";
import { chunkText, chunkVectorIds, embeddingVersion } from "./embedding";

describe("embeddingVersion", () => {
  it("binds model and dimensions into a stable id", () => {
    expect(embeddingVersion("@cf/qwen/qwen3-embedding-0.6b", 1024)).toBe(
      "@cf/qwen/qwen3-embedding-0.6b@1024",
    );
  });

  it("changes when the dimension changes", () => {
    expect(embeddingVersion("m", 512)).not.toBe(embeddingVersion("m", 1024));
  });
});

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("FlareMo 使用 D1")).toEqual(["FlareMo 使用 D1"]);
  });

  it("returns an empty list for blank text", () => {
    expect(chunkText("   ")).toEqual([]);
  });

  it("splits oversized text into multiple chunks under the budget", () => {
    const text = "字".repeat(2000);
    const chunks = chunkText(text, 512);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect([...chunk].length).toBeLessThanOrEqual(512 * 2);
    }
    expect(chunks.join("")).toBe(text);
  });
});

describe("chunkVectorIds", () => {
  it("derives chunk-scoped vector ids from a resource id", () => {
    expect(chunkVectorIds("memos/abc", 3)).toEqual([
      "memos/abc#chunks/0",
      "memos/abc#chunks/1",
      "memos/abc#chunks/2",
    ]);
  });
});
