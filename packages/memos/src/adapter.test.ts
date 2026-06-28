import { describe, expect, it } from "vitest";
import {
  parseAttachmentsResourceName,
  parseMemosResourceName,
  parseSharesResourceName,
} from "./adapter";

describe("Memos resource names", () => {
  it("accepts bare memo ids and full memo resource names", () => {
    expect(parseMemosResourceName("abc")).toBe("memos/abc");
    expect(parseMemosResourceName("memos/abc")).toBe("memos/abc");
  });

  it("accepts bare attachment ids and full attachment resource names", () => {
    expect(parseAttachmentsResourceName("file")).toBe("attachments/file");
    expect(parseAttachmentsResourceName("attachments/file")).toBe(
      "attachments/file",
    );
  });

  it("accepts bare share ids and full share resource names", () => {
    expect(parseSharesResourceName("token")).toBe("shares/token");
    expect(parseSharesResourceName("shares/token")).toBe("shares/token");
  });
});
