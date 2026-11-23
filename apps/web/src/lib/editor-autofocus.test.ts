import type { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusEditorOnNextFrame } from "./editor-autofocus";

type Frame = { callback: FrameRequestCallback; id: number };

/** Minimal requestAnimationFrame stub: frames only run when the test says so. */
function stubAnimationFrames() {
  const frames: Frame[] = [];
  let nextId = 1;
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    frames.push({ callback, id });
    return id;
  });
  const cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  return { frames, request, cancel };
}

function fakeEditor(
  overrides: { destroyed?: boolean; focusThrows?: boolean } = {},
) {
  const focus = vi.fn(() => {
    if (overrides.focusThrows)
      throw new RangeError("Applying a mismatched transaction");
  });
  const editor = {
    isDestroyed: overrides.destroyed ?? false,
    commands: { focus },
  };
  return { editor: editor as unknown as Editor, focus };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("focusEditorOnNextFrame", () => {
  it("focuses once, on the next frame, at the end", () => {
    const { frames } = stubAnimationFrames();
    const { editor, focus } = fakeEditor();

    focusEditorOnNextFrame(editor);
    expect(focus).not.toHaveBeenCalled();

    frames[0]?.callback(0);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith("end");
  });

  it("skips focus when the editor was destroyed before the frame", () => {
    const { frames } = stubAnimationFrames();
    const { editor, focus } = fakeEditor({ destroyed: true });

    focusEditorOnNextFrame(editor);
    frames[0]?.callback(0);
    expect(focus).not.toHaveBeenCalled();
  });

  it("swallows the mount-time mismatched-transaction error", () => {
    const { frames } = stubAnimationFrames();
    const { editor, focus } = fakeEditor({ focusThrows: true });

    focusEditorOnNextFrame(editor);
    expect(() => frames[0]?.callback(0)).not.toThrow();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending frame on cleanup", () => {
    const { frames, cancel } = stubAnimationFrames();
    const { editor } = fakeEditor();

    const cleanup = focusEditorOnNextFrame(editor);
    cleanup();
    expect(cancel).toHaveBeenCalledWith(frames[0]?.id);
  });

  it("does nothing for a null editor and never schedules a frame", () => {
    const { request } = stubAnimationFrames();
    const cleanup = focusEditorOnNextFrame(null);
    expect(request).not.toHaveBeenCalled();
    expect(() => cleanup()).not.toThrow();
  });
});
