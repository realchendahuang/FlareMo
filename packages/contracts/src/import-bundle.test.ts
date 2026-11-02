import { describe, expect, it } from "vitest";
import { importBundleSchema } from "./memos";

const memo = {
  name: "memos/e2e-import",
  content: "hello",
  visibility: "private" as const,
  state: "normal" as const,
  pinned: false,
  payload: {},
};

const attachment = {
  name: "attachments/e2e-import",
  id: "attachments/e2e-import",
  memo: "memos/e2e-import",
  filename: "photo.png",
  content_type: "image/png",
  size: 1,
  payload: {},
  create_time: "2026-01-01T00:00:00.000Z",
  update_time: "2026-01-01T00:00:00.000Z",
};

describe("import bundle resource names", () => {
  it("accepts ids our own export produces", () => {
    expect(() =>
      importBundleSchema.parse({
        version: 6,
        memos: [memo],
        attachments: [attachment],
      }),
    ).not.toThrow();
  });

  it("rejects attachment names that could break out of an HTML attribute", () => {
    const result = importBundleSchema.safeParse({
      version: 6,
      memos: [memo],
      attachments: [
        {
          ...attachment,
          name: 'attachments/x" onerror="alert(1)',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects path traversal in imported ids", () => {
    const result = importBundleSchema.safeParse({
      version: 6,
      memos: [{ ...memo, name: "memos/../../escape" }],
    });
    expect(result.success).toBe(false);
  });
});
