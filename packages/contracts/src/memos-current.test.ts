import { describe, expect, it } from "vitest";
import {
  currentListMemosResponseSchema,
  currentStandardErrorSchema,
} from "./memos-current";

describe("current Memos contracts", () => {
  it("requires camelCase fields and uppercase enums", () => {
    const parsed = currentListMemosResponseSchema.parse({
      memos: [
        {
          name: "memos/one",
          state: "NORMAL",
          creator: "users/owner",
          createTime: "2026-08-03T00:00:00.000Z",
          updateTime: "2026-08-03T00:00:00.000Z",
          content: "hello",
          visibility: "PUBLIC",
          tags: [],
          pinned: false,
        },
      ],
      nextPageToken: "next",
    });

    expect(parsed.memos[0]).toMatchObject({
      state: "NORMAL",
      visibility: "PUBLIC",
      createTime: expect.any(String),
    });
    expect(parsed).not.toHaveProperty("next_page_token");
  });

  it("keeps standard errors separate from the legacy error envelope", () => {
    expect(
      currentStandardErrorSchema.parse({
        code: 3,
        message: "Invalid argument",
        details: [],
      }),
    ).toEqual({ code: 3, message: "Invalid argument", details: [] });
  });
});
