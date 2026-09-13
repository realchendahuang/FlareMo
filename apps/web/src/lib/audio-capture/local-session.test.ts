import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  removeMemoDraft,
  restoreMemoDraft,
  saveMemoDraft,
} from "../local-memo-capture";
import {
  CaptureDraftStore,
  captureDraftId,
  loadCapture,
  newLocalCapture,
} from "./local-session";

vi.mock("../local-memo-capture", () => ({
  createMemoCaptureClientId: () => "f6b32e75-24fd-4783-8588-738a49ef3427",
  getNewMemoDraftId: () => "tab-1",
  removeMemoDraft: vi.fn(async () => true),
  restoreMemoDraft: vi.fn(async () => null),
  saveMemoDraft: vi.fn(async () => ({ id: "draft" })),
}));
beforeEach(() => vi.clearAllMocks());
describe("voice draft persistence", () => {
  it("separates accounts and validates recovery without activating a microphone", async () => {
    expect(captureDraftId("user-a")).not.toBe(captureDraftId("user-b"));
    const data = newLocalCapture();
    data.text = "edited last sentence";
    data.duration = 1800;
    vi.mocked(restoreMemoDraft).mockResolvedValue({
      content: JSON.stringify(data),
    } as never);
    expect(await loadCapture("draft")).toEqual(data);
    vi.mocked(restoreMemoDraft).mockResolvedValue({
      content: JSON.stringify({ ...data, version: 9 }),
    } as never);
    expect(await loadCapture("draft")).toBeNull();
  });
  it("serializes final text and edits before deleting so old writes cannot revive discarded drafts", async () => {
    const store = new CaptureDraftStore("draft");
    const data = newLocalCapture();
    const first = store.save({ ...data, text: "original" });
    const edited = store.save({ ...data, text: "edited" });
    const clear = store.clear();
    await Promise.all([first, edited, clear]);
    expect(
      vi
        .mocked(saveMemoDraft)
        .mock.calls.map((call) => JSON.parse(call[0].content).text),
    ).toEqual(["original", "edited"]);
    expect(
      vi.mocked(removeMemoDraft).mock.invocationCallOrder[0],
    ).toBeGreaterThan(vi.mocked(saveMemoDraft).mock.invocationCallOrder[1]);
  });
  it("retries a failed draft deletion once", async () => {
    vi.mocked(removeMemoDraft)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const store = new CaptureDraftStore("draft");
    expect(await store.clear()).toBe(true);
    expect(removeMemoDraft).toHaveBeenCalledTimes(2);
  });
  it("reports an unavailable draft store after the bounded delete retry", async () => {
    const store = new CaptureDraftStore("draft");
    store.markRecovered();
    vi.mocked(removeMemoDraft).mockResolvedValue(false);
    expect(await store.clear()).toBe(false);
    expect(removeMemoDraft).toHaveBeenCalledTimes(2);
  });
  it("does not block completion when storage never persisted a draft", async () => {
    vi.mocked(saveMemoDraft).mockResolvedValue(null);
    vi.mocked(removeMemoDraft).mockResolvedValue(false);
    const store = new CaptureDraftStore("draft");
    const data = newLocalCapture();
    data.text = "server-save-can-finish";
    expect(await store.save(data)).toBe(false);
    expect(await store.clear()).toBe(true);
    expect(removeMemoDraft).toHaveBeenCalledTimes(2);
  });
});
