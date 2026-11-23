import { describe, expect, it } from "vitest";
import { chunkExportAttachmentIdsForR2Lookup } from "./export-data";

describe("export attachment R2 lookup chunking", () => {
  it("keeps the N + 2 binding budget at the 98/99 boundary", () => {
    const ids = Array.from(
      { length: 200 },
      (_, index) => `attachments/${index}`,
    );
    const at98 = chunkExportAttachmentIdsForR2Lookup(ids.slice(0, 98));
    expect(at98).toHaveLength(1);
    expect(at98[0]).toHaveLength(98);

    const at99 = chunkExportAttachmentIdsForR2Lookup(ids.slice(0, 99));
    expect(at99.map((chunk) => chunk.length)).toEqual([98, 1]);

    const at200 = chunkExportAttachmentIdsForR2Lookup(ids);
    expect(at200.map((chunk) => chunk.length)).toEqual([98, 98, 4]);
  });
});
