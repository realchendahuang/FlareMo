import { describe, expect, it } from "vitest";
import {
  checkpointInputSchema,
  createMemorySchema,
  forgetInputSchema,
  rememberInputSchema,
  updateMemorySchema,
} from "./memory";

describe("memory contracts", () => {
  it("createMemorySchema defaults to user-confirmed, global, semantic fact", () => {
    const parsed = createMemorySchema.parse({ content: "FlareMo 使用 D1" });
    expect(parsed).toMatchObject({
      content: "FlareMo 使用 D1",
      type: "semantic",
      kind: "fact",
      scope_type: "global",
      tier: "normal",
      importance: 50,
      lock: false,
    });
  });

  it("createMemorySchema rejects empty content and oversized content", () => {
    expect(() => createMemorySchema.parse({ content: "  " })).toThrow();
    expect(() =>
      createMemorySchema.parse({ content: "x".repeat(4_001) }),
    ).toThrow();
  });

  it("updateMemorySchema requires at least one field", () => {
    expect(() => updateMemorySchema.parse({})).toThrow();
    expect(updateMemorySchema.parse({ content: "new" }).content).toBe("new");
  });

  it("rememberInputSchema forbids an agent from locking", () => {
    expect(
      rememberInputSchema.parse({ content: "x", verification: "observed" })
        .verification,
    ).toBe("observed");
    expect(() =>
      rememberInputSchema.parse({ content: "x", verification: "locked" }),
    ).toThrow();
  });

  it("checkpointInputSchema caps items at 20", () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
      content: `item ${i}`,
    }));
    expect(() =>
      checkpointInputSchema.parse({ agent: "codex", summary: "s", items }),
    ).toThrow();
    expect(
      checkpointInputSchema.parse({
        agent: "codex",
        summary: "s",
        items: items.slice(0, 20),
      }).items,
    ).toHaveLength(20);
  });

  it("forgetInputSchema defaults reason to superseded", () => {
    expect(forgetInputSchema.parse({ memory_id: "memories/x" }).reason).toBe(
      "superseded",
    );
  });
});
