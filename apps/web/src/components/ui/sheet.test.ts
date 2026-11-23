import { describe, expect, it } from "vitest";
import { resolveSheetSide } from "./sheet";

describe("resolveSheetSide", () => {
  it("maps logical start/end to physical sides for LTR and RTL", () => {
    expect(resolveSheetSide("start", "ltr")).toBe("left");
    expect(resolveSheetSide("start", "rtl")).toBe("right");
    expect(resolveSheetSide("end", "ltr")).toBe("right");
    expect(resolveSheetSide("end", "rtl")).toBe("left");
  });

  it("keeps explicit physical sides unchanged", () => {
    expect(resolveSheetSide("left", "rtl")).toBe("left");
    expect(resolveSheetSide("right", "ltr")).toBe("right");
  });
});
