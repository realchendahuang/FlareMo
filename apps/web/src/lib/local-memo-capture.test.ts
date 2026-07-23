import { describe, expect, it } from "vitest";
import {
  createMemoCaptureClientId,
  createMemoCaptureInput,
  isMemoCaptureEmpty,
  toCreateMemoInput,
} from "./local-memo-capture";

describe("local memo capture", () => {
  it("keeps one client id and normalizes duplicate tags", () => {
    const capture = createMemoCaptureInput({
      content: "A durable idea",
      visibility: "private",
      tags: ["ideas", " ideas ", "work", ""],
      files: [],
      clientId: "existing-client-id",
    });

    expect(capture.clientId).toBe("existing-client-id");
    expect(capture.tags).toEqual(["ideas", "work"]);
  });

  it("creates a client id when a capture does not have one", () => {
    expect(createMemoCaptureClientId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("treats attachments as content for draft persistence", () => {
    expect(
      isMemoCaptureEmpty({
        content: "   ",
        visibility: "private",
        tags: [],
        files: [],
      }),
    ).toBe(true);
    expect(
      isMemoCaptureEmpty({
        content: "   ",
        visibility: "private",
        tags: [],
        files: [{} as File],
      }),
    ).toBe(false);
  });

  it("maps its stable client id to the memo API payload", () => {
    const request = toCreateMemoInput({
      content: "Queue me",
      visibility: "protected",
      tags: ["offline"],
      files: [],
      clientId: "stable-offline-id",
    });

    expect(request).toMatchObject({
      content: "Queue me",
      visibility: "protected",
      payload: { tags: ["offline"], client_id: "stable-offline-id" },
      source: "web",
    });
  });
});
